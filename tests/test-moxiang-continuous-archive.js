// continuous_v2 archive page behavior tests: execute the real page methods with boundary doubles.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const { parse } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '..')
const pagePath = path.join(root, 'pagesSub/profileExtra/my-portrait-archive.uvue')
const { descriptor, errors: parseErrors } = parse(fs.readFileSync(pagePath, 'utf8'))
assert.equal(parseErrors.length, 0, `SFC parse errors: ${parseErrors.join('; ')}`)
const source = descriptor.script.content

function extractFunctions(src, names) {
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] })
  const object = ast.program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration
  const methodObject = object.properties.find(n => n.key && n.key.name === 'methods')
  const candidates = methodObject ? methodObject.value.properties.concat(object.properties) : object.properties
  return names.map(name => {
    const item = candidates.find(n => n.key && n.key.name === name)
    assert.ok(item, `missing page function ${name}`)
    const body = src.slice(item.body.start, item.body.end)
    const params = '(' + item.params.map(param => src.slice(param.start, param.end)).join(', ') + ')'
    const asyncPrefix = item.async ? 'async ' : ''
    return `${asyncPrefix}function ${name}${params} ${body}`
  }).join('\n')
}

function run(names, ctx) {
  const code = babel.transformSync(extractFunctions(source, names), {
    filename: 'archive.ts', configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-typescript']
  }).code
  return vm.runInNewContext(`${code}\n;({${names.join(',')}})`, ctx)
}

const subject = (name, status = 'collecting', extra = {}) => ({
  subject: name, status, overall_percent: 30, dimensions: {}, draft_id: `${name}-draft`,
  expected_revision: 4, preview_id: `${name}-preview`, task_id: `${name}-task`,
  published_revision_id: status == 'confirmed' ? `${name}-published` : null,
  has_updates: false, last_error: null, ...extra
})
const state = (personal, ideal) => ({ flow_version: 'continuous_v2', consent_granted: true, session_id: 's', personal, ideal_partner: ideal })
const emptyArchive = () => ({ personal: { subject: 'personal', currentRevision: null, history: [], activeDraft: null, preview: null }, idealPartner: { subject: 'ideal_partner', currentRevision: null, history: [], activeDraft: null, preview: null }, fallbackAvailable: false })

function page(overrides = {}) {
  const calls = { builds: [], urls: [], modals: [], removed: 0, polls: 0, archiveLoads: 0, stateLoads: 0 }
  const ctx = {
    emptyArchive,
    errorCode: error => Number(error?.code ?? error?.statusCode ?? error?.status ?? 0),
    buildKey: subjectName => `archive-${subjectName}-stable-test-key`,
    archivePageAlive: true, archivePageVisible: true, archiveRequestSeq: 1, archiveLifecycleSeq: 0,
    continuousState: state(subject('personal'), subject('ideal_partner')),
    archive: emptyArchive(), pollTimer: null, errorMessage: '', loading: false,
    memorySheetVisible: false, continuousPendingBuilds: new Map(), continuousActionBusy: new Set(),
    getMoxiangArchive: async () => { calls.archiveLoads++; return emptyArchive() },
    getContinuousMoxiangState: async () => { calls.stateLoads++; return ctx.continuousState ?? state(subject('personal'), subject('ideal_partner')) },
    buildContinuousPortrait: async (...args) => {
      calls.builds.push(args)
      const next = args[0] == 'personal'
        ? subject('personal', 'awaiting_confirmation')
        : subject('ideal_partner', 'awaiting_confirmation')
      return state(next, subject('ideal_partner', 'confirmed'))
    },
    uni: {
      removeStorageSync: () => calls.removed++,
      navigateTo: x => calls.urls.push(x.url),
      redirectTo: x => calls.urls.push(x.url),
      navigateBack: () => {}, switchTab: () => {},
      showModal: options => { calls.modals.push(options); options.success({ confirm: true }) }
    },
    clearTimeout: () => {},
    setTimeout: () => { calls.polls++; return 1 },
    ...overrides
  }
  const names = [
    'clearContinuousPrivateCache', 'stopPolling', 'schedulePolling', 'refreshContinuousState',
    'loadArchive', 'openContinuousPortrait', 'openContinuousResult', 'goMaster', 'goLegacy',
    'openMemorySheet', 'closeMemorySheet'
  ]
  const fns = run(names, ctx)
  const bound = Object.fromEntries(names.map(name => [name, fns[name].bind(ctx)]))
  return { ctx, calls, ...bound }
}

