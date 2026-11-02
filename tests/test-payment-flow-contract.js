const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function expect(content, fragment, label) {
  if (!content.includes(fragment)) throw new Error(`${label}: missing ${fragment}`)
  console.log(`PASS ${label}`)
}

function reject(content, fragment, label) {
  if (content.includes(fragment)) throw new Error(`${label}: unexpected ${fragment}`)
  console.log(`PASS ${label}`)
}

function readJsonWithComments(file) {
  const raw = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '')
  return JSON.parse(raw)
}

console.log('Payment flow contract checks')

// 预支付模块：必须把后端 snake_case 映射成 requestPayment 的驼峰字段。
const payment = read('api/payment.uts')
expect(payment, 'uni.requestPayment', 'requestPayment call')
expect(payment, 'app_id', 'app_id mapping')
expect(payment, 'time_stamp', 'time_stamp mapping')
expect(payment, 'nonce_str', 'nonce_str mapping')
expect(payment, 'pay_sign', 'pay_sign mapping')
expect(payment, 'pollUntil', 'polling helper')

// 会员：生产路径不得再调用测试支付。
const membership = read('api/membership.uts')
reject(membership, 'testPayOrder', 'membership testPayOrder removed')
reject(membership, '/payments/test/pay', 'membership test pay removed')

const index = read('api/index.uts')
reject(index, 'testPayOrder', 'index testPayOrder export removed')
expect(index, 'requestWechatPayment', 'index exports payment helper')

// 置顶：真实链路 = 下单 → 预支付 → requestPayment → 轮询订单/权益。
const top = read('api/top-placement.uts')
expect(top, 'getTopPlacementOrder', 'top order query')
expect(top, 'createPrepay', 'top prepay')
expect(top, 'requestWechatPayment', 'top requestPayment')
expect(top, 'pollUntil', 'top polling')
reject(top, '/payments/test/pay', 'top test pay removed')

// 会员页面：不能再 import testPayOrder；必须处理业务错误码与权益确认。
const vip = read('pagesSub/profileExtra/vip.uvue')
expect(vip, 'createPrepay', 'vip prepay')
expect(vip, 'requestWechatPayment', 'vip requestPayment')
expect(vip, 'getMembershipOrder', 'vip order polling')
expect(vip, 'getMembershipStatus', 'vip entitlement polling')
expect(vip, 'businessCode', 'vip business error code')
expect(vip, 'membershipPending', 'vip pending guard')
reject(vip, 'testPayOrder', 'vip testPayOrder removed')

// 置顶页面：支付成功但未履约时不能谎称已开启。
const topPage = read('pagesSub/userExtra/index/top-placement.uvue')
expect(topPage, 'paymentPending', 'top pending state')
expect(topPage, 'successNotice', 'top pending copy')

// 小程序 AppID：manifest 与 project.config 必须一致。
const projectConfig = JSON.parse(read('project.config.json'))
const manifest = readJsonWithComments('manifest.json')
const manifestAppId = manifest['mp-weixin'] != null ? manifest['mp-weixin'].appid : null
if (manifestAppId == null || manifestAppId == '') throw new Error('manifest mp-weixin.appid is empty')
if (manifestAppId !== projectConfig.appid) {
  throw new Error(`AppID mismatch: manifest=${manifestAppId} project=${projectConfig.appid}`)
}
console.log('PASS manifest/project AppID aligned')

// 生产/测试 base URL 必须可切换。
const config = read('api/config.uts')
expect(config, 'PROD_API_BASE_URL', 'production base URL')
expect(config, 'resolveApiBaseUrl', 'base URL resolver')

console.log('Payment flow contract checks passed')
