const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const source = fs.readFileSync(path.join(__dirname, '../api/good-news.uts'), 'utf8')
const start = source.indexOf('const STAGE_ICONS')
const end = source.indexOf('async function getMockConfigResult', start)
if (start < 0 || end < 0) throw new Error('good-news contract block not found')
const code = babel.transformSync(source.slice(start, end).replace(/^export /gm, ''), {
  filename: 'good-news.ts',
  configFile: false,
  babelrc: false,
  plugins: ['@babel/plugin-transform-typescript']
}).code

const names = [
  'formatGoodNewsDuration',
  'normalizeGoodNewsItem',
  'normalizeGoodNewsConfig',
  'buildGoodNewsReportPayload',
  'validateGoodNewsReport',
  'goodNewsVerificationLabel',
  'goodNewsReportStatusLabel'
]
const api = vm.runInNewContext(code + '\n;({' + names.join(',') + '})', {
  USE_MOCK: false,
  GOOD_NEWS_USE_MOCK: false,
  GOOD_NEWS_MAX_IMAGES: 9,
  resolveMediaUrl: (value) => {
    const text = value == null ? '' : String(value)
    return text.indexOf('/storage/') === 0 ? 'https://api.test' + text : text
  },
  Date,
  Math,
  Number,
  String,
  isNaN
})

assert.equal(api.formatGoodNewsDuration(8), '8 个月')
assert.equal(api.formatGoodNewsDuration(14), '1 年 2 个月')
assert.equal(api.formatGoodNewsDuration(24), '2 年')
assert.equal(api.formatGoodNewsDuration(0), '')

const item = api.normalizeGoodNewsItem({
  id: 7,
  stage: '已订婚',
  from_name: '林女士',
  to_name: '王先生',
  from_avatar: '/storage/a.webp',
  to_avatar: '/static/b.webp',
  matchmaker_name: '李老师',
  meet_duration_months: 8,
  images: ['/storage/c.webp', { url: '/storage/d.webp' }],
  content: '进展正文',
  blessing: '祝福语',
  blessing_count: 5,
  blessed_by_me: true,
  verification_level: 'MATCHMAKER_FOLLOWUP',
  display_mode: 'FULL',
  pending_review: true,
  published_at: '2026-10-28 10:00:00'
})
assert.equal(item.id, '7')
assert.equal(item.fromAvatar, 'https://api.test/storage/a.webp')
assert.equal(item.toAvatar, '/static/b.webp')
assert.equal(item.meetDurationText, '8 个月')
assert.equal(item.images.length, 2)
assert.equal(item.verificationLabel, '红娘回访')
assert.equal(item.pendingReview, true)
assert.equal(item.blessedByMe, true)
assert.equal(item.blessingCount, 5)

const maskedItem = api.normalizeGoodNewsItem({
  id: 8,
  stage: '恋爱生活',
  from_name: '张*',
  to_name: '李*',
  from_avatar: '/storage/a.webp',
  to_avatar: '/storage/b.webp',
  display_mode: 'MASKED',
  content: '正文'
})
assert.equal(maskedItem.fromAvatar, '')
assert.equal(maskedItem.toAvatar, '')

const defaultMaskedItem = api.normalizeGoodNewsItem({
  id: 9,
  stage: '恋爱生活',
  from_name: '王*',
  from_avatar: '/storage/c.webp',
  content: '正文'
})
assert.equal(defaultMaskedItem.fromAvatar, '')

const config = api.normalizeGoodNewsConfig({
  is_demo: true,
  title: '喜讯',
  categories: [
    { label: '牵手成功', value: '牵手成功' },
    { label: '锦旗飘飘', value: '锦旗飘飘' }
  ],
  blessings: [' 祝福 ', '']
})
assert.equal(config.title, '喜讯')
assert.equal(config.stages.length, 2)
assert.equal(config.stages[1].isPennant, true)
assert.equal(config.isDemo, true)
assert.equal(config.blessings.length, 1)
assert.equal(config.blessings[0], '祝福')

const validReport = {
  stage: '已订婚',
  partnerName: ' 王先生 ',
  meetDurationMonths: '8',
  content: '我们已经订婚，想把这份进展分享给还在认真了解的人。',
  images: [' /storage/a.webp ', ''],
  consentConfirmed: true
}
assert.equal(api.validateGoodNewsReport(validReport), '')
const payload = api.buildGoodNewsReportPayload(validReport)
assert.equal(payload.stage, '已订婚')
assert.equal(payload.partner_name, '王先生')
assert.equal(payload.meet_duration_months, 8)
assert.equal(payload.images.length, 1)
assert.equal(payload.images[0], '/storage/a.webp')
assert.equal(payload.consent_confirmed, true)
assert.equal(payload.consent_from, true)
assert.equal(payload.consent_to, true)
assert.equal(payload.consent_version, 'v1')
assert.equal(payload.consent_scopes.length, 4)
assert.equal(payload.consent_scopes[0], 'name')
assert.equal(payload.to_user_id, undefined)

assert.equal(api.validateGoodNewsReport({ ...validReport, stage: '' }), '请选择当前状态')
assert.equal(api.validateGoodNewsReport({ ...validReport, partnerName: '' }), '请填写对方称呼')
assert.equal(api.validateGoodNewsReport({ ...validReport, content: '短' }), '请至少写一句目前的进展')
assert.equal(api.validateGoodNewsReport({ ...validReport, consentConfirmed: false }), '请先确认双方同意公开范围内的信息')
assert.equal(api.goodNewsReportStatusLabel('PENDING'), '审核中')
assert.equal(api.goodNewsReportStatusLabel('REJECTED'), '未通过')

console.log('good news contract checks passed')
