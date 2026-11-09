const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const source = fs.readFileSync(require('node:path').join(__dirname, '../pagesSub/matchmaker/become-matchmaker.uvue'), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const body = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const node = body.find(n => n.declarations?.[0]?.id?.name === 'loadWorkspaceLeads')
const js = babel.transformSync(source.slice(node.start, node.end), { filename: 'leads.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const ref = value => ({ value })
const state = { workspaceLeads: ref([]), workspaceLeadsLoading: ref(false), workspaceLeadsError: ref(''), workspaceLeadsDiagnostic: ref(''), leadIntentionDetails: ref({}) }
let calls = [], responses = []
const load = vm.runInNewContext(js + '\n;loadWorkspaceLeads', {
  ...state, getMatchmakerWorkspaceLeads: async page => { calls.push(page); return responses[page - 1] },
  leadIntentionDefaultValue: () => 1, leadIntentionOption: () => ({ label: '意向' }), leadStatusLabel: () => '新线索', leadStatusTones: {},
  formatLeadTime: () => '', daysBetweenNow: () => 0, leadAgeFromBirthday: () => 0,
})
const result = (page, items, more) => ({ success: true, data: { page, items, has_more: more } })
async function run() {
  responses = [result(1, [{ id: 1, status: 'NEW' }], true), result(2, [{ id: 2, status: 'LOST' }], false)]
  await load()
  assert.equal(calls.join(','), '1,2')
  assert.equal(state.workspaceLeads.value.map(x => x.id).join(','), '1,2')
  assert.equal(state.workspaceLeads.value[1].status, 'LOST')
  calls = []; responses = [result(1, [{ id: 1 }], true), { success: false, message: '连接失败' }]
  await load()
  assert.equal(state.workspaceLeads.value.length, 0)
  assert.equal(state.workspaceLeadsError.value, '连接失败')
  calls = []; responses = [result(1, [], true)]
  await load()
  assert.equal(calls.length, 1)
  assert.match(state.workspaceLeadsError.value, /数据不完整/)
  calls = []; responses = [result(2, [], false)]
  await load()
  assert.match(state.workspaceLeadsError.value, /数据不完整/)
  assert.equal(state.workspaceLeadsLoading.value, false)
  console.log('workspace lead pagination checks passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
