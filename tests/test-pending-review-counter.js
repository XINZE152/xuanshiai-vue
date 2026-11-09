const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const page = fs.readFileSync(require('node:path').join(__dirname, '../pagesSub/matchmaker/become-matchmaker.uvue'), 'utf8')
const source = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const names = ['pendingReviewCountRequest', 'applyPendingReviewCount', 'refreshPendingReviewCount']
const body = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const selected = body.filter(node => names.includes(node.declarations?.[0]?.id?.name)).map(node => source.slice(node.start, node.end)).join('\n')
const compiled = babel.transformSync(selected, { filename: 'counter.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const snapshot = { value: { storeMetrics: [{ key: 'pending_review', value: '3' }, { key: 'served_members', value: '6' }] } }
const pending = []
const counter = vm.runInNewContext(compiled + '\n;({refreshPendingReviewCount})', {
  managementCenterSnapshot: snapshot,
  getMatchmakerReviewMembers: params => new Promise(resolve => pending.push({ params, resolve }))
})
async function run() {
  const first = counter.refreshPendingReviewCount()
  assert.equal(pending[0].params.member_pool, 'all')
  assert.equal(pending[0].params.review_status, 'PENDING')
  const second = counter.refreshPendingReviewCount()
  pending[1].resolve({ success: true, data: { total: 32, member_pool_version: 1 } })
  await second
  pending[0].resolve({ success: true, data: { total: 33, member_pool_version: 1 } })
  await first
  assert.equal(snapshot.value.storeMetrics[0].value, '32')
  assert.equal(snapshot.value.storeMetrics[1].value, '6')
  const failed = counter.refreshPendingReviewCount()
  pending[2].resolve({ success: true, data: { total: 3 } })
  await failed
  assert.equal(snapshot.value.storeMetrics[0].value, '--')
  console.log('pending review counter checks passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
