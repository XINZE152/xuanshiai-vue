// 执行“我的”真实画像方法；仅替换网络、Vue ref 与 uni 导航边界。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const { parse } = require('@vue/compiler-sfc')
const file = fs.readFileSync(path.join(__dirname, '../pages/profile/profile.uvue'), 'utf8')
const parsed = parse(file)
assert.equal(parsed.errors.length, 0)
const source = parsed.descriptor.scriptSetup.content
const names = ['portraitTag', 'portraitDesc', 'portraitState', 'portraitSnapshot', 'portraitReadSeq', 'portraitPageVisible', 'portraitHasResult', 'portraitStateLoading', 'portraitStateError', 'aiPersonaTitle', 'aiPersonaTags', 'aiAttachmentStyle', 'clearPortraitBadge', 'applyPortraitStateCopy', 'loadPortraitState', 'loadPortraitNarrative', 'openPortraitDestination', 'onAiPortrait', 'hidePortraitState']
const nodes = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const code = names.map(name => {
  const node = nodes.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name))
  assert.ok(node, name)
  return source.slice(node.start, node.end)
}).join('\n')
const js = babel.transformSync(code, { filename: 'profile.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const subject = name => ({ subject: name, status: 'collecting', overall_percent: 0, draft_id: null, published_revision_id: null, has_updates: false })
const snapshot = () => ({ consent_granted: true, session_id: null, personal: subject('personal'), ideal_partner: subject('ideal_partner') })
function fixture(state = snapshot()) {
  const urls = []
  const ctx = {
    ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    getContinuousMoxiangState: async () => state,
    getPortraitNarrative: async () => ({ success: true, data: { subject: 'personal', status: 'confirmed', revision_id: 7, persona_title: '已确认称号', persona_tags: ['安静'] } }),
    uni: { navigateTo: o => urls.push(o.url), showToast: () => {} }
  }
  const f = vm.runInNewContext(js + ';({' + names.filter(n => !['portraitReadSeq', 'portraitPageVisible'].includes(n)).join(',') + '})', ctx)
  return { ctx, f, urls }
}
async function main() {
  for (const name of ['personal', 'ideal_partner']) {
    const state = snapshot()
    state[name] = { ...state[name], status: 'awaiting_confirmation', draft_id: 'd1' }
    const { f, urls } = fixture(state)
    await f.loadPortraitState()
    assert.equal(f.portraitState.value, 'confirming')
    f.openPortraitDestination()
    assert.match(urls[0], /my-portrait-archive\?flow_version=continuous_v2/)
  }
  for (const [status, expected] of [['generating', 'generating'], ['failed', 'attention'], ['stale', 'attention']]) {
    const state = snapshot(); state.ideal_partner.status = status
    const { f } = fixture(state)
    await f.loadPortraitState()
    assert.equal(f.portraitState.value, expected)
  }
  {
    const { f, urls } = fixture()
    await f.loadPortraitState(); f.openPortraitDestination()
    assert.equal(f.portraitState.value, 'idle')
    assert.match(urls[0], /my-portrait-master\?flow_version=continuous_v2/)
  }
  const confirmed = () => { const s = snapshot(); s.personal.status = 'confirmed'; s.personal.published_revision_id = '7'; return s }
  {
    const { f, urls } = fixture(confirmed())
    await f.loadPortraitState(); await f.loadPortraitNarrative(); f.openPortraitDestination()
    assert.equal(f.aiPersonaTitle.value, '已确认称号')
    assert.match(urls[0], /my-portrait-result.*published=1/)
  }
  for (const data of [{ subject: 'personal', status: 'pending_confirmation', revision_id: 7 }, { subject: 'personal', status: 'confirmed', revision_id: 6 }, { subject: 'ideal_partner', status: 'confirmed', revision_id: 7 }]) {
    const { ctx, f } = fixture(confirmed())
    ctx.getPortraitNarrative = async () => ({ success: true, data: { ...data, persona_title: '不可展示' } })
    await f.loadPortraitState(); await f.loadPortraitNarrative()
    assert.equal(f.aiPersonaTitle.value, '')
  }
  {
    const { ctx, f, urls } = fixture()
    ctx.getContinuousMoxiangState = async () => { throw { code: 403 } }
    f.aiPersonaTitle.value = '旧缓存'
    assert.equal(await f.loadPortraitState(), false)
    assert.equal(f.portraitState.value, 'unknown')
    assert.equal(f.aiPersonaTitle.value, '')
    f.openPortraitDestination(); assert.equal(urls.length, 0)
  }
  {
    const { ctx, f } = fixture(confirmed())
    await f.loadPortraitState()
    let resolve
    ctx.getPortraitNarrative = () => new Promise(r => { resolve = r })
    const read = f.loadPortraitNarrative()
    f.hidePortraitState()
    resolve({ success: true, data: { subject: 'personal', status: 'confirmed', revision_id: 7, persona_title: '迟到私密值' } })
    await read
    assert.equal(f.aiPersonaTitle.value, '')
    assert.equal(f.portraitSnapshot.value, null)
  }
  {
    const state = confirmed(); state.consent_granted = false
    const { ctx, f, urls } = fixture(state)
    let calls = 0; ctx.getPortraitNarrative = async () => { calls++ }
    await f.loadPortraitState(); await f.loadPortraitNarrative(); f.openPortraitDestination()
    assert.equal(f.portraitState.value, 'consent')
    assert.equal(calls, 0)
    assert.match(urls[0], /my-portrait-master/)
  }
  console.log('PASS continuous profile: 双主体状态/正式版本徽章/隐私清理/恢复导航（13场景）')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
