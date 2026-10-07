// audit-item-5: 首页推荐恢复「已确认的旧展示」（第 7 项接线，判据来自第 5 项 + 假设 A）
//
// 审计问题：首页被改成三视图（我喜欢的/喜欢我的/相似）新推荐，偏离已确认的旧展示。
// 修复契约（钉住以下行为，防回归）：
//   1. 首页数据源是 api/discovery.uts 的 getDiscoveryRecommendations（GET /discovery/recommendations），
//      以 { page: 1, page_size: 20 } 调用，返回经 mapPage/mapCard 归一后直接进入 recommendUsers；
//   2. 三视图 Tab 及其状态机（recommend-view-tabs / recommendViewOptions / switchRecommendView /
//      recommendView / RecommendationView / i_like / likes_me / similar 视图键）不得回流首页；
//   3. 加载失败展示 discoveryError + 「重新加载」重试入口，空结果有独立空态；
//   4. mapCard 标签兜底链 personal_tags → interest_tags → tags（与 6b 后端展示口径一致）。
// 手法：沙箱执行 api/discovery.uts 真实源码片段（babel 去类型 + vm 执行），request 用桩记录调用。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const apiSource = fs.readFileSync(path.join(root, 'api', 'discovery.uts'), 'utf8')
const homeSource = fs.readFileSync(path.join(root, 'pages', 'index', 'index.uvue'), 'utf8')

/** 从 source 的 startIndex 起按花括号配平切出一段声明 */
function sliceBalanced(src, startIndex) {
  const open = src.indexOf('{', startIndex)
  if (open < 0) throw new Error('未找到起始花括号')
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(startIndex, i + 1)
    }
  }
  throw new Error('花括号未配平')
}

// ── A. 沙箱执行 mapCard + mapPage + getDiscoveryRecommendations ──────────
const apiStart = apiSource.indexOf('function mapCard')
const apiEnd = apiSource.indexOf('export async function getDiscoveryPlaza')
assert.ok(apiStart >= 0 && apiEnd > apiStart, 'api/discovery.uts 必须能切出 mapCard…getDiscoveryRecommendations 片段')
const apiFragment = apiSource
  .slice(apiStart, apiEnd)
  .replace(/\bexport\s+async function\b/g, 'async function')
const wrapped = ['(function () {', apiFragment, 'return { mapCard, mapPage, getDiscoveryRecommendations };', '})()'].join(String.fromCharCode(10))
const compiled = babel.transformSync(wrapped, {
  filename: 'discovery-fragment.ts',
  configFile: false,
  babelrc: false,
  plugins: ['@babel/plugin-transform-typescript']
}).code

function apiSandbox(result) {
  const sent = []
  const ctx = {
    request: async (opts) => { sent.push(opts); return result },
    resolveMediaUrl: (u) => 'https://cdn.test/' + String(u),
    mockRecommendUsers: []
  }
  const fns = vm.runInNewContext(compiled, ctx)
  return { fns, sent, ctx }
}

