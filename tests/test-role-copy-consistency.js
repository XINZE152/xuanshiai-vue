// audit-item-6: 用户可见角色与画像栏目文案统一（第 7 项接线，判据来自第 6 项）
//
// 判据来源：工作区根目录 PRODUCT.md「用户可见角色与画像栏目文案统一」一节。
// 规则：
//   1. 角色名唯一来源是 utils/moxiang-badge.uts 的 MASTER_ROLE_NAME = '知遇'，
//      api/voice-master-ws.uts 只能透传，不得再各自硬编码。
//   2. 两栏文案固定为「我的真实画像」「期待的长期关系」，旧栏目名不得出现在用户可见文案里。
//   3. 角色旧称「墨相师」不得出现在用户可见文案里；受保护文件 pages.json 的导航栏标题
//      单独以 WARN 暴露为验证缺口，不由本用例越权修改。
//   4. DESIGN.md 登记的视觉品牌标识（墨相心帖 / 知遇墨相 / 墨相印章）必须保留。
//
// 判定口径：只看「用户可见」片段（模板区文本 + 脚本区字符串字面量），代码注释不参与，
// 避免把历史阶段注释误判成文案，也不倒逼与文案无关的注释大面积改写。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

const SCAN_ROOTS = ['pages', 'pagesSub', 'components', 'api', 'utils', 'store']

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(?:uvue|uts|vue|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = []
for (const dir of SCAN_ROOTS) {
  const abs = path.join(root, dir)
  if (fs.existsSync(abs)) walk(abs, files)
}
assert.ok(files.length > 20, `扫描范围异常，仅发现 ${files.length} 个源码文件`)

// ── 1. 角色名唯一来源 ──────────────────────────────────────────────────
const badge = read('utils', 'moxiang-badge.uts')
const masterRoleMatch = badge.match(/export const MASTER_ROLE_NAME = '([^']+)'/)
assert.ok(masterRoleMatch, 'utils/moxiang-badge.uts 必须导出 MASTER_ROLE_NAME 常量')
const MASTER_ROLE_NAME = masterRoleMatch[1]
assert.equal(MASTER_ROLE_NAME, '知遇', '角色名应统一到 PRODUCT.md 规定的「知遇」')

const ws = read('api', 'voice-master-ws.uts')
assert.match(
  ws,
  /import \{[^}]*MASTER_ROLE_NAME[^}]*\} from '(?:@|\.\.)\/utils\/moxiang-badge\.uts'/,
  'voice-master-ws.uts 必须从唯一来源导入 MASTER_ROLE_NAME'
)
assert.match(ws, /export \{ MASTER_ROLE_NAME \}/, 'voice-master-ws.uts 需保留透传导出以兼容既有导入')
assert.doesNotMatch(ws, /export const MASTER_ROLE_NAME =/, 'MASTER_ROLE_NAME 不得在 WS 模块重复定义')

// 失败提示必须走常量，否则角色名再次改动时提示会漂移
assert.match(
  read('pages', 'profile', 'profile.uvue'),
  /MASTER_ROLE_NAME \+ '页面打开失败，请重试'/,
  '个人页的知遇打开失败提示须引用 MASTER_ROLE_NAME'
)
assert.match(
  read('api', 'ai-moxiang.uts'),
  /MASTER_ROLE_NAME \+ '数据加载失败'/,
  '知遇数据加载失败提示须引用 MASTER_ROLE_NAME'
)

// ── 2 & 3. 用户可见文案不得再出现旧称 ──────────────────────────────────
const BANNED = ['我的墨相', '愿遇之相', '墨相师']
// 开发态诊断组件仅在 errors.length > 0 时渲染，不参与用户可见文案判定
const ALLOWED_FILES = new Set([path.join('components', 'XsaMoxiangTrace.uvue')])

const LINE_COMMENT = /^\s*(?:\/\/|\/\*|\*)/
const STRING_LITERAL = /'([^']*)'|"([^"]*)"/g

