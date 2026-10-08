const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const page = fs.readFileSync(path.join(__dirname, '..', 'pagesSub', 'profileExtra', 'my-portrait-master.uvue'), 'utf8')
const player = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pcm-player.uts'), 'utf8')

assert.match(page, /realtimeV2Active = protocolVersion != null && protocolVersion == 2/, 'v2 must activate from server journey_ready protocol_version')
assert.match(page, /if \(MOXIANG_REALTIME_V2_DEV && ws != null\) \{[\s\S]*?ws\.enableRealtimeV2\(\)/, 'v2 negotiation must remain behind the PCM capability/dev gate')
assert.match(page, /onAudioOutputStart:[\s\S]*?pcmPlayer\.begin\(generationId\)[\s\S]*?masterState\.value = 'speaking'[\s\S]*?currentGenerationId = generationId/, 'audio output start must bind the PCM generation before speaking')
assert.match(player, /begin\(generationId: string\)[\s\S]*?this\.generation = generationId/, 'PCM player must expose a generation binding used by enqueue')
assert.match(page, /onResponseStatus:[\s\S]*?playbackStatus == 'playing'[\s\S]*?masterState\.value = 'speaking'/, 'playing status must drive speaking state')
assert.match(page, /playbackStatus == 'completed' \|\| playbackStatus == 'interrupted' \|\| playbackStatus == 'unknown'[\s\S]*?masterState\.value = 'idle'/, 'playback terminal status must drive idle state')
assert.match(page, /generationId != '' && currentGenerationId != '' && generationId != currentGenerationId/, 'late response status from an old generation must be ignored')

const doneStart = page.indexOf('\t\tonResponseDone:')
const statusStart = page.indexOf('\t\tonResponseStatus:')
assert.ok(doneStart >= 0 && statusStart > doneStart, 'response_done and response_status callbacks must both exist')
const doneBlock = page.slice(doneStart, statusStart)
assert.ok(!doneBlock.includes("masterState.value = 'idle'"), 'response_done must not claim playback is complete')
assert.match(doneBlock, /pcmPlayer\.finish\(generationId\)/, 'response_done may only close input to the PCM queue')
assert.match(page, /onFinished:[\s\S]*?status == 'completed' \|\| status == 'interrupted' \|\| status == 'failed'[\s\S]*?masterState\.value = 'idle'/, 'PCM playback completion must settle the UI')

console.log('moxiang voice state contract: PASS')

// ===== R2/D03 行为回归：播报绝不入采集链路（真实 playTTS 沙箱执行） =====
//
// 修复前 playTTS 发送 revise_text：服务端把它当一轮真实用户输入——新建
// 用户轮次、触发候选抽取并重新生成回复，画像被"听它读"污染。
const playStart = page.indexOf('function playTTS')
const playEnd = page.indexOf('function isTypedFailureHandledFor')
assert.ok(playStart >= 0 && playEnd > playStart, 'playTTS must exist in the master page')
let playSrc = page.slice(playStart, playEnd)
playSrc = playSrc.replace('function playTTS(text: string)', 'function playTTS(text)')
playSrc = playSrc.replace(/\(res: any\)/g, '(res)').replace(/\(_e: any\)/g, '(_e)').replace(/: any\[\]/g, '').replace(/: any/g, '')
assert.ok(!playSrc.includes('sendReviseText'), 'playTTS must never send revise_text')

const makeHarness = () => {
  const state = { sentRevise: '', sentListen: 0, synthesized: '', played: '' }
  const ttsBusy = { value: false }
  const lastReplyText = { value: '当前这条回复' }
  const lastTTSUrl = { value: '' }
  const masterState = { value: 'idle' }
  const ws = {
    isConnected: () => true,
    sendReviseText: (t) => { state.sentRevise = String(t) },
    sendListen: () => { state.sentListen += 1 }
  }
  const synthesizeSpeech = (text) => {
    state.synthesized = String(text)
    return Promise.resolve({ success: true, audioUrl: 'https://cdn.test/audio.mp3', durationMs: 1 })
  }
  const playAudio = (url) => { state.played = String(url) }
  const uni = { showToast: () => {} }
  const playTTS = new Function(
    'ttsBusy', 'lastReplyText', 'lastTTSUrl', 'masterState', 'ws', 'synthesizeSpeech', 'playAudio', 'uni',
    'let masterPageAlive = true; let masterPageVisible = true; let connectionSeq = 1;\n' + playSrc + '\nreturn playTTS;'
  )(ttsBusy, lastReplyText, lastTTSUrl, masterState, ws, synthesizeSpeech, playAudio, uni)
  return { state, ttsBusy, masterState, playTTS }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

;(async () => {
  // 用例 A：历史/指定消息 → 走独立合成接口，绝不发送 revise/listen。
  const a = makeHarness()
  a.playTTS('历史那条回复')
  await flush()
  assert.equal(a.state.synthesized, '历史那条回复', 'history message must be synthesized via REST')
  assert.equal(a.state.sentRevise, '', 'playback must never send revise_text (candidate pollution)')
  assert.equal(a.state.sentListen, 0, 'history playback must not reuse the session listen channel')
  assert.equal(a.state.played, 'https://cdn.test/audio.mp3', 'synthesized audio must be played')
  assert.equal(a.ttsBusy.value, false, 'busy lock must release after completion')

  // 用例 B：最新回复（与服务端当前回复一致）→ 仅复用会话内 listen。
  const b = makeHarness()
  b.playTTS('当前这条回复')
  await flush()
  assert.equal(b.state.sentListen, 1, 'latest reply playback should reuse the session listen')
  assert.equal(b.state.synthesized, '', 'latest reply must not double-synthesize via REST')
  assert.equal(b.state.sentRevise, '', 'playback must never send revise_text')

  // 用例 C：合成中重复点击不并发合成多份。
  const c = makeHarness()
  c.ttsBusy.value = true
  c.playTTS('另一条回复')
  await flush()
  assert.equal(c.state.synthesized, '', 'duplicate tap during synthesis must not enqueue another synth')

  console.log('playback isolation behavior: PASS')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
