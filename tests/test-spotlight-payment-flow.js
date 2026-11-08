// 爆灯流程契约（2026-10-26 起：详情页改为「免费额度爆灯」，不走支付）
// 变更背景：付费链路需要「下单 + POST /payments/test/pay 履约」两步，且后端价格写死
// 5.00 与前端 9.9 冲突；本轮按产品结论改为免费额度（POST /discovery/superlikes/{id}，
// 普通号 1 次/天、VIP 3 次/天，额度扣减与「收到爆灯」通知都由后端完成）。
// 付费版本保留在 api/spotlight.uts 的 paySpotlight 里，待价格口径统一后作为方案 B 启用。

const fs = require('fs')
const root = __dirname + '/..'
function read(file) { return fs.readFileSync(root + '/' + file, 'utf8') }
function expect(content, fragment, label) { if (!content.includes(fragment)) throw new Error(`${label}: missing ${fragment}`); console.log(`PASS ${label}`) }
function reject(content, fragment, label) { if (content.includes(fragment)) throw new Error(`${label}: unexpected ${fragment}`); console.log(`PASS ${label}`) }
function expectCount(content, fragment, min, label) {
  const count = content.split(fragment).length - 1
  if (count < min) throw new Error(`${label}: expected >= ${min} occurrences of ${fragment}, got ${count}`)
  console.log(`PASS ${label} (${count})`)
}

console.log('Spotlight flow checks')

const index = read('pages/index/index.uvue')
const detail = read('pagesSub/userExtra/user/detail.uvue')
const api = read('api/spotlight.uts')
const mock = read('mock/spotlight.uts')
const success = read('pagesSub/userExtra/components/XsaSpotlightSuccessSheet.uvue')

// —— 首页：爆灯不得成为主路径，首页不应有任何爆灯入口或状态
reject(index, 'vip-card-spotlight', 'homepage has no spotlight button')
reject(index, 'spotlightPaymentVisible', 'homepage has no spotlight payment state')
reject(index, 'XsaPaymentSheet', 'homepage has no payment sheet')
reject(index, 'XsaSpotlightSuccessSheet', 'homepage has no success sheet')
reject(index, 'onSpotlight', 'homepage must not trigger spotlight')
reject(index, 'sendSuperlike', 'homepage must not call the superlike API')

// —— 详情页：免费额度爆灯卡片（解锁态 + 锁定态各一处）
expect(detail, 'SPOTLIGHT_REASONS', 'detail declares spotlight reason chips')
expect(detail, 'sendSuperlike(', 'detail calls the free superlike API')
expect(detail, 'spotlightRemaining', 'detail tracks remaining quota')
expect(detail, 'spotlightButtonText', 'detail derives the CTA copy from state')
expect(detail, 'XsaSpotlightSuccessSheet', 'detail has success sheet')
expectCount(detail, 'spotlight-card', 2, 'detail renders the card in both locked and unlocked views')
// 本轮明确不做付费：详情页不得再挂支付 sheet、不得显示价格
reject(detail, 'XsaPaymentSheet', 'detail must not mount the payment sheet')
reject(detail, 'paySpotlight(', 'detail must not call the payment API')
reject(detail, '¥9.9', 'detail must not show a price in the free-quota entry')
reject(detail, '爆灯嘉宾', 'detail must not render a third-party spotlight guest list')

// —— API 层：免费爆灯必须带幂等键，付费版本保留但标注未启用
expect(api, "url: '/discovery/superlikes/'", 'superlike API targets the discovery endpoint')
expect(api, "'Idempotency-Key'", 'superlike request sends an idempotency key')
expect(api, 'remaining_today', 'superlike documents the remaining quota field')
expect(api, 'SPOTLIGHT_AMOUNT = 9.9', 'paid spotlight amount is kept for plan B')
expect(api, "paymentStatus: 'paid'", 'mock paid status')
expect(api, '方案 B', 'paid spotlight is documented as not enabled this round')

// —— Mock 与成功态组件保持不变
expect(mock, 'mockSpotlightPaymentOrders', 'spotlight mock order store')
expect(success, '爆灯已送达', 'success sheet title')
expect(success, '继续浏览', 'success sheet action')
reject(success, 'import type', 'UTS-safe local success target type')

console.log('Spotlight flow checks passed')
