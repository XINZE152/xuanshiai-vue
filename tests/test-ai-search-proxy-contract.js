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

console.log('M03 AI draft proxy contract checks')

const proxy = read('api/ai-search.uts')
const searchPage = read('pagesSub/profileExtra/search.uvue')

expect(proxy, "url: '/ai/search-drafts'", 'AI draft uses the M03 backend route')
expect(proxy, "url: '/ai/search-snapshots/' + encodeURIComponent(snapshotId) + '/results'", 'AI results use immutable search snapshots')
expect(proxy, "'Idempotency-Key': key", 'M03 writes supply an idempotency key')
expect(proxy, 'expected_condition_revision', 'M03 edits and confirmation carry the condition revision')
expect(proxy, "url: '/ai/search-suggestions/generate'", 'search suggestions use the existing generation endpoint')
expect(searchPage, "taskId != ''", 'suggestion polling requires a real task id')
expectAbsent(proxy, "url: '/ai/ideal-partner'", 'obsolete ideal-partner route proxy is removed')
expectAbsent(proxy, 'uni.request(', 'AI search proxy does not call a provider directly')
expectAbsent(proxy, 'AI_API_KEY', 'AI search proxy has no client-side provider key')
expect(searchPage, 'const aiGenerating = ref(false)', 'search page prevents duplicate draft submissions')
expect(searchPage, 'searchDraftConditions', 'search page renders server conditions')
expect(searchPage, 'aiConfirmIdempotencyKey', 'confirmation retries reuse their idempotency key')
expectAbsent(searchPage, '会员专享', 'advanced conditions are not hidden behind membership copy')
expectAbsent(searchPage, '<text class="vip-badge">VIP</text>', 'advanced conditions have no VIP badge')

console.log('M03 AI draft proxy contract checks passed')
