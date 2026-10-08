// audit-item-6b: 采用标签后「本人页 / 他人页」标签口径一致（第 7 项接线，判据来自第 6 项）
//
// 审计问题：AI 建议标签采用后，本人页显示的和他人主页显示的不是同一份列表。
// 根因有两处，本用例分别钉住：
//   1. 后端：展示用的 personal_tags 曾在多个调用点各自决定截断条数（discovery 截 10、
//      profile 不截），现统一收敛到 core/profile_tags.display_personal_tags。
//   2. 前端：他人主页 detail.uvue 的标签兜底链把只截 5 条且不含性格标签的
//      card.interest_tags 排在合并列表之前；采用页也没有按「10 - 已占位数」预算，
//      导致采用后总量越过 10 上限而被后端裁掉。
// 手法：沙箱执行真实源码片段（babel 去类型注解后 vm 执行），而不是字符串正则匹配。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const { backendRoot: resolveBackendRoot } = require('./helpers/cross-repo.cjs')
const backendRoot = resolveBackendRoot()

/** 从 source 的 startIndex 起按花括号配平切出一段声明，供沙箱执行 */
function sliceBalanced(source, startIndex) {
  const open = source.indexOf('{', startIndex)
  if (open < 0) throw new Error('未找到起始花括号')
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(startIndex, i + 1)
    }
  }
  throw new Error('花括号未配平')
}

/** 把 TS 片段编译成 JS 并在沙箱中求值，extra 用于导出沙箱内的局部符号 */
function evalFragment(code, extra = '') {
  // 片段里的 return 在 babel 顶层非法，先用函数表达式包裹，再一起去类型并执行。
  // 用数组 join 换行码点，避免在测试源码里手写转义序列。
  const wrapped = ['(function () {', code, extra, '})()'].join(String.fromCharCode(10))
  const out = babel.transformSync(wrapped, {
    filename: 'fragment.ts',
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-typescript']
  }).code
  return vm.runInNewContext(out)
}

// ── 1. 前端预算函数：采用条数必须让总量留在 10 以内 ───────────────────
const resultPage = fs.readFileSync(path.join(root, 'pagesSub', 'profileExtra', 'my-portrait-result.uvue'), 'utf8')
const constsStart = resultPage.indexOf('const MAX_PROFILE_CARD_ADOPT_TAGS')
const budgetStart = resultPage.indexOf('function profileCardTagBudget')
assert.ok(constsStart >= 0, 'my-portrait-result.uvue 必须声明采用条数上限常量')
assert.ok(budgetStart >= 0, 'my-portrait-result.uvue 必须定义 profileCardTagBudget 预算函数')
assert.ok(constsStart < budgetStart, '预算常量必须在预算函数之前声明')

// 常量声明行本身无花括号，配平切片会一直吃到紧随其后的预算函数闭合括号，
// 因此这一段同时包含两个常量与预算函数本体。
const budget = evalFragment(
  sliceBalanced(resultPage, constsStart),
  'return { profileCardTagBudget, MAX_PROFILE_CARD_ADOPT_TAGS, MAX_PERSONAL_TAGS };'
)

assert.equal(budget.MAX_PERSONAL_TAGS, 10, '前端展示上限须与后端 MAX_PERSONAL_TAGS 一致')
assert.ok(budget.MAX_PROFILE_CARD_ADOPT_TAGS > 0, '单次采用条数上限必须为正')
assert.equal(budget.profileCardTagBudget(0), 3, '无已有标签时可采满额定条数')
assert.equal(budget.profileCardTagBudget(8), 2, '已有 8 条时只允许再占 2 个名额')
assert.equal(budget.profileCardTagBudget(9), 1, '已有 9 条时只允许再占 1 个名额')
assert.equal(budget.profileCardTagBudget(10), 0, '已有标签达上限时预算为 0')
assert.equal(budget.profileCardTagBudget(12), 0, '历史脏数据超上限时预算不得为负')
assert.equal(budget.profileCardTagBudget(-1), 3, '未知已有数须回退到额定条数，不得静默拒绝采用')
for (let existing = 0; existing <= budget.MAX_PERSONAL_TAGS; existing++) {
  const adopted = budget.profileCardTagBudget(existing)
  assert.ok(adopted >= 0, `existing=${existing} 预算不得为负`)
  assert.ok(existing + adopted <= budget.MAX_PERSONAL_TAGS, `existing=${existing} 采用后总量越界`)
}
// 历史脏数据已超上限时不得再放行任何采用，也不得给出负预算
for (let existing = budget.MAX_PERSONAL_TAGS + 1; existing <= 20; existing++) {
  assert.equal(budget.profileCardTagBudget(existing), 0, `existing=${existing} 已超上限，预算须为 0`)
}

