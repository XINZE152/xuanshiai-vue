const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

function compile(file, requires = () => ({})) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = babel.transformSync(source, {
    filename: file.replace('.uts', '.ts'), configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-typescript', '@babel/plugin-transform-modules-commonjs']
  }).code
  const scope = { exports: {}, require: requires, console }
  vm.runInNewContext(code, scope)
  return scope.exports
}

const present = compile('utils/meeting-workflow.uts').getWorkspaceMeetingPresentation
assert.equal(present('SUBMITTED', null).statusLabel, '未回应')
assert.equal(present('SUBMITTED', null).phase, 'PROCESSING')
assert.equal(present('ACCEPTED', null).phase, 'UPCOMING', 'accepted with no schedule already belongs in waiting')
assert.equal(present('DECLINED', null).phase, 'FAILED')
assert.equal(present('CLOSED', null).phase, 'FAILED')
assert.equal(present('ACCEPTED', { status: 'SCHEDULED' }).phase, 'UPCOMING')
assert.equal(present('ACCEPTED', { status: 'COMPLETED' }).phase, 'UPCOMING', 'legacy completion needs a follow-up')
assert.equal(present('ACCEPTED', { status: 'COMPLETED', followUpContent: ' ' }).phase, 'UPCOMING')
assert.equal(present('ACCEPTED', { status: 'COMPLETED', followUpContent: '双方已见面，继续了解' }).phase, 'COMPLETED')
assert.equal(present('ACCEPTED', { status: 'CANCELLED' }).phase, 'FAILED')
assert.equal(present('ACCEPTED', { status: 'NO_SHOW' }).phase, 'FAILED')

const calls = []
let reply = { success: true, data: null }
let replies = []
const api = compile('api/matchmaker.uts', name => {
  if (name.includes('matchmaker-remote')) return { request: async options => { calls.push(options); return replies.length ? replies.shift() : reply }, MATCHMAKER_REMOTE_MODE: true }
  if (name.includes('config')) return { USE_MOCK: false, API_BASE_URL: 'https://xhztest.xyz', resolveMediaUrl: value => value }
  return {}
})
async function run() {
  reply = { success: true, data: { items: [{ id: 1, status: 'ACCEPTED', meeting: { id: 2, status: 'COMPLETED', follow_up_content: '已跟进', scheduled_at: '2026-11-03T15:00:00', location: '门店' } }], workflow_version: 2 } }
  const page = await api.getMatchmakerWorkspaceMeetingRequests()
  assert.equal(page.data.workflowVersion, 2)
  assert.equal(page.data.items[0].meeting.followUpContent, '已跟进')
  replies = [
    { success: true, data: { items: [{ id: 10, status: 'ACCEPTED' }], has_more: true, workflow_version: 2 } },
    { success: true, data: { items: [{ id: 11, status: 'DECLINED' }], has_more: false } }
  ]
  assert.equal((await api.getMatchmakerWorkspaceMeetingRequests()).data.items.length, 2)
  assert.equal(calls.at(-1).data.page, 2, 'searchable records include later pages')
  replies = [
    { success: true, data: { items: [], has_more: true, workflow_version: 2 } },
    { success: false, code: 500, message: '分页读取失败' }
  ]
  assert.equal((await api.getMatchmakerWorkspaceMeetingRequests()).success, false, 'partial results must not appear complete')
  await api.updateMatchmakerMeetingRecordStatus('2', 'COMPLETED', '', ' 约会结束，双方愿意了解 ')
  assert.equal(calls.at(-1).data.follow_up_content, '约会结束，双方愿意了解')
  assert.equal(calls.at(-1).method, 'PATCH')
  await api.createMatchmakerMeeting({ applicant_user_id: 62, target_user_id: 63, contacts_confirmed: true, applicant_agreed: true, target_agreed: true })
  assert.equal(calls.at(-1).url, '/matchmaker/workbench/meetings')
  assert.equal(calls.at(-1).data.target_agreed, true)
  reply = { success: false, code: 500, message: '服务暂时异常' }
  assert.equal((await api.getMatchmakerWorkspaceMeetingRequests()).success, false, 'remote failures must not become mock success')
  // 编译整页脚本以捕获语法错误；微信产物仍由 HBuilderX 验证。
  const pageSource = fs.readFileSync(path.join(__dirname, '../pagesSub/matchmaker/become-matchmaker.uvue'), 'utf8')
  const script = pageSource.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]
  babel.transformSync(script, { filename: 'page.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] })
  console.log('PASS meeting workflow: groups, follow-up requirement, consent payloads, remote failure and page syntax')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
