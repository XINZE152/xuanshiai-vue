const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
}

function expect(content, fragment, label) {
  assert.ok(content.includes(fragment), `${label}: missing ${fragment}`)
  console.log(`PASS ${label}`)
}

function expectAbsent(content, fragment, label) {
  assert.ok(!content.includes(fragment), `${label}: should not contain ${fragment}`)
  console.log(`PASS ${label}`)
}

console.log('AI draft proxy contract checks')

const proxy = read('api/ai-search.uts')
const searchPage = read('pagesSub/profileExtra/search.uvue')

expect(proxy, "url: '/ai/ideal-partner'", 'AI draft uses the project backend route')
expect(proxy, "'Idempotency-Key': idealPartnerIdempotencyKey()", 'AI draft supplies an idempotency key')
expect(proxy, 'data: {}', 'AI draft never submits profile data from the client')
expectAbsent(proxy, 'uni.request(', 'AI draft proxy does not call a provider directly')
expectAbsent(proxy, 'api.deepseek.com', 'AI draft proxy has no provider endpoint')
expectAbsent(proxy, 'AI_API_KEY', 'AI draft proxy has no client-side provider key')
expectAbsent(proxy, 'sk-', 'AI draft proxy has no secret-shaped literal')
expectAbsent(searchPage, 'await generateIdealPartner()', 'AI ideal-partner entry stays closed until the backend route exists (never faked by plain search)')
expect(searchPage, 'const aiGenerating = ref(false)', 'search page prevents duplicate draft submissions')
expectAbsent(searchPage, '会员专享', 'advanced conditions are not hidden behind membership copy')
expectAbsent(searchPage, '<text class="vip-badge">VIP</text>', 'advanced conditions have no VIP badge')

console.log('AI draft proxy contract checks passed')
