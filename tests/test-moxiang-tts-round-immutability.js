// audit-item-4: 「听它读」不产生用户轮次、不改变候选数量（第 7 项接线，判据来自第 4 项）
//
// 审计问题：点「听它读」后对话轮次/候选被意外推进（旧实现借道 revise_text）。
// 契约（沙箱执行真实 playTTS / playAudio / stopAudioPlayback / synthesizeSpeech）：
//   1. 历史消息朗读只走 POST /voice/synthesize，payload 仅 { text }；
//   2. 最新回复复用会话内 listen 指令，绝不调用 ws.send / revise 类接口；
//   3. 朗读前后：用户轮次、候选列表、聊天消息数组一字不变；
//   4. ttsBusy 互斥防止连点排队；停止/播完清空 lastTTSUrl，防止重放错内容。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub', 'profileExtra', 'my-portrait-master.uvue'), 'utf8')

function sliceBalanced(src, startIndex) {
  if (startIndex < 0) throw new Error('未找到片段起点')
  const open = src.indexOf('{', startIndex)
  if (open < 0) throw new Error('未找到起始花括号')
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(startIndex, i + 1)
    }
  }
  throw new Error('花括号未配平')
}

function compileFragment(code, extra = '') {
  const wrapped = ['(function () {', code, extra, '})()'].join(String.fromCharCode(10))
  return babel.transformSync(wrapped, {
    filename: 'fragment.ts',
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-typescript']
  }).code
}

const playTTSSrc = sliceBalanced(source, source.indexOf('function playTTS(text: string)'))
const playAudioSrc = sliceBalanced(source, source.indexOf('function playAudio(url: string)'))
const stopSrc = sliceBalanced(source, source.indexOf('function stopAudioPlayback()'))
assert.ok(playTTSSrc && playAudioSrc && stopSrc, '必须能切出 playTTS / playAudio / stopAudioPlayback')

