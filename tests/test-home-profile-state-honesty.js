/**
 * H 组（首页 / 我的）状态真实性契约测试。
 *
 * 钉住本轮修复，防回归：
 *   H1  我的页画像卡必须按 continuous_v2 双快照真实状态分流，不再「接口成功即已生成」；
 *       状态读取失败显示「状态暂未读取」并给重试，不冒充新用户/生成成功；
 *       卡片文案与点击落地页共用同一状态判断。
 *   H2  首页动态请求带 targetId + 代际，每个 await 后与写入前都校验；
 *       切换对象先作废旧动态；分身快照只取属于当前对象且属于当前对象的动态。
 *   H3  首页推荐/广场/我的概览各自独立 loading/error/empty/data 四态；
 *       我的页统计缺失用「—」，昵称不因概览失败永久停在「加载中」。
 *   H4  所有距离走同一存在性判断（null 不显示 0km，真实 0 正常显示）；
 *       无权威来源的在册人数与倍数隐藏。
 *   H5  资料完整度与会员权益区分；本人头像/MBTI 缓存返回首页时失效。
 *
 * 手法：读取真实源码做结构断言（与 test-home-recommend-display.js 一致）。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const index = read('pages/index/index.uvue')
const profile = read('pages/profile/profile.uvue')
const discoveryApi = read('api/discovery.uts')

// ── H1：我的页画像状态映射 ────────────────────────────────────────────
assert.ok(profile.includes('getContinuousMoxiangState'), 'H1 我的页必须读取双画像真实状态')
assert.ok(profile.includes("data.status != 'confirmed'") && profile.includes("String(data.revision_id ?? '') != revisionId"), 'H1 徽章必须绑定已确认个人画像的同一正式版本')
assert.ok(profile.includes("portraitState.value = 'unknown'"), 'H1 读取失败必须落到 unknown 状态')
assert.ok(profile.includes('状态暂未读取'), 'H1 unknown 状态文案必须如实说明状态未读取')
assert.ok(!profile.includes("portraitTag.value = '已生成'") || profile.indexOf("portraitTag.value = '已生成'") > profile.indexOf('applyPortraitStateCopy'),
  'H1「已生成」只能由统一状态映射在 ready 分支写入，不得在接口成功回调里直接赋值')
assert.ok(profile.includes('const portraitHasResult = computed'), 'H1 文案与点击必须共用同一状态判断')
assert.ok(profile.includes('openPortraitDestination'), 'H1 点击分流必须复用同一状态映射')
assert.ok(profile.includes('loadPortraitState().then'), 'H1 状态未知时先重试读取再决定去向')
assert.ok(profile.includes('seq != portraitReadSeq') && profile.includes('onHide(hidePortraitState)'), 'H1 后台/撤权后迟到私密响应必须失效')
assert.ok(profile.includes('my-portrait-archive?flow_version=continuous_v2'), 'H1 待确认稿进双画像档案，不走旧发布入口')

// ── H2：首页动态对象串号 ─────────────────────────────────────────────
assert.ok(index.includes('feedDynamicsTargetId'), 'H2 动态请求必须记录 targetId')
assert.ok(index.includes('feedDynamicsSeq'), 'H2 动态请求必须记录代际')
assert.ok(index.includes('isFeedDynamicsAlive'), 'H2 每个 await 后必须校验目标与代际')
assert.ok(index.includes('invalidateFeedDynamics()'), 'H2 切换对象必须作废旧动态')
assert.ok(/dynamicSummary:\s*feedDynamicsTargetId\.value == id/.test(index), 'H2 分身快照只能取属于当前对象的动态')

// ── H3：四态与请求代际 ───────────────────────────────────────────────
assert.ok(index.includes('const recommendLoading = ref(false)'), 'H3 推荐区块必须有独立 loading')
assert.ok(index.includes('recommendLoading && recommendUsers.length === 0'), 'H3 初次加载必须与空态互斥')
assert.ok(index.includes("!recommendLoading && recommendUsers.length === 0 && discoveryError == ''"), 'H3 空态必须排除加载中')
assert.ok(index.includes('squareError'), 'H3 广场必须有局部错误态')
assert.ok(index.includes('homeRefreshSeq'), 'H3 首页整体刷新必须有请求代际')
assert.ok(profile.includes("overviewError.value = '资料概览暂时无法加载'"), 'H3 概览失败必须有局部错误')
assert.ok(profile.includes('overview-error-retry'), 'H3 概览失败必须有重试入口')
assert.ok(profile.includes(": '—'"), 'H3 统计缺失必须显示「—」而非 0')

// ── H4：距离与在册人数真实性 ─────────────────────────────────────────
assert.ok(discoveryApi.includes('card.distance_km != null ? Number(card.distance_km) : null'), 'H4 mapCard 缺失距离必须返回 null')
assert.ok(index.includes("'距离未公开'"), 'H4 距离缺失必须如实说明未公开')
assert.ok(index.includes('const distanceLabel = (item: any): string =>'), 'H4 所有距离展示必须共用同一函数')
assert.equal(index.match(/距你 \{\{/g), null, 'H4 模板不得再直连 distance 插值（必须走 distanceLabel）')
assert.ok(/sloganSuffix: '，被更多人看见。'/.test(index), 'H4 不得保留无来源的「4 倍」营销倍数')
assert.ok(/threshold: '形象认证通过 · 真人核验', count: null/.test(index), 'H4 无权威来源的在册人数必须隐藏')

// ── H5：完整度语义与本人缓存失效 ─────────────────────────────────────
assert.ok(profile.includes('资料完整度'), 'H5 必须明确标注资料完整度')
assert.ok(index.includes('aiProfileLoaded.value = false'), 'H5 返回首页必须作废本人头像/MBTI 缓存')
assert.ok(/aiProfileLoaded\.value = mbtiOk && avatarOk/.test(index), 'H5 读取失败不得标记为已加载')

console.log('PASS home/profile state honesty: H1-H5 状态与数据真实性契约全部满足')