async function main() {
  // A1. 请求形状：GET /discovery/recommendations，filters 原样透传
  const okResult = {
    success: true,
    code: 0,
    message: '',
    data: {
      items: [
        {
          user_id: 42, nickname: '小宣', age: 28, city: '杭州',
          personal_tags: ['登山', '烘焙'], interest_tags: ['应被 personal_tags 覆盖'],
          avatar: 'a.webp', photos: ['p1.webp', 'p1.webp', 'p2.webp'],
          match_score: 88, has_more: true
        },
        { target: { id: 7, name: '小爱', tags: ['骑行'] } }
      ],
      page: 1, page_size: 20, total: 2, has_more: true, next_cursor: 'c-9'
    }
  }
  const a = apiSandbox(okResult)
  const page = await a.fns.getDiscoveryRecommendations({ page: 1, page_size: 20 })
  assert.equal(a.sent.length, 1, '一次调用只发一次请求')
  assert.equal(a.sent[0].url, '/discovery/recommendations', '数据源是 /discovery/recommendations')
  assert.equal(a.sent[0].method, 'GET', '推荐列表是 GET')
  assert.deepEqual(a.sent[0].data, { page: 1, page_size: 20 }, '分页参数原样透传')
  assert.equal(page.success, true)
  const items = Array.from(page.data.items)
  assert.equal(items.length, 2, '分页 items 全部映射')
  assert.equal(items[0].id, 42, 'user_id 映射为 id')
  assert.equal(items[0].name, '小宣')
  assert.deepEqual(Array.from(items[0].interestTags), ['登山', '烘焙'], '标签链 personal_tags 优先')
  assert.deepEqual(Array.from(items[0].photos), ['https://cdn.test/p1.webp', 'https://cdn.test/p2.webp'], '照片去重且走 resolveMediaUrl')
  assert.equal(items[0].matchScore, 88)
  // A2. target 解包 + 标签兜底链末端 tags
  assert.equal(items[1].id, 7, 'target 包裹的推荐可解包')
  assert.equal(items[1].name, '小爱')
  assert.deepEqual(Array.from(items[1].interestTags), ['骑行'], 'personal/interest 缺失时兜底 tags')
  // A3. 分页元信息与游标
  assert.equal(page.data.page, 1)
  assert.equal(page.data.pageSize, 20)
  assert.equal(page.data.total, 2)
  assert.equal(page.data.hasMore, true, 'has_more 归一为 hasMore')
  assert.equal(page.data.nextCursor, 'c-9', 'next_cursor 归一为 nextCursor')
  // A4. 无 filters 时 data 为空对象（不再存在 view 参数位）
  const b = apiSandbox({ success: true, data: { items: [] } })
  await b.fns.getDiscoveryRecommendations()
  assert.equal(JSON.stringify(b.sent[0].data), '{}', '缺省 filters 传空对象，请求里不得混入 view 等新参数')
  // A5. 失败原样透传（首页据此展示 discoveryError）
  const failResult = { success: false, code: 401, message: '登录已过期', data: null }
  const c = apiSandbox(failResult)
  const failOut = await c.fns.getDiscoveryRecommendations({ page: 1, page_size: 20 })
  assert.equal(failOut.success, false)
  assert.equal(failOut.message, '登录已过期', '失败 message 透传给首页错误态')

  // ── B. 首页结构：旧展示 + 无三视图回流 ────────────────────────────────
  assert.match(homeSource, /import \{[^}]*getDiscoveryRecommendations[^}]*getDiscoveryPlaza[^}]*\} from '@\/api'/, '首页从 @/api 引入旧推荐与广场接口')
  const loaderStart = homeSource.indexOf('const loadHomeDiscovery = async () =>')
  assert.ok(loaderStart >= 0, '首页必须有 loadHomeDiscovery')
  const loader = sliceBalanced(homeSource, loaderStart)
  assert.ok(loader.includes('getDiscoveryRecommendations({ page: 1, page_size: 20 })'), 'loadHomeDiscovery 以 { page: 1, page_size: 20 } 调旧推荐接口')
  assert.ok(loader.includes('getDiscoveryPlaza({ page: 1, page_size: 20 })'), '广场数据同源加载')
  assert.ok(loader.includes('recommendUsers.value = recommendRes.data.items'), '推荐结果直接进入 recommendUsers（旧单列表展示）')
  assert.ok(/discoveryError\.value = message != '' \? message : '请检查登录状态和网络后重试'/.test(loader), '失败写入 discoveryError（断网/未登录文案）')

  // 三视图工件不得回流
  const banned = [
    ['recommend-view-tabs', /recommend-view-tabs/],
    ['recommendViewOptions', /recommendViewOptions/],
    ['switchRecommendView', /switchRecommendView/],
    ['recommendView（状态/props）', /\brecommendView\b/],
    ['RecommendationView 类型', /RecommendationView/],
    ['i_like 视图键', /['"]i_like['"]/],
    ['likes_me 视图键', /['"]likes_me['"]/],
    ['similar 视图键', /['"]similar['"]/],
    ['view= 查询参数', /[?&]view=|\bview:\s*['"]/]
  ]
  for (const [label, re] of banned) {
    assert.ok(!re.test(homeSource), `三视图工件不得回流首页：${label}`)
  }

  // 状态覆盖：错误重试入口、空态、成功卡片
  assert.match(homeSource, /@tap="loadHomeDiscovery"><text>重新加载<\/text>/, '错误态必须有「重新加载」重试入口')
  assert.match(homeSource, /recommendUsers\.length === 0 && discoveryError == ''/, '空结果有独立空态且与错误态互斥')
  assert.match(homeSource, /v-else-if="recommendUsers\.length > 0" class="profile-card"/, '成功态渲染旧推荐卡片')
  assert.match(homeSource, /const recommendUsers = ref<any\[\]>\(\[\]\)/, 'recommendUsers 仍是首页唯一推荐列表源')

  console.log('PASS home recommend display: 旧推荐接口回归 + 三视图工件零回流 + 错误/空/成功态齐备')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
