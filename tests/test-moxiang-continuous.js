// continuous_v2：执行真实源码函数，网络与端侧 API 仅在边界替身。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const { parse } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const page = read('pagesSub/profileExtra/my-portrait-master.uvue')
const source = parse(page).descriptor.scriptSetup.content
function declarations(src, names) {
  const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body
  return names.map(name => {
    const n = nodes.map(n => n.declaration || n).find(n => n.id?.name === name)
    assert.ok(n, `缺少真实声明 ${name}`)
    return src.slice(n.start, n.end)
  }).join('\n')
}
function run(src, names, ctx) {
  const code = babel.transformSync(declarations(src, names), {
    filename: 'runtime.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript']
  }).code
  return vm.runInNewContext(`${code}\n;({${names.join(',')}})`, ctx)
}
const ref = value => ({ value })
const turn = (id, role = 'user', text = '相同表达') => ({ turnId: id, role, content: text, clientTurnId: `c-${id}` })
const subject = name => ({ subject: name, status: 'collecting', overall_percent: 0, dimensions: {} })
const state = consent => ({ flow_version: 'continuous_v2', consent_granted: consent, session_id: 's1', personal: subject('personal'), ideal_partner: subject('ideal_partner') })
function sandbox() {
  const calls = { connected: 0, stopped: 0, audio: 0, history: 0, sent: [] }
  const ctx = {
    masterPageAlive: true, masterPageVisible: true, continuousFlow: ref(true),
    continuousLoadSeq: 0, continuousSnapshotSeq: 0, connectionSeq: 0,
    continuousPendingBuilds: new Map(), continuousActionBusy: ref(false), genIdempotencyKey: () => `build-${Math.random()}`,
    messages: ref([{ id: 'old', text: '已有理解' }]), restoredTurnIds: ref(new Set(['old'])), openingMessageKeys: new Set(['welcome']),
    historyBeforeId: ref(null), historyLoading: ref(false), continuousState: ref(null),
    lastReplyText: ref('原回复'), lastTTSUrl: ref('private-url'), lastTTSDuration: ref(100), partialText: ref('转写'), inputText: ref(''),
    sessionStarted: ref(false), connecting: ref(false), connectError: ref(''), stateError: ref(''),
    masterState: ref('idle'), currentSubject: ref('personal'), typingMsgId: 0,
    isRecording: false, recorderManager: null, ws: null,
    pcmPlayer: { stopAll: () => calls.audio++ },
    stopAudioPlayback: () => calls.audio++, stopContinuousPolling: () => calls.stopped++,
    scheduleContinuousPolling: () => {}, scrollToBottom: () => {},
    connectWS: () => calls.connected++,
    getContinuousMoxiangState: async () => state(true),
    getContinuousTurns: async () => { calls.history++; return { turns: [turn('1'), turn('2', 'assistant')], next_before_id: '1' } },
    uni: { showToast: () => {}, showModal: o => o.success({ confirm: true }), navigateTo: o => calls.sent.push(o.url) }, masterRoleName: '知遇',
    addMessage: (role, text) => ctx.messages.value.push({ role, text })
  }
  const fns = run(source, ['clearContinuousPrivateCache', 'applyContinuousState', 'refreshContinuousState', 'continuousTurnMessages', 'loadContinuousConversation', 'loadOlderContinuousHistory', 'sendText', 'openContinuousPortrait'], ctx)
  return { ctx, calls, ...fns }
}
async function main() {
  {
    const t = sandbox()
    await t.loadContinuousConversation()
    assert.equal(t.calls.connected, 1)
    assert.deepEqual(Array.from(t.ctx.messages.value, m => m.id), ['turn-1', 'turn-2'])
    assert.equal(t.ctx.lastReplyText.value, '', '恢复后不能把旧回复交给当前 socket listen')
  }
  {
    const t = sandbox()
    t.ctx.getContinuousTurns = async () => { throw new Error('history unavailable') }
    await t.loadContinuousConversation()
    assert.equal(t.calls.connected, 0, '历史失败不能伪装为空资料并继续问')
    assert.equal(t.ctx.messages.value[0].id, 'old')
    assert.match(t.ctx.stateError.value, /history unavailable/)
    assert.equal(t.ctx.connecting.value, false)
  }
  {
    const t = sandbox()
    t.ctx.getContinuousMoxiangState = async () => { throw new Error('state unavailable') }
    await t.loadContinuousConversation()
    assert.equal(t.calls.history, 0)
    assert.equal(t.calls.connected, 0)
  }
  {
    const t = sandbox()
    t.ctx.getContinuousMoxiangState = async () => state(false)
    await t.loadContinuousConversation()
    assert.equal(t.calls.connected, 0)
    assert.equal(t.calls.history, 0)
    assert.equal(t.ctx.messages.value.length, 0)
    assert.equal(t.ctx.lastTTSUrl.value, '')
    assert.equal(t.ctx.partialText.value, '')
    assert.equal(t.ctx.restoredTurnIds.value.size, 0)
  }
  {
    const t = sandbox()
    let resolve
    t.ctx.getContinuousMoxiangState = () => new Promise(r => { resolve = r })
    const pending = t.refreshContinuousState()
    t.ctx.continuousSnapshotSeq++ // 更新的 WS 快照/页面隐藏先到
    resolve(state(true))
    assert.equal(await pending, false)
    assert.equal(t.ctx.continuousState.value, null)
  }
  {
    const t = sandbox()
    let resolve
    t.ctx.getContinuousTurns = () => new Promise(r => { resolve = r })
    const pending = t.loadContinuousConversation()
    while (!resolve) await Promise.resolve()
    t.applyContinuousState(state(false)) // 历史读取途中撤权
    resolve({ turns: [turn('private')], next_before_id: null })
    await pending
    assert.equal(t.ctx.messages.value.length, 0)
    assert.equal(t.calls.connected, 0)
  }
  {
    const t = sandbox()
    const messages = t.continuousTurnMessages([turn('1'), turn('1'), turn('2'), turn('3', 'assistant')])
    assert.equal(messages.length, 3, '同来源去重，但相同文本不同来源不得合并')
    assert.equal(messages[2].role, 'master')
    t.ctx.messages.value = messages
    t.ctx.restoredTurnIds.value = new Set(['1', '2', '3'])
    t.ctx.historyBeforeId.value = '1'
    t.ctx.getContinuousTurns = async () => ({ turns: [turn('0'), turn('1')], next_before_id: null })
    await t.loadOlderContinuousHistory()
    assert.deepEqual(Array.from(t.ctx.messages.value, m => m.turnId), ['0', '1', '2', '3'])
  }
  {
    const t = sandbox()
    t.ctx.ws = { isConnected: () => true, sendTextMessage: text => t.calls.sent.push(text) }
    t.ctx.sessionStarted.value = true
    t.ctx.inputText.value = '我安静，希望对方愿意沟通'
    t.sendText()
    t.ctx.inputText.value = '重复点击'
    t.sendText()
    assert.equal(t.calls.sent.length, 1, 'ai_thinking 到达前也必须防重复发送')
  }
  {
    const api = read('api/ai-moxiang.uts')
    const requests = []
    const ctx = { MASTER_ROLE_NAME: '知遇', buildApiUrl: x => x, request: async options => {
      requests.push(options)
      return { success: true, data: options.url.includes('/turns') ? { turns: [{ turn_id: 't1', answer_text: '证据', role: 'user', client_turn_id: 'c1' }], next_before_id: 't1' } : state(true) }
    } }
    const apiFns = run(api, ['unwrapMoxiangResponse', 'adaptTurns', 'adaptContinuousSubject', 'adaptContinuousMoxiangState', 'getContinuousMoxiangState', 'getContinuousTurns'], ctx)
    assert.equal((await apiFns.getContinuousMoxiangState()).flow_version, 'continuous_v2')
    const history = await apiFns.getContinuousTurns('a/b', 50)
    assert.equal(history.turns[0].content, '证据')
    assert.equal(history.turns[0].clientTurnId, 'c1')
    assert.match(requests[1].url, /before_id=a%2Fb/)
    assert.throws(() => apiFns.adaptContinuousMoxiangState({}), /协议不匹配/)
    ctx.request = async () => ({ success: false, message: '网络错误' })
    await assert.rejects(apiFns.getContinuousMoxiangState(), /网络错误/)
  }
  {
    const wsSource = read('api/voice-master-ws.uts')
    const { MasterWS } = run(wsSource, ['MasterWS'], { debugLog: () => {}, adaptContinuousMoxiangState: x => x })
    const events = []
    const ws = new MasterWS({ onContinuousState: x => events.push(x) })
    const sent = []
    ws.send = x => sent.push(x)
    ws.startContinuousMode('profile-text-v1')
    ws.sendSessionStart()
    assert.equal(sent[0].flow_version, 'continuous_v2')
    assert.equal(sent[0].protocolVersion, undefined)
    ws.enableRealtimeV2()
    ws.sendSessionStart()
    assert.equal(sent[1].protocolVersion, 2)
    assert.equal(sent[1].flow_version, 'continuous_v2')
    ws.handleMessage({ type: 'continuous_state', state: state(true) })
    assert.equal(events.length, 1)
  }
  {
    const wsSource = read('api/voice-master-ws.uts')
    const events = []
    const { MasterWS } = run(wsSource, ['MasterWS'], { debugLog: () => {}, adaptContinuousMoxiangState: x => x })
    const ws = new MasterWS({
      onTranscriptPreview: (...args) => events.push(['preview', ...args]),
      onTranscriptConfirmed: (...args) => events.push(['confirmed', ...args]),
      onTranscriptCancelled: (...args) => events.push(['cancelled', ...args]),
      onTranscriptExpired: (...args) => events.push(['expired', ...args]),
    })
    const sent = []
    ws.send = x => sent.push(x)
    ws.startContinuousMode('profile-text-v1')
    ws.connected = true
    ws.confirmTranscript('tr-1', 'ct-1', 's-1', '编辑后')
    ws.cancelTranscript('tr-2', 'ct-2', 's-1')
    assert.deepEqual(JSON.parse(JSON.stringify(sent.slice(-2))), [
      { type: 'confirm_transcript', transcript_id: 'tr-1', client_turn_id: 'ct-1', session_id: 's-1', text: '编辑后' },
      { type: 'cancel_transcript', transcript_id: 'tr-2', client_turn_id: 'ct-2', session_id: 's-1' },
    ])
    ws.handleMessage({ type: 'transcript_preview', transcript_id: 'tr-1', client_turn_id: 'ct-1', session_id: 's-1', text: '原始', expires_in: 120 })
    ws.handleMessage({ type: 'transcript_confirmed', transcript_id: 'tr-1', client_turn_id: 'ct-1', source_id: 'turn-1', text: '编辑后' })
    ws.handleMessage({ type: 'transcript_cancelled', transcript_id: 'tr-2' })
    ws.handleMessage({ type: 'transcript_expired', transcript_id: 'tr-3' })
    assert.deepEqual(events, [
      ['preview', 'tr-1', 'ct-1', 's-1', '原始', 120],
      ['confirmed', 'tr-1', 'ct-1', 'turn-1', '编辑后'],
      ['cancelled', 'tr-2'],
      ['expired', 'tr-3'],
    ])
  }
  {
    const t = sandbox(), attempts = []
    const snapshot = state(true)
    snapshot.personal = { ...snapshot.personal, status: 'failed', has_updates: true }
    t.ctx.getContinuousMoxiangState = async () => snapshot
    t.ctx.buildContinuousPortrait = async (...args) => { attempts.push(args); throw new Error('timeout') }
    await t.openContinuousPortrait('personal')
    snapshot.personal.has_updates = false
    t.ctx.buildContinuousPortrait = async (...args) => {
      attempts.push(args)
      return { ...snapshot, personal: { ...snapshot.personal, status: 'generating', draft_id: 'd1', expected_revision: 1, preview_id: 'p1' } }
    }
    await t.openContinuousPortrait('personal')
    assert.deepEqual(attempts[0], attempts[1], '超时后必须原参数、同键重试')
    assert.equal(t.ctx.continuousPendingBuilds.size, 0)
    assert.match(t.calls.sent[0], /preview_id=p1/)
  }
  {
    const t = sandbox()
    const snapshot = state(true)
    snapshot.ideal_partner.status = 'failed'
    t.ctx.getContinuousMoxiangState = async () => snapshot
    let resolve
    t.ctx.buildContinuousPortrait = () => new Promise(r => { resolve = r })
    const pending = t.openContinuousPortrait('ideal_partner')
    while (!resolve) await Promise.resolve()
    t.applyContinuousState(state(false))
    resolve(snapshot)
    await pending
    assert.equal(t.ctx.continuousState.value.consent_granted, false)
    assert.equal(t.ctx.continuousPendingBuilds.size, 0)
    assert.equal(t.calls.sent.length, 0, '撤权后迟到生成响应不得回填或导航')
  }
  {
    const t = sandbox()
    const snapshot = state(true)
    snapshot.personal.status = 'failed'
    t.ctx.getContinuousMoxiangState = async () => snapshot
    let resolve
    t.ctx.buildContinuousPortrait = () => new Promise(r => { resolve = r })
    const pending = t.openContinuousPortrait('personal')
    while (!resolve) await Promise.resolve()
    t.ctx.masterPageVisible = false
    resolve(snapshot)
    await pending
    assert.equal(t.calls.sent.length, 0)
    assert.equal(t.ctx.continuousPendingBuilds.size, 1, '后台迟到结果留待前台同键核对')
  }
  for (const code of [401, 403]) {
    for (const operation of ['state', 'history', 'older']) {
      const t = sandbox()
      t.ctx.continuousState.value = state(true)
      t.ctx.historyBeforeId.value = '1'
      const deny = async () => { throw { code, message: '授权失效' } }
      if (operation === 'state') {
        t.ctx.getContinuousMoxiangState = deny
        await t.refreshContinuousState()
      } else {
        t.ctx.getContinuousTurns = deny
        if (operation === 'history') await t.loadContinuousConversation()
        else await t.loadOlderContinuousHistory()
      }
      assert.equal(t.ctx.continuousState.value, null)
      assert.equal(t.ctx.messages.value.length, 0)
      assert.equal(t.ctx.lastTTSUrl.value, '')
      assert.equal(t.ctx.partialText.value, '')
      assert.equal(t.calls.connected, 0)
    }
  }
  console.log('PASS continuous_v2: 恢复/隐私/去重/WS/生成幂等（19场景）')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
