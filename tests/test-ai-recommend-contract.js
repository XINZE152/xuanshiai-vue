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

check('首页三个视图分别映射后端枚举', () => {
  assert.ok(page.includes("key: 'i_like'"), 'i_like view tab must exist')
  assert.ok(page.includes("key: 'likes_me'"), 'likes_me view tab must exist')
  assert.ok(page.includes("key: 'similar'"), 'similar view tab must exist')
  assert.ok(page.includes('getAiRecommendations'), 'home must call AI recommendations')
})

check('首页区分加载、重建中、正常空结果与失败重试', () => {
  assert.ok(page.includes('recommendationLoading'), 'loading state must exist')
  assert.ok(page.includes('recommendationRegenerating'), 'regenerating state must exist')
  assert.ok(page.includes('演示模式没有正式推荐结果'), 'mock state must not claim formal recommendations')
  assert.ok(page.includes('重新加载'), 'error/empty states need a retry entry')
  assert.ok(page.includes('recommendationRegenerating && recommendUsers.length === 0'), 'regenerating gate must not hide already available cards')
})

check('首页消费服务端公开名片且不批量读取完整主页', () => {
  assert.ok(page.includes('item.card'), 'home must consume the returned public card')
  assert.ok(!page.includes('getUserDetail(item.targetUserId)'), 'home must not preload full profile detail')
  assert.ok(!page.includes('Promise.all(items.map'), 'home must not batch-load full profile details')
  assert.ok(page.includes('recommendationReason'), 'recommendation explanation must remain separate from compatibility score')
})

check('regenerating 不触发任务地址拼接或无限轮询', () => {
  assert.ok(!page.includes('/ai/tasks/' + "' +"), 'home must not construct task polling URL')
  assert.ok(!page.includes('waitForRecommendationTask'), 'home must not invent recommendation task polling')
})

console.log('====================================')
console.log('AI 三类推荐契约测试：' + passed + ' 项全部通过')
