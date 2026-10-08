/**
 * §5 首页固定匹配解读契约测试。
 *
 * 本轮要求（用户端精准修复实施清单 §5）：
 *   1. 沿用正式分数来源与 engine 标识，停止展示生成式 reason_texts，
 *      改由当前允许展示的 evidence（displayable=true）按 reason_code 输出固定话术；
 *   2. 保留 ready + display_eligible 门槛、202 轮询、request sequence、关闭取消；
 *   3. 缺数/错误/资料不足只显示对应状态，不用假分补位；不加 80 分「天作之合」等阈值；
 *   4. 未知 reason_code 忽略，不反向推测「不满足」；不添加数据不支持的指标。
 *
 * 手法：读取真实源码做结构断言（与 test-display-honesty-contract.js 一致）。
 */
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
// 跨仓路径统一走 tests/helpers/cross-repo.cjs：CI 把后端检出到 backend-contract，
// 硬编码 ../xuanshiai-backend 在干净检出里必然读不到。
const { readBackend } = require('./helpers/cross-repo.cjs')

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log('PASS ' + name)
}

const sheet = read('components/XsaAiMatchSheet.uvue')
const backend = readBackend('app/services/ai/compatibility.py')
if (backend == null) {
  console.log('SKIP test-match-interpretation-fixed-copy.js 后端源码不可达（设置 XSA_BACKEND_ROOT 可启用跨仓断言）')
  process.exit(0)
}

check('停止展示生成式 reason_texts', () => {
  // 只允许注释里提到旧字段名，不得再有任何读取代码。
  assert.ok(!/compatibility\.value\.reason_texts/.test(sheet), 'reason_texts 不得再被读取')
  assert.ok(!/reasons\[keys\[i\]\]/.test(sheet), 'reason_texts 遍历逻辑必须删除')
})

check('固定话术白名单与后端 _EVIDENCE_LIMITATIONS 一一对应', () => {
  const codes = [
    'AGE_MUTUAL_WITHIN_RANGE',
    'CITY_MUTUAL_ACCEPTED',
    'MARRIAGE_MUTUAL_ACCEPTED',
    'EDUCATION_MUTUAL_WITHIN_RANGE',
    'HEIGHT_MUTUAL_WITHIN_RANGE',
    'INCOME_MUTUAL_WITHIN_RANGE',
    'INTEREST_OVERLAP',
    'RELATIONSHIP_GOAL_SHARED'
  ]
  for (const code of codes) {
    assert.ok(sheet.includes(code + ':'), `前端白名单必须包含 ${code}`)
    assert.ok(backend.includes(`REASON_${code.split('_')[0]}`) || backend.includes(code),
      `后端字典必须包含 ${code}（两边不得漂移）`)
  }
})

check('未知 reason_code 忽略，不反向推测「不满足」', () => {
  assert.ok(/const template = REASON_CODE_TEMPLATES\[code\] != null \? REASON_CODE_TEMPLATES\[code\] : REASON_CODE_NOTES\[code\]/.test(sheet),
    '必须按白名单取值，未知码取不到模板')
  assert.ok(/if \(template == null \|\| template == ''\) continue/.test(sheet),
    '未知码必须直接跳过')
  const templateBlock = sheet.slice(
    sheet.indexOf('const REASON_CODE_TEMPLATES'),
    sheet.indexOf('const REASON_CODE_NOTES')
  )
  assert.ok(!/不满足|不符合|不匹配/.test(templateBlock), '固定话术字典不得反向推测「不满足」')
})

check('展示项只取 displayable=true，且不得泄漏未知码 limitation', () => {
  assert.ok(/if \(item == null \|\| item\.displayable != true\) return false/.test(sheet),
    '展示项必须过滤 displayable')
  assert.ok(/REASON_CODE_TEMPLATES\[code\] == null && REASON_CODE_NOTES\[code\] == null/.test(sheet),
    '未知码不得经 limitation 字段泄漏')
})

check('分数用「分/100」语义，不加阈值结论', () => {
  assert.ok(sheet.includes("'分/100'"), '分数文案必须使用分/100 语义')
  assert.ok(!sheet.includes('天作之合'), '不得添加 80 分「天作之合」等阈值结论')
  assert.ok(!sheet.includes('不合适'), '不得添加 60 分「不合适」等阈值结论')
  assert.ok(sheet.includes('不代表关系结果或成功概率'), '必须说明指数语义，不写成成功率')
})

check('保留既有门禁、轮询、请求代际与关闭取消', () => {
  assert.ok(sheet.includes("result.status == 'ready'"), 'ready 门槛必须保留')
  assert.ok(sheet.includes('result.display_eligible == true'), 'display_eligible 门槛必须保留')
  assert.ok(sheet.includes('waitForCompatibilityTask'), '202 轮询必须保留')
  assert.ok(sheet.includes('requestSequence'), '请求 sequence 必须保留')
  assert.ok(sheet.includes('getCompatibility(targetId)'), '正式分数来源必须保留')
})

check('状态文案齐全：coverage 不足 / stale / blocked / 不可展示', () => {
  assert.ok(sheet.includes("result.status == 'stale'"), 'stale 状态必须存在')
  assert.ok(sheet.includes("result.status == 'blocked'"), 'blocked 状态必须存在')
  assert.ok(sheet.includes("result.status == 'coverage_insufficient'"), 'coverage 不足状态必须存在')
  assert.ok(sheet.includes("result.status == 'ready' && result.display_eligible != true"), '不可展示状态必须存在')
})

console.log('====================================')
console.log('固定匹配解读契约测试：' + passed + ' 项全部通过')