// 已有标签数未知时必须显式标记，否则二次进入页面会沿用上一页的计数
assert.match(resultPage, /profileCardExistingTagCount:\s*-1/, '已有标签数须以 -1（未知）初始化')
assert.match(resultPage, /profileCardExistingTagCount = -1/, '采用成功后须重置已有标签数')
assert.match(
  resultPage,
  /toggleProfileCardTag[\s\S]{0,400}profileCardTagBudget\(this\.profileCardExistingTagCount\)/,
  '逐个选择标签必须走预算函数，不得再硬编码条数'
)
assert.ok(
  !/profileCardSelectedTags\.length\s*<\s*3\b/.test(resultPage),
  '选择标签处不得残留硬编码上限 3'
)
assert.match(resultPage, /refreshProfileCardTagBudget/, '须在进入采用流程前刷新已有标签数')

// ── 2. 他人主页标签兜底链：必须优先读合并后的同一份列表 ────────────────
const detail = fs.readFileSync(path.join(root, 'pagesSub', 'userExtra', 'user', 'detail.uvue'), 'utf8')
const tagsLine = detail
  .split(/\r?\n/)
  .find(line => line.trim().startsWith('const tags = Array.isArray(card.personal_tags)'))
assert.ok(tagsLine, 'detail.uvue 必须保留以 card.personal_tags 优先的标签兜底链')

const resolveTagsInSandbox = evalFragment(
  'function resolveTags(card: any, profile: any): string[] {\n' + tagsLine + '\nreturn tags\n}\nreturn resolveTags;'
)
// vm 新 realm 里 [] 的原型与宿主 Array 不同，先归一成宿主数组再 deepEqual，
// 避免跨 realm 原型差异被误判成内容不一致。
const resolveTags = (card, profile) => Array.from(resolveTagsInSandbox(card, profile))

const merged = ['标签一', '标签二', '标签三', '标签四', '标签五', '标签六', '标签七', '标签八', '标签九', '新采用标签']
const legacyFive = merged.slice(0, 5)

// 采用后后端把合并列表同时写入 card.personal_tags 与 profile.personal_tags，
// card.interest_tags 仍是只截 5 条的旧口径 —— 他人页必须读到合并列表。
assert.deepEqual(resolveTags({ personal_tags: merged, interest_tags: legacyFive }, { personal_tags: merged }), merged,
  '他人页必须显示合并后的完整标签，包含新采用标签')
assert.deepEqual(resolveTags({ interest_tags: legacyFive }, { personal_tags: merged }), merged,
  'card.interest_tags（5 条旧口径）不得排在 profile.personal_tags 之前')
assert.deepEqual(resolveTags({}, { personal_tags: ['仅资料标签'] }), ['仅资料标签'], '卡片缺字段时回退到资料标签')
assert.deepEqual(resolveTags({ personal_tags: merged }, {}), merged, '卡片有合并列表时不得因资料缺失而清空')
assert.deepEqual(resolveTags({}, {}), [], '两端都缺字段时返回空列表而非 undefined')

// 跨页面一致性：本人在他人主页看到的，必须与后端下发的那份合并列表完全相同
assert.deepEqual(
  resolveTags({ personal_tags: merged, interest_tags: legacyFive }, { personal_tags: merged }),
  merged.slice(0, budget.MAX_PERSONAL_TAGS),
  '他人页标签必须等于后端合并列表（截断到 10 条），不得少显示新采用标签'
)
assert.ok(
  resolveTags({ personal_tags: merged, interest_tags: legacyFive }, {}).includes('新采用标签'),
  '新采用标签必须出现在他人页结果中'
)

// ── 3. 后端：展示截断只允许发生在唯一的共用函数里 ──────────────────────
if (!fs.existsSync(backendRoot)) {
  console.log('SKIP test-profile-card-tag-consistency.js 后端目录不可访问（设置 XSA_BACKEND_ROOT 可启用后端断言）')
  process.exit(0)
}

const OWN_PAGE_SLICE = /personal_tags\([^)\n]*\)\s*\[:\s*\d+\s*\]/
const coreTags = fs.readFileSync(path.join(backendRoot, 'app', 'core', 'profile_tags.py'), 'utf8')
assert.match(coreTags, /^MAX_PERSONAL_TAGS(?::\s*Final\[int\])?\s*=\s*10\b/m, '后端展示上限常量须为 10')
const displayDef = coreTags.indexOf('def display_personal_tags(')
assert.ok(displayDef >= 0, '后端必须提供 display_personal_tags 共用展示口径')
assert.ok(coreTags.slice(displayDef, displayDef + 600).includes('[:MAX_PERSONAL_TAGS]'),
  'display_personal_tags 必须集中做展示截断')

for (const rel of [['app', 'services', 'profile.py'], ['app', 'services', 'discovery.py'], ['app', 'services', 'ai_avatar.py']]) {
  const label = rel.join('/')
  const source = fs.readFileSync(path.join(backendRoot, ...rel), 'utf8')
  assert.match(source, /display_personal_tags/, `${label} 必须复用 display_personal_tags 而不是自行截断`)
  assert.ok(!OWN_PAGE_SLICE.test(source), `${label} 不得再对 personal_tags 结果做各自的条数截断`)
}

console.log('PASS profile card tag consistency: 前端预算 + 他人页兜底链 + 后端统一展示口径')
