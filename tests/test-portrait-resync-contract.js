// audit-item-4: 画像页过期后「一次进入即成功」的重入契约（第 7 项接线，判据来自第 4 项）
//
// 审计问题：会话过期后返回画像页，需要反复退出重进才能恢复对话。
// 修复契约（钉住以下行为，防回归）：
//   1. onShow 首次显示跳过核对（与 onLoad 共用一次 state 请求，不重复建连）；
//   2. resyncOnShow 以服务端 state 为准：无会话→断开、会话 ID 变更→断开重建、
//      会话有效但连接已断→重连恢复，一次 onShow 即可完成恢复；
//   3. 读 state 失败（网络抖动）≠ 没有会话：保留现有连接，不得误断；
//   4. connectionSeq 抑制过期连接的回调，防止旧连接复活覆盖新会话。
// 手法：沙箱执行真实源码片段（babel 去类型 + vm 执行），stub 全部外部依赖。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub', 'profileExtra', 'my-portrait-master.uvue'), 'utf8')

/** 从 source 的 startIndex 起按花括号配平切出一段声明，供沙箱执行 */
function sliceBalanced(src, startIndex) {
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

/** TS 片段 → JS 源码（先包一层函数表达式，片段内 return 在顶层非法） */
function compileFragment(code, extra = '') {
  const wrapped = ['(function () {', code, extra, '})()'].join(String.fromCharCode(10))
  return babel.transformSync(wrapped, {
    filename: 'fragment.ts',
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-typescript']
  }).code
}

const fnStart = source.indexOf('async function resyncOnShow()')
assert.ok(fnStart >= 0, 'my-portrait-master.uvue 必须定义 resyncOnShow')
const fnSource = sliceBalanced(source, fnStart)

/**
 * 每个场景一个全新沙箱：state/ws/连接状态由 scenario 注入，
 * 所有边界调用（loadMoxiangState/connectWS/disconnect）都记录到 counters。
 */
function runResync(scenario) {
  const compiled = compileFragment(fnSource, 'return resyncOnShow;')
  const calls = { stateLoads: 0, connects: 0, disconnects: 0, sessionSets: [] }
  const wsStub = scenario.ws === 'none' ? null : {
    isConnected: () => scenario.connected === true,
    disconnect: () => { calls.disconnects++ }
  }
  const ctx = {
    continuousFlow: { value: false },
    connecting: { value: scenario.connecting === true },
    sessionStarted: { value: scenario.sessionStarted !== false },
    stateError: { value: scenario.stateError != null ? scenario.stateError : '' },
    stateResponse: { value: scenario.stateError != null || scenario.noState ? null : { ok: 1 } },
    syncGateFromState: () => {},
    currentSubject: { value: 'personal' },
    sessionIdForSubject: () => (scenario.stateSessionId != null ? scenario.stateSessionId : ''),
    activeSessionBySubject: { value: { personal: scenario.connSessionId != null ? scenario.connSessionId : '', ideal_partner: '' } },
    setSessionIdForSubject: (subject, id) => { calls.sessionSets.push(subject + ':' + id) },
    connectWS: () => { calls.connects++ },
    loadMoxiangState: async () => { calls.stateLoads++ },
    ws: wsStub
  }
  const resync = vm.runInNewContext(compiled, ctx)
  return { ctx, calls, run: () => resync() }
}

async function main() {
  // ── 场景 1：建连进行中直接跳过，不得叠加 state 请求 ──────────────────
  {
    const t = runResync({ connecting: true, stateSessionId: 'S1' })
    await t.run()
    assert.equal(t.calls.stateLoads, 0, '建连中不得再发 state 请求')
    assert.equal(t.calls.connects, 0, '建连中不得重复建连')
  }

  // ── 场景 2：读 state 失败保留现有连接（网络抖动不误断） ──────────────
  {
    const t = runResync({ stateError: 'network timeout', connSessionId: 'S1', connected: true })
    await t.run()
    assert.equal(t.calls.stateLoads, 1, 'onShow 应核对一次 state')
    assert.equal(t.calls.disconnects, 0, 'state 读取失败不得断开现有连接')
    assert.equal(t.calls.connects, 0, 'state 读取失败不得重连')
    assert.equal(t.ctx.sessionStarted.value, true, 'state 读取失败不得清会话标记')
  }

  // ── 场景 3：服务端已无活动会话 → 断开回入口 ──────────────────────────
  {
    const t = runResync({ stateSessionId: '', connSessionId: 'S1', connected: true })
    await t.run()
    assert.equal(t.calls.disconnects, 1, '服务端无会话必须断开旧连接')
    assert.equal(t.ctx.ws, null, '断开后必须丢弃旧连接对象')
    assert.equal(t.ctx.sessionStarted.value, false, '服务端无会话必须清除会话标记')
    assert.equal(t.calls.connects, 0, '无会话不得盲目重连')
  }

  // ── 场景 4（核心）：旧会话过期、服务端已重建新会话 → 一次 onShow 恢复 ─
  {
    const t = runResync({ stateSessionId: 'S2', connSessionId: 'S1', connected: true })
    await t.run()
    assert.equal(t.calls.disconnects, 1, '会话 ID 变更必须丢弃旧连接')
    assert.deepEqual(Array.from(t.calls.sessionSets), ['personal:S2'], '必须按 state 恢复新会话 ID')
    assert.equal(t.calls.connects, 1, '一次进入即完成重建连接，不需二次进出')
  }

  // ── 场景 5：会话仍有效但连接已断 → 直接重连恢复同一会话 ──────────────
  {
    const t = runResync({ stateSessionId: 'S1', connSessionId: 'S1', ws: 'none' })
    await t.run()
    assert.equal(t.calls.connects, 1, '连接已断必须重连恢复同一会话')
    assert.equal(t.calls.disconnects, 0, '同一会话无需先断开')
  }

  // ── 场景 6：会话有效且连接正常 → 空转不重复建连 ──────────────────────
  {
    const t = runResync({ stateSessionId: 'S1', connSessionId: 'S1', connected: true })
    await t.run()
    assert.equal(t.calls.connects, 0, '连接正常不得重复建连')
    assert.equal(t.calls.disconnects, 0, '连接正常不得断开')
  }

  // ── 场景 7：连接对象还在但 isConnected=false → 重连 ──────────────────
  {
    const t = runResync({ stateSessionId: 'S1', connSessionId: 'S1', connected: false })
    await t.run()
    assert.equal(t.calls.connects, 1, 'isConnected 为 false 时必须重连')
  }

  // ── 结构契约 ────────────────────────────────────────────────────────
  // onShow 首次显示跳过，避免与 onLoad 重复请求/建两条连接
  assert.match(source, /let pageFirstShow = true/, '须有首开跳过标志')
  const onShowBlock = sliceBalanced(source, source.indexOf('onShow(() =>'))
  assert.ok(onShowBlock.includes('pageFirstShow'), 'onShow 必须先判断首开标志')
  assert.ok(onShowBlock.includes('resyncOnShow()'), 'onShow 二次显示必须走 resyncOnShow')
  // 过期连接回调抑制：connectWS 用 connectionSeq 比对，防旧连接复活
  const seqGuards = (source.match(/connId != connectionSeq/g) || []).length
  assert.ok(seqGuards >= 4, 'WS 各回调必须有 connectionSeq 过期保护（当前 ' + seqGuards + ' 处）')
  // 活动会话按主体记录，供 resyncOnShow 比对
  assert.ok(/activeSessionBySubject\.value\[subject\] = /.test(source), '建连成功必须记录当前主体会话 ID')
  // resyncOnShow 不得依据旧的 sessionStarted 布尔值直接放行
  assert.ok(!/if \(sessionStarted\.value\)/.test(fnSource), '不得依据 sessionStarted 布尔值直接允许发送')

  console.log('PASS portrait resync contract: 过期重建/断线重连/抖动保连/首开跳过 全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
