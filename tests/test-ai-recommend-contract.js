/**
 * S5 三类推荐前端契约测试。
 * 锁定推荐服务的真实边界：三种 view 走 /ai/recommendations，
 * 推荐接口只提供 target_user_id/解释，regenerating 不携带任务轮询语义。
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const api = read('api/ai-recommend.uts')
const index = read('api/index.uts')
const page = read('pages/index/index.uvue')

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log('PASS ' + name)
}

check('推荐客户端使用 AI 推荐接口并传 view/limit', () => {
  assert.ok(api.includes("url: '/ai/recommendations'"), 'must use AI recommendation route')
  assert.ok(api.includes('view: normalizedView'), 'view must be sent as a query parameter')
  assert.ok(api.includes('limit: normalizedLimit'), 'limit must be sent as a query parameter')
  assert.ok(api.includes('include_card: true'), 'new client must explicitly request public cards')
  assert.ok(api.includes("'i_like'") && api.includes("'likes_me'") && api.includes("'similar'"), 'all three views must be supported')
})

check('推荐卡适配 target_user_id、解释与公开名片', () => {
  assert.ok(api.includes('item.target_user_id'), 'candidate id must come from target_user_id')
  assert.ok(api.includes('item.reason_codes'), 'reason codes must be adapted')
  assert.ok(api.includes('item.reason_texts'), 'reason texts must be adapted')
  assert.ok(api.includes('item.card'), 'public card must be preserved when returned')
  assert.ok(!api.includes('task_id:'), 'recommendation response must not invent task_id field')
})

check('regenerating 只返回后台重建状态，不自行轮询', () => {
  assert.ok(api.includes('regenerating: body.regenerating == true'), 'regenerating must be preserved')
  assert.ok(!api.includes('pollTask'), 'recommendations must not poll without task_id')
  assert.ok(!api.includes('setInterval'), 'recommendations must not create an endless poller')
})

check('统一 API 导出推荐客户端', () => {
  assert.ok(index.includes("from './ai-recommend.uts'"), 'ai recommendation API must be exported')
  assert.ok(index.includes('getAiRecommendations'), 'getAiRecommendations must be exported')
})

check('首页主候选回到发现推荐链路，不再依赖三分类改造', () => {
  assert.ok(page.includes('getDiscoveryRecommendations'), 'home must call the existing discovery recommendations')
  assert.ok(!page.includes('getAiRecommendations'), 'home must not depend on the three-view AI recommend client')
  assert.ok(!page.includes("key: 'i_like'"), 'home must not render three-view tabs')
  assert.ok(!page.includes('item.card'), 'home must not require an item.card field the backend does not return')
  assert.ok(!page.includes('公开介绍需主动查看完整资料'), 'home must not overwrite real intro with fixed copy')
})

check('发现接口响应形状能组装出首页可用名片（行为验证）', () => {
  const discoverySrc = read('api/discovery.uts')
  const start = discoverySrc.indexOf('function mapCard')
  const end = discoverySrc.indexOf('function mapPage')
  assert.ok(start >= 0 && end > start, 'discovery client must ship a real card mapper')
  let mapCardSrc = discoverySrc.slice(start, end)
  mapCardSrc = mapCardSrc
    .replace(/ as any\[\]/g, '')
    .replace(/: any\[\]/g, '')
    .replace(/: string\[\]/g, '')
    .replace(/: any/g, '')
  const mapCard = new Function('resolveMediaUrl', mapCardSrc + '\nreturn mapCard;')(
    (value) => (value != null && value !== '' ? 'media:' + value : '')
  )
  // 模拟 /discovery/recommendations 真实返回行（snake_case 后端字段）。
  const backendRow = {
    user_id: 42,
    nickname: '真实候选',
    avatar: '/storage/a.webp',
    age: 29,
    height_cm: 172,
    weight_kg: 60,
    gender: 'female',
    education_level: '本科',
    occupation: '设计师',
    city_code: '320100',
    hometown: '南京',
    income: '20-30万',
    bio: '喜欢长跑与看展',
    online_status: 1,
    mbti: 'INFJ',
    personal_tags: ['跑步', '看展'],
    certification_tags: ['实名认证'],
    distance_km: 3.5,
    match_score: 87,
    view_count: 12
  }
  const card = mapCard(backendRow)
  assert.equal(card.id, 42, 'card id must come from user_id')
  assert.equal(card.name, '真实候选', 'card name must come from nickname')
  assert.equal(card.bio, '喜欢长跑与看展', 'real intro must survive mapping')
  assert.deepEqual(card.interestTags, ['跑步', '看展'], 'tags must survive mapping')
  assert.equal(card.certificationTags.length, 1, 'certification tags must survive mapping')
  assert.equal(card.online, true, 'online must be derived from online_status')
  assert.equal(card.distance, 3.5, 'distance must survive mapping')
  assert.equal(card.education, '本科', 'education must survive mapping')
})

check('首页仅补全当前展示对象的资料，合拍入口使用真实结果', () => {
  assert.ok(page.includes('getUserDetail'), 'home enriches only the currently displayed card via detail API')
  assert.ok(!page.includes('Promise.all(items.map'), 'home must not batch-load full profile details')
  assert.ok(page.includes(':target-user-id="recommendUserId"'), 'compatibility sheet must read the real compatibility result')
  assert.ok(!page.includes('aiScoreText'), 'home must not restore the fake recommendation-score ring')
})

check('regenerating 不触发任务地址拼接或无限轮询', () => {
  assert.ok(!page.includes('/ai/tasks/' + "' +"), 'home must not construct task polling URL')
  assert.ok(!page.includes('waitForRecommendationTask'), 'home must not invent recommendation task polling')
})

console.log('====================================')
console.log('AI 三类推荐契约测试：' + passed + ' 项全部通过')
