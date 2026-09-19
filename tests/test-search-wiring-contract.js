/**
 * 普通结构化搜索接线契约测试（第二批 B）。
 *
 * 锁定搜索页 → GET /discovery/recommendations 的接线语义：
 * - 参数映射只能来自带证据注释的 searchFilterMapping 模块；
 * - 分页 cursor 随筛选重置、load-more 只传 cursor、响应竞态有 runId 防护；
 * - 断链旧接口与 AI 入口保持关闭；
 * - 后端不支持的筛选（家乡/认证/MBTI/小学初中技校）保持禁用或隐藏。
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

const page = read('pagesSub/profileExtra/search.uvue')
const mapping = read('utils/searchFilterMapping.uts')
const userApi = read('api/user.uts')
const discoveryApi = read('api/discovery.uts')

check('搜索页数据源已接 /discovery/recommendations', () => {
  assert.ok(page.includes('getDiscoveryRecommendations(params)'), 'structured search must call recommendations API')
  assert.ok(page.includes('buildStructuredSearchParams'), 'params must go through the mapping module')
})

check('断链旧接口封装已清理且不再被引用', () => {
  assert.ok(!page.includes('getRecommendUsers'), 'search page must not reference getRecommendUsers')
  assert.ok(!userApi.includes("url: '/user/recommend/list'"), 'broken endpoint wrapper must be removed')
})

check('筛选变化重置旧结果与旧 cursor', () => {
  assert.ok(page.includes("nextCursor.value = ''") && page.includes('hasMore.value = false'), 'cursor/hasMore reset on new search')
  assert.ok(page.includes('resultCandidates.value = []'), 'old results cleared on new search')
})

check('加载更多只传 cursor，不与 page 混用', () => {
  const loadMore = page.slice(page.indexOf('const loadMoreResults'))
  assert.ok(loadMore.includes('params.cursor = nextCursor.value'), 'load-more must pass cursor')
  assert.ok(!/params\.page\s*=/.test(loadMore), 'load-more must not set page together with cursor')
})

check('并发竞态防护：响应到达时校验 runId', () => {
  const loadMore = page.slice(page.indexOf('const loadMoreResults'))
  assert.ok(page.includes('if (runId != searchRunId) return'), 'stale responses must be discarded')
  assert.ok(loadMore.includes('if (runId != searchRunId) return'), 'load-more discards stale responses')
})

check('AI 入口保持关闭，不用普通搜索冒充', () => {
  assert.ok(!page.includes('await generateIdealPartner()'), 'ideal-partner call stays removed')
  assert.ok(page.includes('AI 觅遇暂未开放'), 'tab0 must state unavailable')
  assert.ok(page.includes('MBTI 筛选暂未开放'), 'tab1 must state unavailable')
  assert.ok(page.includes('AI 猜你喜欢暂未开放'), 'suggest trigger must state unavailable')
})

check('后端不支持的筛选保持禁用/隐藏', () => {
  assert.ok(page.includes('暂不支持：筛选接口暂无认证字段'), 'certification toggle disabled with reason')
  assert.ok(page.includes('暂不支持：筛选接口暂无家乡字段'), 'hometown filter disabled with reason')
  assert.ok(!page.includes("'小学'"), '小学 not representable in storage domain')
  assert.ok(!page.includes("'技校'"), '技校 not representable in storage domain')
  assert.ok(page.includes('按所选学历及以上筛选'), 'education semantics stated in UI')
})

check('映射模块：学历/婚况/地区/收入均有代码证据来源', () => {
  assert.ok(mapping.includes('educationOptions 数组下标即编号'), 'education domain evidence')
  assert.ok(mapping.includes('marriage_statuses'), 'marriage dictionary evidence')
  assert.ok(mapping.includes('data/location.json'), 'city code source evidence')
  assert.ok(mapping.includes('stopWan * 10000'), 'income unit conversion evidence')
  assert.ok(mapping.includes('respect_preferences'), 'combination semantics documented')
})

check('mapPage 透传 next_cursor 供游标分页', () => {
  assert.ok(discoveryApi.includes('nextCursor: body.next_cursor'), 'cursor passthrough required')
})

console.log('====================================')
console.log('搜索接线契约测试：' + passed + ' 项全部通过')