function visibleText(content) {
  const lines = []
  let inTemplate = false
  let inBlockComment = false
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '<template>') inTemplate = true
    else if (line === '</template>') inTemplate = false
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      continue
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true
      continue
    }
    if (LINE_COMMENT.test(line)) continue
    if (line.startsWith('<!--')) continue
    if (inTemplate) {
      lines.push(line)
      continue
    }
    for (const m of raw.matchAll(STRING_LITERAL)) {
      lines.push(m[1] != null ? m[1] : m[2])
    }
  }
  return lines.join('\n')
}

let scannedSurfaces = 0
for (const file of files) {
  const rel = path.relative(root, file)
  if (ALLOWED_FILES.has(rel)) continue
  const visible = visibleText(fs.readFileSync(file, 'utf8'))
  if (visible.length > 0) scannedSurfaces++
  for (const banned of BANNED) {
    assert.ok(
      !visible.includes(banned),
      `${rel} 的用户可见文案仍含「${banned}」，需统一到「${MASTER_ROLE_NAME} / 我的真实画像 / 期待的长期关系」`
    )
  }
}
assert.ok(scannedSurfaces > 20, `可见文案抽取异常，仅覆盖 ${scannedSurfaces} 个文件`)

// pages.json 是受保护文件：若导航栏标题仍是旧称，必须以 WARN 显式暴露为验证缺口，
// 不能被本用例静默放行，也不由本用例越权修改。
const pagesJson = read('pages.json')
const protectedStale = BANNED.filter(term => pagesJson.includes(term))
if (protectedStale.length > 0) {
  console.log(`WARN 受保护文件 pages.json 的 navigationBarTitleText 仍含 ${protectedStale.join('、')}，需单独确认后修改`)
}

// ── 4. 栏目文案与品牌标识 ──────────────────────────────────────────────
// 两栏文案的落地位置是知遇首页双主体卡与画像结果页，不是他人主页。
const master = read('pagesSub', 'profileExtra', 'my-portrait-master.uvue')
assert.ok(visibleText(master).includes('我的真实画像'), '知遇首页 personal 栏须为「我的真实画像」')
assert.ok(visibleText(master).includes('期待的长期关系'), '知遇首页 ideal_partner 栏须为「期待的长期关系」')
const result = read('pagesSub', 'profileExtra', 'my-portrait-result.uvue')
assert.ok(visibleText(result).includes('我的真实画像'), '画像结果页 personal 标题须为「我的真实画像」')
assert.ok(visibleText(result).includes('期待的长期关系'), '画像结果页 ideal_partner 标题须为「期待的长期关系」')
// 品牌标识按 DESIGN.md 保留，不得被文案清扫误删
const detail = read('pagesSub', 'userExtra', 'user', 'detail.uvue')
assert.ok(detail.includes('知遇墨相 · 灵魂底色'), 'DESIGN.md 登记的「知遇墨相」卡片标识须保留')
assert.ok(read('components', 'moxiang', 'MoxiangPosterSheet.uvue').includes('墨相心帖'), '海报标题「墨相心帖」须保留')
assert.ok(read('utils', 'moxiang-poster-drawer.uts').includes('墨相'), '海报印章文案须保留')

// ── 5. 与 PRODUCT.md 对齐（文档是判据，不一致即为回归）────────────────
const productCandidates = [path.resolve(root, '..', 'PRODUCT.md'), path.join(root, 'PRODUCT.md')]
const productPath = productCandidates.find(p => fs.existsSync(p))
if (productPath) {
  const product = fs.readFileSync(productPath, 'utf8')
  assert.ok(product.includes(MASTER_ROLE_NAME), `PRODUCT.md 须登记统一后的角色名「${MASTER_ROLE_NAME}」`)
  assert.ok(product.includes('我的真实画像'), 'PRODUCT.md 须登记栏目「我的真实画像」')
  assert.ok(product.includes('期待的长期关系'), 'PRODUCT.md 须登记栏目「期待的长期关系」')
} else {
  console.log('SKIP test-role-copy-consistency.js PRODUCT.md 不在可访问路径，跳过文档比对')
}

console.log(`PASS role copy consistency: 角色名「${MASTER_ROLE_NAME}」，覆盖 ${scannedSurfaces} 个文件的用户可见文案`)
