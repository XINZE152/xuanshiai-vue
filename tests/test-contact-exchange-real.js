const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const source = fs.readFileSync(path.join(__dirname, '../api/message.uts'), 'utf8')
const names = ['okResponse', 'failResponse', 'messageRequest', 'normalizeBusinessResponse', 'businessData',
  'isPositiveInteger', 'resolveMessageSubject', 'messageSubjectFailure', 'parentBackendUnavailable',
  'validCommandId', 'mapContactExchange', 'contactExchangeResponse', 'getContactExchanges',
  'createContactExchange', 'respondContactExchange']
const nodes = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const code = nodes.map(n => n.declaration || n).filter(n => names.includes(n.id?.name))
  .map(n => source.slice(n.start, n.end)).join('\n')
const compiled = babel.transformSync(code, { filename: 'contacts.ts', configFile: false, babelrc: false,
  plugins: ['@babel/plugin-transform-typescript'] }).code
let viewer = 1
let response
let sessionResponse = { success: true, data: { id: 71 } }
const calls = []
const api = vm.runInNewContext(`${compiled}\n;({getContactExchanges, createContactExchange, respondContactExchange})`, {
  MESSAGE_USE_MOCK: false, CONTACT_EXCHANGE_USE_MOCK: false, CHAT_USE_MOCK: false,
  CURRENT_USER_ID_KEY: 'user-id', uni: { getStorageSync: () => viewer },
  getChatSessionId: async () => sessionResponse,
  request: async options => { calls.push(options); return typeof response === 'function' ? response() : response },
})
const row = (status = 'PENDING', extra = {}) => ({ id: 81, session_id: 71, requester_id: 1, responder_id: 2,
  request_type: 'WECHAT', payload: { contact_value: 'secret_wechat' }, status,
  expire_at: null, ...extra })
const ok = data => ({ success: true, data })

async function run() {
  response = ok([row(), row('ACCEPTED', { id: 82 }), row('PENDING', { request_type: 'LOVE_MODE' })])
  let result = await api.getContactExchanges(12)
  assert.equal(calls.at(-1).url, '/chat/sessions/71/requests')
  assert.equal(result.data.length, 2)
  assert.equal(result.data[0].contactValue, null, 'pending raw payload must never reach UI')
  assert.equal(result.data[1].contactValue, 'secret_wechat')
  assert.equal(result.data[0].requestedByMe, true)
  response = ok([row('REJECTED'), row('WITHDRAWN'), row('EXPIRED')])
  result = await api.getContactExchanges(12)
  assert.ok(result.data.every(item => item.contactValue === null))
  response = ok([row('PENDING', { expire_at: '2020-01-01T00:00:00Z' })])
  assert.equal((await api.getContactExchanges(12)).data[0].status, 'expired')
  response = ok([row('PENDING', { expire_at: new Date(Date.now() + 600000).toISOString().replace('Z', '') })])
  assert.equal((await api.getContactExchanges(12)).data[0].status, 'pending', 'naive server UTC must not be treated as device local time')
  response = ok([row('ACCEPTED', { session_id: 999 })])
  assert.equal((await api.getContactExchanges(12)).success, false)
  response = ok([row('ACCEPTED', { requester_id: 3, responder_id: 4 })])
  assert.equal((await api.getContactExchanges(12)).success, false)

  response = ok(row())
  result = await api.createContactExchange(12, 'wechat', ' valid_wx ', 'contact-create-1')
  assert.equal(result.success, true)
  assert.equal(result.data.contactValue, null)
  assert.equal(calls.at(-1).method, 'POST')
  assert.equal(calls.at(-1).data.request_type, 'WECHAT')
  assert.equal(calls.at(-1).data.payload.contact_value, 'valid_wx')
  assert.equal(calls.at(-1).headers['Idempotency-Key'], 'contact-create-1')
  await api.createContactExchange(12, 'phone', 'untrusted-number', 'contact-create-2')
  assert.equal(calls.at(-1).data.request_type, 'PHONE')
  assert.equal(calls.at(-1).data.payload, null, 'phone must be read on the server')
  let count = calls.length
  assert.equal((await api.createContactExchange(12, 'wechat', '', 'contact-create-3')).success, false)
  assert.equal(calls.length, count)
  sessionResponse = { success: false, code: 403 }
  assert.equal((await api.createContactExchange(12, 'phone', '', 'contact-create-4')).success, false)
  assert.equal(calls.length, count, 'no contact request without a real permitted session')
  sessionResponse = ok({ id: 71 })

  viewer = 2
  response = ok(row('ACCEPTED'))
  result = await api.respondContactExchange(81, 'accept', 'contact-accept-1')
  assert.equal(result.data.contactValue, 'secret_wechat')
  assert.equal(result.data.requestedByMe, false)
  assert.equal(calls.at(-1).url, '/chat/session-requests/81')
  assert.equal(calls.at(-1).method, 'PATCH')
  assert.equal(calls.at(-1).data.action, 'ACCEPT')
  response = ok(row('REJECTED'))
  assert.equal((await api.respondContactExchange(81, 'reject', 'contact-reject-1')).data.contactValue, null)
  assert.equal(calls.at(-1).data.action, 'REJECT')
  count = calls.length
  assert.equal((await api.getContactExchanges(12, { mode: 'parent', childId: 3 })).success, false)
  assert.equal(calls.length, count)
  response = { success: false, code: 409, message: '已过期' }
  assert.equal((await api.respondContactExchange(81, 'accept', 'contact-accept-2')).code, 409)
  response = () => { viewer = 3; return ok(row('ACCEPTED')) }
  assert.equal((await api.respondContactExchange(81, 'accept', 'contact-accept-3')).code, 'AUTH_CHANGED')
  console.log('PASS real contact exchange: session routing, consent privacy, roles, errors and account changes')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