// 朗读链路绝不允许触碰的写操作（revise 在服务端 = 新一轮用户输入）
assert.ok(!/revise/i.test(playTTSSrc), 'playTTS 源码不得出现 revise 字样')
assert.ok(!/\.send\(/.test(playTTSSrc), 'playTTS 不得调用 ws.send 发送对话消息')
assert.ok(!/revise_text\s*["']?\s*:/.test(source), '画像页不得把 revise_text 作为请求字段下发')
assert.match(source, /@tap="playTTS\(msg\.text\)"/, '听它读按钮必须绑定 playTTS')

function makeTtsSandbox(options) {
  const calls = {
    synthesize: [], sendListen: 0, sends: 0, toasts: [],
    playStarted: [], audioStops: 0, audioDestroys: 0
  }
  const scenario = options || {}
  const ctx = {
    ttsBusy: { value: scenario.busy === true },
    lastReplyText: { value: '最后一句回复' },
    ws: scenario.ws === 'none' ? null : {
      isConnected: () => scenario.connected === true,
      sendListen: () => { calls.sendListen++ },
      send: () => { calls.sends++ }
    },
    synthesizeSpeech: async (text) => {
      calls.synthesize.push(text)
      if (scenario.synthFail === true) return { success: false, audioUrl: '', error: '合成服务拒绝了这段文本' }
      return { success: true, audioUrl: 'audio/tts-1.webp', error: '' }
    },
    masterPageAlive: true,
    masterPageVisible: true,
    connectionSeq: 1,
    lastTTSUrl: { value: scenario.lastUrl != null ? scenario.lastUrl : '' },
    masterState: { value: 'idle' },
    audioContext: null,
    resolveMediaUrl: (u) => 'https://cdn.example/' + u,
    uni: {
      showToast: (opt) => { calls.toasts.push(opt.title) },
      createInnerAudioContext: () => {
        const fake = {
          src: '',
          onEnded: (cb) => { fake.__ended = cb },
          onError: (cb) => { fake.__error = cb },
          play: () => { calls.playStarted.push(fake.src) },
          stop: () => { calls.audioStops++ },
          destroy: () => { calls.audioDestroys++ }
        }
        calls.__lastCtx = fake
        return fake
      }
    },
    // 守恒哨兵：朗读前后必须一字不变
    userTurnCount: 3,
    candidateList: ['候选一', '候选二'],
    chatMessages: [{ role: 'user', text: '我比较慢热' }, { role: 'master', text: '最后一句回复' }]
  }
  const compiled = compileFragment(
    [playTTSSrc, playAudioSrc, stopSrc].join(String.fromCharCode(10)),
    'return { playTTS, playAudio, stopAudioPlayback };'
  )
  const fns = vm.runInNewContext(compiled, ctx)
  return { ctx, calls, fns }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

async function main() {
  // ── 1. 最新回复且连接在线：只发 listen，不请求合成、不发对话消息 ──────
  {
    const t = makeTtsSandbox({ connected: true })
    t.fns.playTTS('最后一句回复')
    await flush()
    assert.equal(t.calls.sendListen, 1, '最新回复走会话内 listen')
    assert.equal(t.calls.synthesize.length, 0, 'listen 路径不得再请求合成')
    assert.equal(t.calls.sends, 0, '任何路径都不得调用 ws.send')
    assert.equal(t.ctx.userTurnCount, 3, '朗读不得增加用户轮次')
    assert.deepEqual(Array.from(t.ctx.candidateList), ['候选一', '候选二'], '朗读不得改变候选列表')
    assert.equal(t.ctx.chatMessages.length, 2, '朗读不得追加聊天消息')
  }

  // ── 2. 历史消息：走合成接口，播放/播完状态收敛；轮次候选守恒 ──────────
  {
    const t = makeTtsSandbox({ connected: true })
    t.fns.playTTS('很久以前的一条回复')
    await flush()
    assert.deepEqual(Array.from(t.calls.synthesize), ['很久以前的一条回复'], '历史消息只把文本交给合成接口')
    assert.equal(t.calls.sendListen, 0, '历史消息不属于会话内 listen')
    assert.equal(t.calls.sends, 0, '历史消息路径不得发送任何 WS 消息')
    assert.equal(t.ctx.lastTTSUrl.value, 'audio/tts-1.webp', '合成成功须记录音频地址')
    assert.equal(t.ctx.masterState.value, 'speaking', '播放中状态应为 speaking')
    assert.equal(t.calls.playStarted.length, 1, '合成成功后自动播放')
    assert.equal(t.calls.playStarted[0], 'https://cdn.example/audio/tts-1.webp', '播放地址须过 resolveMediaUrl')
    // 模拟播放结束
    t.calls.__lastCtx.__ended()
    assert.equal(t.ctx.masterState.value, 'idle', '播完须回到 idle')
    assert.equal(t.ctx.lastTTSUrl.value, '', '播完须清空旧音频地址，防止重放错内容')
    assert.equal(t.ctx.userTurnCount, 3, '朗读前后用户轮次不变')
    assert.deepEqual(Array.from(t.ctx.candidateList), ['候选一', '候选二'], '朗读前后候选数量不变')
    assert.equal(t.ctx.chatMessages.length, 2, '朗读前后消息数不变')
  }

  // ── 3. ttsBusy 互斥：连点不排队、不重复合成 ──────────────────────────
  {
    const t = makeTtsSandbox({ busy: true, connected: true })
    t.fns.playTTS('最后一句回复')
    t.fns.playTTS('历史消息')
    await flush()
    assert.equal(t.calls.synthesize.length, 0, '忙时不得触发合成')
    assert.equal(t.calls.sendListen, 0, '忙时不得触发 listen')
  }

  // ── 4. 空文本直接返回 ────────────────────────────────────────────────
  {
    const t = makeTtsSandbox({ connected: true })
    t.fns.playTTS('')
    await flush()
    assert.equal(t.calls.synthesize.length + t.calls.sendListen, 0, '空文本不得触发任何朗读')
  }

  // ── 5. 合成失败：提示错误、不记录音频地址、状态不误入 speaking ────────
  {
    const t = makeTtsSandbox({ synthFail: true })
    t.fns.playTTS('一段历史文本')
    await flush()
    assert.equal(t.ctx.lastTTSUrl.value, '', '失败不得记录音频地址')
    assert.notEqual(t.ctx.masterState.value, 'speaking', '失败不得进入播放态')
    assert.ok(t.calls.toasts.some(x => String(x).includes('拒绝')), '失败须提示服务端原因')
    assert.equal(t.ctx.userTurnCount, 3, '失败路径同样不改变轮次')
  }

  // ── 6. stopAudioPlayback：停播 + 销毁 + 清旧 URL ─────────────────────
  {
    const t = makeTtsSandbox({ lastUrl: 'audio/old.webp' })
    t.fns.playAudio('audio/new.webp')
    const before = t.calls.playStarted.length
    assert.equal(before, 1, 'playAudio 直接播放须生效')
    t.fns.stopAudioPlayback()
    assert.ok(t.calls.audioStops >= 1, '停止须调用 audioContext.stop')
    assert.ok(t.calls.audioDestroys >= 1, '停止须销毁 audioContext')
    assert.equal(t.ctx.lastTTSUrl.value, '', '停止须清空 lastTTSUrl')
    assert.equal(t.ctx.masterState.value, 'idle', '停止须回到 idle')
  }

  // ── 7. API 层：synthesizeSpeech 的 payload 只有 text ─────────────────
  {
    const apiSrc = fs.readFileSync(path.join(root, 'api', 'ai-profile.uts'), 'utf8')
    const start = apiSrc.indexOf('export async function synthesizeSpeech(')
    assert.ok(start >= 0, 'api/ai-profile.uts 必须导出 synthesizeSpeech')
    const fnSrc = sliceBalanced(apiSrc, start).replace(/^export /, '')
    const payloadCalls = []
    const ctx = {
      request: async (opt) => {
        payloadCalls.push(opt)
        return { success: true, data: { audio_url: '/media/tts.webp', duration_ms: 800 }, message: '' }
      },
      genIdempotencyKey: () => 'k-test',
      resolveMediaUrl: (u) => 'https://cdn.example' + u
    }
    const compiled = compileFragment(fnSrc, 'return synthesizeSpeech;')
    const synthesizeSpeech = vm.runInNewContext(compiled, ctx)
    const out = await synthesizeSpeech('念这句')
    assert.equal(payloadCalls.length, 1, '只发一次合成请求')
    assert.equal(payloadCalls[0].url, '/voice/synthesize', '必须走 /voice/synthesize')
    assert.deepEqual(Array.from(Object.keys(payloadCalls[0].data)), ['text'], 'payload 只允许 text，不得夹带轮次/修订字段')
    assert.equal(out.success, true, '成功结果透传')
    assert.equal(out.audioUrl, 'https://cdn.example/media/tts.webp', '音频地址须补全')
  }

  console.log('PASS moxiang tts round immutability: 听它读不产生轮次、不改候选、互斥与清理全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
