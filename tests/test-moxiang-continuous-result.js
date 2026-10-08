// 执行真实页面方法与契约适配器；只替换网络、时钟和 uni 端侧边界。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const sfc = require('@vue/compiler-sfc')
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const compile = src => babel.transformSync(src, { filename: 'runtime.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
function functions(file, names, context = {}) {
  const src = read(file)
  const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body.map(n => n.declaration || n)
  const selected = names.map(name => {
    const n = nodes.find(n => n.id?.name === name)
    assert.ok(n, name)
    return src.slice(n.start, n.end)
  }).join('\n')
  return vm.runInNewContext(compile(selected) + '\n;({' + names.join(',') + '})', context)
}
const field = (key, value, kind = 'structured') => ({ field_key: key, field_kind: kind, value_json: value, content: kind === 'entry' ? value : '', display_value: String(value), category: null, change: 'added', previous_display_value: null })
const preview = (changes = {}) => ({ flow_version: 'continuous_v2', preview_id: 'p1', draft_id: 'd1', expected_revision: 1, subject: 'personal', status: 'active', content: '我偏好安静的生活。', generation_status: 'completed', task_id: 't1', fields: [field('age', 28), field('entry_1', '安静', 'entry')], boundary_changed: false, last_error: '', ...changes })
const profileFns = functions('api/ai-profile.uts', ['coerceProfileFieldValue', 'fieldAction'])
const parsed = sfc.parse(read('pagesSub/profileExtra/my-portrait-result.uvue'))
assert.deepEqual(parsed.errors, [])
assert.deepEqual(sfc.compileTemplate({ source: parsed.descriptor.template.content, filename: 'result.uvue', id: 'result-test' }).errors, [])
const src = parsed.descriptor.script.content
const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body
const pageCode = nodes.filter(n => n.type !== 'ImportDeclaration').map(n => n.type === 'ExportDefaultDeclaration' ? 'const page = ' + src.slice(n.declaration.start, n.declaration.end) : src.slice(n.start, n.end)).join('\n')
function fixture() {
  const calls = { get: [], create: [], patch: [], confirm: [], legacy: 0, build: [], modal: [], alert: [], timers: new Map() }
  let timer = 0, key = 0
  const ctx = {
    ...profileFns, MoxiangPosterSheet: {}, fieldLabel: x => x, genIdempotencyKey: () => `key-${++key}`,
    setTimeout: fn => { calls.timers.set(++timer, fn); return timer }, clearTimeout: id => calls.timers.delete(id),
    uni: { getSystemInfoSync: () => ({ windowWidth: 375 }), getMenuButtonBoundingClientRect: () => null,
      showToast: () => {}, showModal: options => calls.modal.push(options),
      enableAlertBeforeUnload: x => calls.alert.push(x), disableAlertBeforeUnload: () => calls.alert.push(false) },
    getContinuousProfilePreview: async id => { calls.get.push(id); return preview() },
    createContinuousProfilePreview: async (id, revision) => { calls.create.push([id, revision]); return preview({ preview_id: 'p2', expected_revision: revision, generation_status: 'queued', content: '' }) },
    patchProfileDraftWithKey: async (...args) => { calls.patch.push(args); return { success: true, data: { expected_revision: 2 } } },
    confirmProfilePreview: async (...args) => { calls.confirm.push(args); return { success: true, data: { revision_id: 'r1' } } },
    getPortraitNarrative: async () => ({ success: true, data: { status: 'confirmed', insight: '我偏好安静的生活。' } }),
    getMeProfile: async () => ({ success: true, data: {} }), getOwnProfile: async () => ({ success: true, data: {} }),
    publishProfileDraft: async () => calls.legacy++, regeneratePortraitNarrative: async () => calls.legacy++,
    buildContinuousPortrait: async (...args) => { calls.build.push(args); return { consent_granted: true, personal: { draft_id: 'd1', preview_id: 'p2', expected_revision: 2 } } }
  }
  const options = vm.runInNewContext(compile(pageCode) + '\n;page', ctx)
  const page = { ...options.data(), continuousFlow: true, loading: false, draftId: 'd1', previewId: 'p1', expectedRevision: 1 }
  for (const [name, fn] of Object.entries(options.methods)) page[name] = fn.bind(page)
  for (const [name, fn] of Object.entries(options.computed)) Object.defineProperty(page, name, { get: fn.bind(page) })
  return { page, ctx, calls, options }
}
async function main() {
  let scenarios = 0
  {
    const { page: p, ctx, calls } = fixture()
    for (const generation_status of ['queued', 'processing', 'failed']) {
      ctx.getContinuousProfilePreview = async () => preview({ generation_status, content: '' })
      await p.loadContinuousPreview(false)
      assert.equal(p.canConfirmContinuous, false)
      assert.equal(p.continuousPreview.generation_status, generation_status)
    }
    assert.equal(calls.create.length + calls.build.length + calls.confirm.length, 0, '轮询只能读取')
    ctx.getContinuousProfilePreview = async () => preview()
    await p.loadContinuousPreview(false)
    assert.equal(p.canConfirmContinuous, true)
    assert.equal(p.publishedMode, false, '生成绝不等于确认')
    scenarios++
  }
  {
    const { page: p, ctx, options } = fixture()
    let resolve
    ctx.getContinuousProfilePreview = () => new Promise(r => { resolve = r })
    const pending = p.loadContinuousPreview(false)
    options.onHide.call(p)
    resolve(preview())
    await pending
    assert.equal(p.continuousPreview, null, '后台迟到响应不能写回')
    scenarios++
  }
  {
    const { page: p, ctx } = fixture()
    p.applyContinuousPreview(preview())
    p.beginContinuousEdit()
    p.onContinuousFieldInput(0, { detail: { value: '30' } })
    ctx.getContinuousProfilePreview = async () => preview({ status: 'stale', content: '另端改稿' })
    await p.loadContinuousPreview(false)
    assert.equal(p.continuousRows[0].editor_text, '30')
    assert.equal(p.continuousPreview.content, preview().content)
    assert.equal(p.continuousConflict, true)
    assert.equal(p.canConfirmContinuous, false)
    scenarios++
  }
  {
    const { page: p, calls } = fixture()
    p.applyContinuousPreview(preview())
    p.beginContinuousEdit()
    p.onContinuousFieldInput(0, { detail: { value: '30' } })
    p.toggleContinuousField(1)
    assert.equal(p.canConfirmContinuous, false)
    p.leaveReview(() => { throw new Error('不能直接离开') })
    assert.equal(calls.modal.length, 1)
    await p.saveContinuousEdits()
    assert.equal(calls.patch[0][1][0].value, 30, '数字字段不能变字符串')
    assert.equal(calls.patch[0][1][1].action, 'delete')
    assert.deepEqual(Array.from(calls.create[0]), ['d1', 2])
    assert.equal(p.previewId, 'p2')
    assert.equal(p.canConfirmContinuous, false, '保存后新正文尚未生成不能确认')
    scenarios++
  }
  {
    const { page: p, ctx, calls } = fixture()
    p.applyContinuousPreview(preview())
    p.beginContinuousEdit()
    p.onContinuousFieldInput(0, { detail: { value: '30' } })
    ctx.patchProfileDraftWithKey = async (...args) => { calls.patch.push(args); throw new Error('timeout') }
    await p.saveContinuousEdits()
    p.onContinuousFieldInput(0, { detail: { value: '31' } })
    await p.saveContinuousEdits()
    assert.equal(calls.patch.length, 2)
    assert.equal(JSON.stringify(calls.patch[0]), JSON.stringify(calls.patch[1]), '超时重试冻结原 payload/key')
    assert.equal(p.continuousRows[0].editor_text, '30')
    assert.equal(p.canConfirmContinuous, false)
    scenarios++
  }
  {
    const { page: p, ctx, calls } = fixture()
    p.applyContinuousPreview(preview())
    let resolve
    ctx.confirmProfilePreview = (...args) => { calls.confirm.push(args); return new Promise(r => { resolve = r }) }
    const first = p.confirmContinuousPreview()
    await p.confirmContinuousPreview()
    assert.equal(calls.confirm.length, 1, '连点只写一次')
    resolve({ success: false, message: 'timeout' })
    await first
    assert.equal(p.continuousConfirmPending, true)
    p.beginContinuousEdit()
    assert.equal(p.continuousEditing, false, '结果待核对时不能换稿')
    ctx.confirmProfilePreview = async (...args) => { calls.confirm.push(args); return { success: true, data: { revision_id: 'r1' } } }
    await p.confirmContinuousPreview()
    assert.equal(JSON.stringify(calls.confirm[0]), JSON.stringify(calls.confirm[1]))
    assert.equal(p.publishedMode, true)
    assert.equal(p.narrative.status, 'confirmed')
    assert.equal(calls.legacy, 0)
    scenarios++
  }
  {
    const { page: p, ctx } = fixture()
    p.applyContinuousPreview(preview())
    ctx.confirmProfilePreview = async () => ({ success: false, code: 409 })
    await p.confirmContinuousPreview()
    assert.equal(p.continuousConflict, true)
    assert.equal(p.publishedMode, false)
    assert.equal(p.continuousPreview.content, preview().content)
    scenarios++
  }
  {
    const { page: p, ctx, calls } = fixture()
    p.applyContinuousPreview(preview({ status: 'failed', generation_status: 'failed' }))
    ctx.getContinuousProfilePreview = async id => { calls.get.push(id); return preview({ preview_id: id, expected_revision: 2, generation_status: 'queued', content: '' }) }
    await p.retryContinuousBuild()
    assert.equal(calls.get[0], 'p2', '重试采用服务端返回稿件，而非读取旧失败稿')
    assert.ok(calls.build[0][2])
    scenarios++
  }
  {
    const { page: p, ctx } = fixture()
    p.applyContinuousPreview(preview())
    p.narrative = { status: 'confirmed', insight: '私密理解' }
    p.profileCardRows = [{ value: '私密字段' }]
    ctx.getContinuousProfilePreview = async () => { throw { code: 403 } }
    await p.loadContinuousPreview(false)
    assert.equal(p.continuousPreview, null)
    assert.equal(p.continuousRows.length, 0)
    assert.equal(p.profileCardRows.length, 0)
    assert.equal(p.narrative, null)
    assert.equal(p.loading, false)
    scenarios++
  }
  {
    const { page: p, ctx } = fixture()
    p.publishedMode = true
    p.narrative = { status: 'confirmed', insight: '旧理解' }
    ctx.getPortraitNarrative = async () => ({ success: false, code: 403 })
    await p.loadNarrative(false)
    assert.equal(p.narrative, null, '正式稿撤权同样清私密缓存')
    let resolve
    ctx.getPortraitNarrative = () => new Promise(r => { resolve = r })
    const pending = p.loadNarrative(false)
    p.clearContinuousPrivateView()
    resolve({ success: true, data: { status: 'confirmed', insight: '迟到正文' } })
    await pending
    assert.equal(p.narrative, null)
    scenarios++
  }
  {
    const { page: p, calls } = fixture()
    await p.publishPreview()
    await p.onRegenerateNarrative()
    assert.equal(calls.legacy, 0, '新流程不消费旧发布/重新叙事')
    p.narrative = { status: 'pending_confirmation' }
    p.onOpenPoster()
    assert.equal(p.showPosterSheet, false)
    p.narrative.status = 'confirmed'
    p.onOpenPoster()
    assert.equal(p.showPosterSheet, true)
    scenarios++
  }
  {
    const f = profileFns.coerceProfileFieldValue
    assert.equal(f(1, ''), null)
    assert.equal(f(1, '28'), 28)
    assert.equal(f(1, 'oops'), null)
    assert.equal(f(true, 'false'), false)
    assert.equal(JSON.stringify(f(['a'], '["b"]')), '["b"]')
    const requests = []
    const api = functions('api/ai-moxiang.uts', ['unwrapMoxiangResponse', 'adaptContinuousPreview', 'createContinuousProfilePreview', 'getContinuousProfilePreview'], {
      MASTER_ROLE_NAME: '知遇',
      request: async options => { requests.push(options); return { success: true, data: preview() } }
    })
    assert.equal((await api.getContinuousProfilePreview('p/1')).preview_id, 'p1')
    await api.createContinuousProfilePreview('d/1', 2)
    assert.match(requests[0].url, /p%2F1$/)
    assert.equal(requests[1].data.expected_revision, 2)
    assert.throws(() => api.adaptContinuousPreview({ ...preview(), flow_version: 'legacy' }), /协议/)
    assert.throws(() => api.adaptContinuousPreview({ ...preview(), fields: [field('age', 1), field('age', 2)] }), /字段/)
    assert.throws(() => api.unwrapMoxiangResponse({ success: false, code: 403 }), e => e.code === 403)
    scenarios++
  }
  console.log(`PASS continuous result: ${scenarios} 行为场景（审阅/编辑/幂等/恢复/隐私/旧接口门禁）`)
}
module.exports = { fixture, preview }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
