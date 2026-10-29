/**
 * 学历字典一致性契约（问题评估 F-01）。
 *
 * 背景：前端一度有三套学历表，其中首页那张是反序的（1 → 博士），
 * 导致「大专/高中」账号在首页显示成「硕士/博士」，而详情页/编辑页是对的。
 *
 * 现约定：
 *  - 用户资料（user_profile）刻度 1-5：1 高中及以下 / 2 大专 / 3 本科 / 4 硕士 / 5 博士，
 *    与后端 app/services/discovery.py 的 _EDUCATION_LABELS 一致；
 *  - AI 画像（ai_profile 旅程）刻度 1-6：1 初中及以下 … 6 博士，
 *    与后端 app/schemas/ai_profile.py 的 (1,6) 区间契约一致。两者**不是**同一套，不能合并。
 *
 * 本用例只做源码契约断言（仓库既有风格，不依赖 node_modules）。
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

const util = read('utils/profile-field-display.uts')
const indexPage = read('pages/index/index.uvue')
const detailPage = read('pagesSub/userExtra/user/detail.uvue')
const editPage = read('pagesSub/userExtra/user/edit.uvue')

// ========== 用户资料刻度：1 高中及以下 … 5 博士 ==========

assert.match(
  util,
  /const USER_EDUCATION_LABELS: Map<string, string> = new Map\(\)/,
  '必须存在用户资料专用学历表 USER_EDUCATION_LABELS'
)
for (const [code, label] of [['1', '高中及以下'], ['2', '大专'], ['3', '本科'], ['4', '硕士'], ['5', '博士']]) {
  assert.match(
    util,
    new RegExp(`USER_EDUCATION_LABELS\\.set\\('${code}', '${label}'\\)`),
    `用户资料学历 ${code} 必须是「${label}」（与后端 _EDUCATION_LABELS 一致）`
  )
}
for (const code of ['6', '7', '8']) {
  assert.match(
    util,
    new RegExp(`USER_EDUCATION_LABELS\\.set\\('${code}', '博士'\\)`),
    `后端放行到 8，未启用档位 ${code} 必须兜底为「博士」`
  )
}

// ========== AI 画像刻度：1 初中及以下 … 6 博士（独立域，不得被合并） ==========

assert.match(
  util,
  /EDUCATION_LEVEL_LABELS\.set\('1', '初中及以下'\)/,
  'AI 画像学历表起点必须是「初中及以下」：后端 ai_profile 抽取契约是 1-6 刻度'
)
assert.match(
  util,
  /EDUCATION_LEVEL_LABELS\.set\('6', '博士'\)/,
  'AI 画像学历表 6 必须是「博士」：与 ai_profile.py 的 (1,6) 区间一致'
)
assert.notStrictEqual(
  /USER_EDUCATION_LABELS\.set\('1', '初中及以下'\)/.test(util),
  true,
  '用户资料表不得写成「初中及以下」：user_profile 的 1 是「高中及以下」'
)

// ========== 导出函数与选项 ==========

assert.match(util, /export function educationLabel\(raw: any\): string/, '必须导出 educationLabel()')
assert.match(util, /\['未选择', '高中及以下', '大专', '本科', '硕士', '博士'\]/, '必须导出 USER_EDUCATION_OPTIONS 供编辑页 picker 复用')

// ========== 首页：不得再出现本地反序表 ==========

assert.match(
  indexPage,
  /import \{[^}]*educationLabel[^}]*\} from '@\/utils\/profile-field-display\.uts'/,
  '首页必须从 utils/profile-field-display.uts 引入 educationLabel'
)
assert.doesNotMatch(
  indexPage,
  /const labels = \['', '博士', '硕士', '本科', '大专', '高中'/,
  '首页不得再保留反序学历表（1→博士）'
)
assert.doesNotMatch(
  indexPage,
  /'博士', '硕士', '本科', '大专'/,
  '首页任何位置都不允许再出现反序学历字面量'
)

// ========== 详情页：委托公共函数，不维护本地数组 ==========

assert.match(
  detailPage,
  /educationLabel as educationLabelOf/,
  '详情页必须以别名引入公共 educationLabel，避免与局部同名函数冲突'
)
assert.doesNotMatch(
  detailPage,
  /const labels = \['', '高中及以下', '大专', '本科', '硕士', '博士'/,
  '详情页不得再维护本地学历数组（改公共函数）'
)

// ========== 编辑页：picker 选项复用公共常量 ==========

assert.match(
  editPage,
  /const educationOptions = USER_EDUCATION_OPTIONS/,
  '编辑页学历选项必须复用 USER_EDUCATION_OPTIONS，禁止写字面量'
)
assert.doesNotMatch(
  editPage,
  /const educationOptions = \['未选择', '高中及以下'/,
  '编辑页不得再写字面量学历选项'
)

console.log('PASS 学历字典一致性：用户资料 1-5 与 AI 画像 1-6 两套刻度已分开，首页/详情/编辑已收口')