function lifecycle(ctx) {
  const names = ['onHide', 'onShow', 'onUnload']
  const fns = run(names, ctx)
  return Object.fromEntries(names.map(name => [name, fns[name].bind(ctx)]))
}

async function main() {
  {
    const t = page({ continuousState: state(subject('personal'), subject('ideal_partner', 'generating')) })
    await t.openContinuousPortrait('ideal_partner')
    assert.equal(t.calls.builds.length, 0, 'generating must open the requested subject without rebuilding')
    assert.match(t.calls.urls[0], /subject=ideal_partner.*draft_id=ideal_partner-draft/)
    assert.doesNotMatch(t.calls.urls[0], /personal-draft/)
  }
  {
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = async (...args) => {
      t.calls.builds.push(args)
      return state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner'))
    }
    await t.openContinuousPortrait('personal')
    assert.deepEqual(t.calls.builds[0].slice(0, 2), ['personal', false], 'failed retry must not force refresh')
  }
  {
    let rejectBuild
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = (...args) => {
      t.calls.builds.push(args)
      return new Promise((resolve, reject) => { rejectBuild = reject })
    }
    const first = t.openContinuousPortrait('personal')
    await Promise.resolve()
    rejectBuild(new Error('request timeout'))
    await first
    const second = t.openContinuousPortrait('personal')
    await Promise.resolve()
    assert.equal(t.calls.builds.length, 2)
    assert.deepEqual(t.calls.builds[0], t.calls.builds[1], 'timeout retry reuses refresh and idempotency key')
    rejectBuild(new Error('request timeout again'))
    await second
  }
  {
    let resolveBuild
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = (...args) => {
      t.calls.builds.push(args)
      return new Promise(resolve => { resolveBuild = resolve })
    }
    const first = t.openContinuousPortrait('personal')
    const second = t.openContinuousPortrait('personal')
    await Promise.resolve()
    assert.equal(t.calls.builds.length, 1, 'same-subject double tap starts one build')
    resolveBuild(state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner')))
    await Promise.all([first, second])
  }
  {
    let resolveBuild
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = () => new Promise(resolve => { resolveBuild = resolve })
    const pending = t.openContinuousPortrait('personal')
    t.lifecycle = lifecycle(t.ctx)
    t.lifecycle.onHide()
    resolveBuild(state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner')))
    await pending
    assert.equal(t.calls.urls.length, 0, 'hidden page ignores a late build response')
    assert.equal(t.ctx.continuousState.personal.status, 'failed')
  }
  {
    let resolveBuild
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = () => new Promise(resolve => { resolveBuild = resolve })
    const pending = t.openContinuousPortrait('personal')
    t.clearContinuousPrivateCache()
    resolveBuild(state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner')))
    await pending
    assert.equal(t.ctx.continuousState, null, 'revocation clears state before an in-flight build can write')
    assert.equal(t.calls.urls.length, 0)
    assert.equal(t.calls.removed, 1)
  }
  {
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = async (...args) => {
      t.calls.builds.push(args)
      return { ...state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner')), consent_granted: false }
    }
    await t.openContinuousPortrait('personal')
    assert.equal(t.calls.urls.length, 0, 'revoked build response must not navigate')
    assert.equal(t.ctx.continuousState, null, 'revoked build response clears private state')
  }
  {
    const t = page()
    await t.refreshContinuousState()
    assert.equal(t.calls.builds.length, 0, 'read-only polling never starts a build')
    assert.equal(t.calls.stateLoads, 1)
  }
  {
    const t = page({ continuousState: state(subject('personal', 'confirmed', { has_updates: true }), subject('ideal_partner')) })
    t.ctx.uni.showModal = options => { t.calls.modals.push(options); options.success({ confirm: false }) }
    await t.openContinuousPortrait('personal')
    assert.equal(t.calls.builds.length, 0, 'frozen draft requires an explicit merge choice')
    assert.match(t.calls.urls[0], /subject=personal.*published=1/)
  }
  {
    const t = page({ continuousState: state(subject('personal', 'confirmed', { has_updates: true }), subject('ideal_partner')) })
    await t.openContinuousPortrait('personal')
    assert.deepEqual(t.calls.builds[0].slice(0, 2), ['personal', true])
  }
  {
    const t = page()
    const life = lifecycle(t.ctx)
    life.onHide()
    assert.equal(t.ctx.loading, false)
    t.ctx.getMoxiangArchive = async () => { t.calls.archiveLoads++; return emptyArchive() }
    t.ctx.getContinuousMoxiangState = async () => { t.calls.stateLoads++; return t.ctx.continuousState }
    life.onShow()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(t.calls.archiveLoads, 1, 'show after hide reloads the archive')
    assert.equal(t.calls.stateLoads, 1, 'show after hide reloads state')
  }
  {
    const t = page()
    t.openMemorySheet()
    assert.equal(t.ctx.memorySheetVisible, true)
    await t.closeMemorySheet()
    assert.equal(t.ctx.memorySheetVisible, false)
    assert.equal(t.calls.stateLoads, 1, 'closing data management rechecks consent')
    t.goLegacy('personal')
    assert.match(t.calls.urls[0], /subject=personal$/)
  }
  for (const code of [401, 403]) {
    const t = page({ loading: true, pollTimer: 1 })
    t.ctx.getContinuousMoxiangState = async () => { throw Object.assign(new Error('denied'), { code }) }
    await t.loadArchive()
    assert.equal(t.ctx.loading, false, 'authorization failure must exit loading')
    assert.equal(t.ctx.continuousState, null)
    assert.equal(t.ctx.pollTimer, null)
    assert.match(t.ctx.errorMessage, /授权状态已变化/)
  }
  {
    let answer
    const t = page({ continuousState: state(subject('personal', 'confirmed', { has_updates: true }), subject('ideal_partner')) })
    t.ctx.uni.showModal = options => { answer = options.success }
    const pending = t.openContinuousPortrait('personal')
    lifecycle(t.ctx).onHide()
    t.ctx.archivePageVisible = true
    answer({ confirm: true })
    await pending
    assert.equal(t.calls.builds.length, 0, 'a modal from before hide must not mutate after return')
    assert.equal(t.calls.urls.length, 0)
  }
  {
    let resolveOld
    const t = page()
    t.ctx.getContinuousMoxiangState = () => new Promise(resolve => { resolveOld = resolve })
    const pending = t.refreshContinuousState()
    t.ctx.getContinuousMoxiangState = async () => ({ ...state(subject('personal'), subject('ideal_partner')), consent_granted: false })
    await t.closeMemorySheet()
    resolveOld(state(subject('personal', 'confirmed'), subject('ideal_partner')))
    await pending
    assert.equal(t.ctx.continuousState, null, 'management close invalidates earlier reads before rechecking consent')
    assert.equal(t.ctx.loading, false)
  }
  {
    const resolvers = []
    const t = page({ continuousState: state(subject('personal', 'failed'), subject('ideal_partner')) })
    t.ctx.buildContinuousPortrait = () => new Promise(resolve => { resolvers.push(resolve) })
    const first = t.openContinuousPortrait('personal')
    lifecycle(t.ctx).onHide()
    t.ctx.archivePageVisible = true
    const second = t.openContinuousPortrait('personal')
    resolvers[0](state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner')))
    await first
    assert.equal(t.ctx.continuousActionBusy.has('personal'), true, 'old finally must not unlock a newer action')
    assert.equal(t.calls.urls.length, 0)
    resolvers[1](state(subject('personal', 'awaiting_confirmation'), subject('ideal_partner')))
    await second
    assert.equal(t.ctx.continuousActionBusy.has('personal'), false)
    assert.equal(t.calls.urls.length, 1)
  }
  console.log('PASS archive continuous_v2: subject routing/consistent builds/dedup/timeout retry/late response/hide-show/frozen draft/legacy/data management')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
