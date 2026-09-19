/**
 * 展示真实性契约测试（第一批安全收尾 A3）。
 *
 * 锁定第一批+第二批的展示真实性改动不被回退：
 * - 真实 0 分显示 0%，无评分/缺数据显示 --，请求失败不渲染假分；
 * - 本地 mock 分析（MBTI 配对解析）不得回到正式展示；
 * - match_score 不得解释为"人气"；
 * - 认证标签必须来自后端 certification_tags 字段；
 * - 分数文案不得声称"已确认资料"（legacy-rule-v1 基于表单字段估算）。
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log('PASS ' + name)
}

const index = read('pages/index/index.uvue')
const sheet = read('components/XsaAiMatchSheet.uvue')
const search = read('pagesSub/profileExtra/search.uvue')
const detail = read('pagesSub/userExtra/user/detail.uvue')
const history = read('pagesSub/profileExtra/history.uvue')
const visitors = read('pagesSub/profileExtra/visitors.uvue')
const discoveryApi = read('api/discovery.uts')

check('首页环形分对 null 显示 --（区分真实 0 分与无评分）', () => {
  assert.ok(index.includes('if (user.matchScore == null) return \'--\''), 'aiScoreText must handle null')
  assert.ok(!index.includes('{{ currentRecommendUser.matchScore }}%'), 'raw matchScore interpolation must not return')
})

check('首页不再硬编码 MBTI 契合文案，改用后端 match_reason', () => {
  assert.ok(!index.includes('MBTI高度契合'), 'fabricated MBTI copy must stay removed')
  assert.ok(index.includes('currentRecommendUser.matchReason'), 'match_reason rendering must exist')
})

check('首页认证标签由 certification_tags 驱动且可隐藏', () => {
  assert.ok(index.includes('currentCertTags.length > 0'), 'cert section must be conditional')
  assert.ok(index.includes('user.certificationTags'), 'cert tags must come from backend field')
  assert.ok(!index.includes('>学历</text>'), 'hardcoded 学历认证 must not return')
  assert.ok(!index.includes('>头像</text>'), 'hardcoded 头像认证 must not return')
})

check('AI 匹配度弹窗不使用本地 mock 解析、不伪造 MBTI 类型', () => {
  assert.ok(!sheet.includes('getMbtiPairAnalysis'), 'mock analysis import must stay removed')
  assert.ok(!sheet.includes("'ENTP'"), 'fake ENTP default must stay removed')
  assert.ok(sheet.includes('state-unavailable'), 'unavailable state block must exist')
  assert.ok(sheet.includes('props.score == null'), 'scoreText must distinguish missing from real zero')
})

check('分数免责文案不声称"已确认"（legacy-rule-v1 基于表单字段）', () => {
  assert.ok(!sheet.includes('已确认资料'), 'sheet tip must not overclaim confirmed data')
  assert.ok(!detail.includes('已确认资料'), 'detail tip must not overclaim confirmed data')
})

check('搜索页伪造匹配数与理由不回退', () => {
  assert.ok(!search.includes('resultMatchCount'), 'resultMatchCount must stay removed')
  assert.ok(!search.includes('resultReasons'), 'resultReasons must stay removed')
})

check('match_score 不再解释为人气，缺失显示 --', () => {
  assert.ok(!history.includes('人气'), 'history must not show 人气')
  assert.ok(!visitors.includes('人气'), 'visitors must not show 人气')
  assert.ok(history.includes("compatText") && visitors.includes('compatText'), 'compatText mapping must exist')
  assert.ok(history.includes("'--'") && visitors.includes("'--'"), 'missing score renders --')
})

check('详情页区分真实 0 分与无评分', () => {
  assert.ok(detail.includes('user.matchAvailable'), 'detail must gate on matchAvailable')
})

check('mapCard 缺分回退为 null 而非 0', () => {
  assert.ok(discoveryApi.includes('Number(card.match) : null)'), 'mapCard must fall back to null')
})

console.log('====================================')
console.log('展示真实性契约测试：' + passed + ' 项全部通过')
