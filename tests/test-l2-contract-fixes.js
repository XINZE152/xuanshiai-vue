/**
 * L2 批（首页部分）源码契约：F-09 卡片直出字段 + F-13 预览接口免计费。
 *
 * 背景：后端 A 批（38da5a1）已在 `DiscoveryCard` 直接下发
 * weight / hometown_display / residence_display / zodiac / self_intro / qa_answers，
 * 并新增 `GET /users/{id}/card-preview`（不扣 browse、不写 user_browse_history、不返回 profile）。
 * 因此前端首页不该再为 9 格发第二次 `/users/{id}/profile`——那会扣额度、留访客痕迹，还可能 429。
 *
 * 只做源码契约断言，不依赖 node_modules。
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

const discoveryApi = read('api/discovery.uts')
const apiIndex = read('api/index.uts')
const indexPage = read('pages/index/index.uvue')

// ========== F-09：卡片直出字段 ==========

assert.match(
  discoveryApi,
  /hometownDisplay: card\.hometown_display != null/,
  'mapCard 必须映射 hometown_display（后端 A-2 新增）'
)
assert.match(
  discoveryApi,
  /residenceDisplay: card\.residence_display != null/,
  'mapCard 必须映射 residence_display'
)
assert.match(
  discoveryApi,
  /hometown: card\.hometown_display != null/,
  '家乡展示必须优先用 hometown_display，而不是裸 hometown/code'
)
assert.match(
  indexPage,
  /currentRecommendUser\.value\.residenceDisplay \|\| locationTextByCityCode/,
  '现居必须优先用服务端解析好的 residenceDisplay，缺值才回落城市码'
)

// ========== F-13：首页只拉 card-preview ==========

assert.match(
  discoveryApi,
  /export async function getUserCardPreview\(userId: number\)/,
  '必须提供 getUserCardPreview()'
)
assert.match(
  discoveryApi,
  /url: '\/users\/' \+ userId \+ '\/card-preview'/,
  '预览接口路径必须是 /users/{id}/card-preview'
)
assert.match(apiIndex, /getUserCardPreview,/, '@/api 必须导出 getUserCardPreview')
assert.match(
  indexPage,
  /import \{[^}]*getUserCardPreview[^}]*\} from '@\/api'/,
  '首页必须从统一入口引入 getUserCardPreview'
)

// 首页不得再调 getUserDetail（那是计费 + 留痕的详情接口）
assert.doesNotMatch(
  indexPage,
  /getUserDetail/,
  '首页不得再调用 getUserDetail：它扣浏览额度并写 user_browse_history'
)
assert.doesNotMatch(
  indexPage,
  /showQuotaExhausted\(res\.message/,
  '预览接口不会 429，首页背景加载里不应再有 429 分支'
)
// 二次详情富化整段应已删除
assert.doesNotMatch(
  indexPage,
  /profile\.photos != null && Array\.isArray\(profile\.photos\)/,
  '首页不应再用二次详情返回的 profile.photos 富化卡片'
)
// 卡片不带 birthday，端侧推算星座只会得到空串
assert.doesNotMatch(
  indexPage,
  /const zodiacFromBirthday/,
  '首页不应保留端侧生日推星座（卡片不带 birthday，A-2 后直接用 card.zodiac）'
)

console.log('PASS L2 首页契约：9 格直取卡片字段 + 背景走 card-preview（不扣额度、不留痕）')

// ========== F-02：喜欢改为显式目标态，不再分页扫 /relations/likes ==========

const userApi = read('api/user.uts')
const detailPage = read('pagesSub/userExtra/user/detail.uvue')

assert.match(
  userApi,
  /export async function likeUser\(userId: number, liked: boolean, internalMockScope: string = ''\)/,
  'likeUser 必须接收显式目标态 liked，而不是自己猜当前状态'
)
assert.match(userApi, /method: liked \? 'PUT' : 'DELETE'/, '喜欢/取消必须由目标态直接决定 PUT/DELETE')
assert.doesNotMatch(
  userApi,
  /url: '\/relations\/likes',\s*\n\s*method: 'GET',\s*\n\s*data: \{ page: page, page_size: pageSize \}/,
  'likeUser 不得再分页扫 /relations/likes 判断当前态（最多 50×N 次请求）'
)
assert.match(indexPage, /likeUser\(id, !isLiked\(id\)\)/, '首页点击喜欢必须传 !当前态')
assert.match(detailPage, /likeUser\(id, !isLikedUser\.value\)/, '详情页点击喜欢必须传 !当前态')

// ========== F-03：删掉本地额度硬拦截 + 余额读 /users/me/quotas ==========

assert.doesNotMatch(read('components/XsaApplySheet.uvue'), /remain\.value <= 0/, '申请 Sheet 不得再用本地 remain 提前拦截')
assert.doesNotMatch(read('components/ParentApplySheet.uvue'), /remainingApplications <= 0/, '红娘申请 Sheet 不得再用本地次数禁用按钮')
assert.doesNotMatch(read('pagesSub/community/paper-plane.uvue'), /remain\.value <= 0/, '纸飞机页不得再用本地 remain 拦截')
assert.doesNotMatch(read('pagesSub/community/dating-plane-compose.uvue'), /remain\.value <= 0/, '交友飞机页不得再用本地 remain 拦截')
// 本地额度耗尽不得直接出错误页（服务端 429 分支仍保留该文案，属正常）
assert.doesNotMatch(
  detailPage,
  /recordProfileView\(parsed\)\) \{\s*\n\s*detailQuotaExhausted/,
  '详情页不得再用本地 recordProfileView 失败直接置额度错误页'
)

const pointsApi = read('api/points.uts')
assert.match(pointsApi, /export async function getMyQuotas\(\)/, '必须提供 getMyQuotas()')
assert.match(pointsApi, /url: '\/users\/me\/quotas'/, '额度必须读 /users/me/quotas')
assert.match(pointsApi, /totalRemaining: Number\(row\.total_remaining/, 'total_remaining 必须映射（含积分加次）')
assert.match(apiIndex, /getMyQuotas,/, '@/api 必须导出 getMyQuotas')

// ========== F-07：申请失败按业务码分流 ==========

const applySheet = read('components/XsaApplySheet.uvue')
for (const code of ['PROFILE_INCOMPLETE', 'PHONE_REQUIRED', 'REALNAME_REQUIRED', 'APPLICATION_RESTRICTED']) {
  assert.ok(applySheet.includes(`biz == '${code}'`), `申请失败必须分流 ${code}`)
}
assert.match(applySheet, /httpCode == 409/, '已有进行中申请（409）必须单独提示')
assert.match(applySheet, /httpCode == 429/, '额度用完（429）必须引导去兑换')
assert.match(applySheet, /businessCode/, '必须读 request 层提取的 businessCode，而不是只看 HTTP 码')

console.log('PASS L2 契约：红心目标态 + 本地硬拦截清零 + 额度读 /users/me/quotas + 申请失败分流')
