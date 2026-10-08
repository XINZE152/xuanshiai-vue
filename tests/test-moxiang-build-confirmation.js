// continuous_v2 的确认保护；legacy 构建邀请仅保留兼容，不再作为新主流程门槛。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const { parse } = require('@vue/compiler-sfc')
const { fixture, preview } = require('./test-moxiang-continuous-result')
const page = fs.readFileSync(path.join(__dirname, '../pagesSub/profileExtra/my-portrait-master.uvue'), 'utf8')
const src = parse(page).descriptor.scriptSetup.content
const prompt = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body.find(n => n.id?.name === 'maybePromptBuild')
assert.ok(prompt)
const promptSource = src.slice(prompt.start, prompt.end)
const code = babel.transformSync(promptSource, { filename: 'prompt.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const modals = [], accepted = []
const context = {
  continuousFlow: { value: true }, currentSubject: { value: 'personal' },
  buildPromptShown: { value: { personal: false, ideal_partner: false } }, inviteBusy: { value: false },
  uni: { showModal: options => modals.push(options), showToast: () => {} },
  ws: { isConnected: () => true, acceptBuildInvite: (...args) => accepted.push(args) }
}
const maybePromptBuild = vm.runInNewContext(code + ';maybePromptBuild', context)
maybePromptBuild('personal', 'invite-1')
assert.equal(modals.length, 0, '新版不得被旧构建邀请截断自然对话')
context.continuousFlow.value = false
maybePromptBuild('personal', 'invite-1')
maybePromptBuild('personal', 'invite-1')
assert.equal(modals.length, 1, 'legacy 邀请仍按主体去重')
modals[0].success({ confirm: false })
assert.equal(accepted.length, 0)
modals[0].success({ confirm: true })
assert.deepEqual(accepted[0], ['personal', 'invite-1'])
assert.doesNotMatch(promptSource, /publishProfileDraft|confirmPortraitNarrative|confirmProfilePreview/, '构建邀请不能发布画像')
assert.doesNotMatch(page, /onPublishReady:|gateBySubject\(|hardGateMet/, '不能用本地覆盖率绕过服务端状态')

async function main() {
  const invalid = [
    null, preview({ generation_status: 'queued', content: '' }), preview({ generation_status: 'processing' }),
    preview({ generation_status: 'failed' }), preview({ status: 'stale' }), preview({ status: 'failed' }),
    preview({ content: ' ' }), preview({ fields: [] })
  ]
  for (const draft of invalid) {
    const { page: p, calls } = fixture()
    p.continuousPreview = draft
    await p.onConfirmContinuous()
    await p.confirmContinuousPreview()
    assert.equal(calls.modal.length + calls.confirm.length + calls.legacy, 0, '完整审阅稿就绪前不允许正式生效')
    assert.equal(p.publishedMode, false)
  }
  for (const lock of ['continuousConflict', 'continuousEditDirty', 'continuousEditing', 'confirming', 'continuousSaving']) {
    const { page: p, calls } = fixture()
    p.applyContinuousPreview(preview())
    p[lock] = true
    await p.onConfirmContinuous()
    await p.confirmContinuousPreview()
    assert.equal(calls.confirm.length, 0, `${lock} 时不能确认`)
  }
  const { page: p, calls } = fixture()
  p.applyContinuousPreview(preview())
  await p.onConfirmContinuous()
  assert.equal(calls.confirm.length, 0, '生成完成不能自动确认')
  assert.equal(calls.modal.length, 1)
  calls.modal[0].success({ confirm: false })
  assert.equal(calls.confirm.length, 0, '取消整份确认不得生效')
  await p.publishPreview()
  assert.equal(calls.legacy, 0, '新版不能调用旧 publish 绕过整份审阅')
  await p.confirmContinuousPreview()
  assert.equal(calls.confirm.length, 1)
  assert.deepEqual(Array.from(calls.confirm[0]).slice(0, 2), ['p1', 1], '只能确认当前审阅预览和版本')
  assert.equal(p.publishedMode, true)
  console.log('PASS build confirmation: 完整审阅门禁、明确整份确认、legacy 兼容隔离')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
