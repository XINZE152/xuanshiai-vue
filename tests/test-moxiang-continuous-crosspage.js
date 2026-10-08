// F2 跨页组合：执行档案页真实跳转与结果页真实 onLoad，验证「查看已确认稿」不再
// 被送进草稿预览。只替换网络与 uni 端侧边界，页面参数处理逻辑全部走真实实现。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const { parse } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const compile = src => babel.transformSync(src, {
  filename: 'runtime.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript']
}).code

// 从 SFC 的 export default 对象里取方法体，拼成可直接执行的独立函数。
function methods(file, names, fromMethods = true) {
  const src = parse(read(file)).descriptor.script.content
  const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body
  const object = nodes.find(n => n.type === 'ExportDefaultDeclaration').declaration
  const holder = fromMethods
    ? object.properties.find(n => n.key && n.key.name === 'methods').value.properties
    : object.properties
  return names.map(name => {
    const item = holder.find(n => n.key && n.key.name === name)
    assert.ok(item, `缺少真实方法 ${name}（${file}）`)
    const params = '(' + item.params.map(param => src.slice(param.start, param.end)).join(', ') + ')'
    const body = src.slice(item.body.start, item.body.end)
    return `${item.async ? 'async ' : ''}function ${name}${params} ${body}`
  }).join('\n')
}

function run(code, names, ctx) {
  return vm.runInNewContext(`${compile(code)}\n;({${names.join(',')}})`, ctx)
}

// 1) 档案页真实跳转：只产出 URL，不发请求。
function archiveNavigate(item, status) {
  const urls = []
  const ctx = {
    archivePageAlive: true, archivePageVisible: true,
    continuousState: { flow_version: 'continuous_v2', consent_granted: true, session_id: 's', personal: item, ideal_partner: item },
    uni: { navigateTo: x => urls.push(x.url) }
  }
  const fns = run(methods('pagesSub/profileExtra/my-portrait-archive.uvue', ['openContinuousResult']), ['openContinuousResult'], ctx)
  fns.openContinuousResult.call(ctx, 'personal', item, status)
  assert.equal(urls.length, 1, '真实跳转必须产出唯一 URL')
  return urls[0]
}

// 2) 结果页真实 onLoad：消费 URL 参数，记录它选择了哪条读取路径。
function resultOnLoad(url) {
  const calls = { narrative: 0, preview: 0, continuousPreview: 0, queries: [] }
  const src = parse(read('pagesSub/profileExtra/my-portrait-result.uvue')).descriptor.script.content
  const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body
  const pageCode = nodes.filter(n => n.type !== 'ImportDeclaration')
    .map(n => n.type === 'ExportDefaultDeclaration' ? 'const page = ' + src.slice(n.declaration.start, n.declaration.end) : src.slice(n.start, n.end))
    .join('\n')
  const ctx = {
    MoxiangPosterSheet: {}, fieldLabel: x => x, genIdempotencyKey: () => 'k',
    setTimeout: () => 1, clearTimeout: () => {},
    uni: { getSystemInfoSync: () => ({ windowWidth: 375 }), getMenuButtonBoundingClientRect: () => null, showToast: () => {}, showModal: () => {} },
    getContinuousProfilePreview: async () => { calls.continuousPreview++; return null },
    createContinuousProfilePreview: async () => { calls.continuousPreview++; return null },
    getPortraitNarrative: async () => { calls.narrative++; return { success: true, data: { status: 'confirmed', revision_id: 7, insight: '正式正文' } } },
    getProfilePreview: async () => { calls.preview++; return null },
    createProfilePreview: async () => { calls.preview++; return null },
    getMeProfile: async () => ({ success: true, data: {} }), getOwnProfile: async () => ({ success: true, data: {} }),
  }
  const options = vm.runInNewContext(compile(pageCode) + '\n;page', ctx)
  const page = { ...options.data() }
  for (const [name, fn] of Object.entries(options.methods ?? {})) page[name] = fn.bind(page)
  const query = Object.fromEntries(new URLSearchParams(url.slice(url.indexOf('?') + 1)))
  calls.queries.push(query)
  // onLoad/onShow/onHide 与 methods 同级，必须从根层取真实实现。
  const onLoad = options.onLoad ?? options.methods?.onLoad
  assert.ok(typeof onLoad == 'function', '缺少真实 onLoad')
  onLoad.call(page, query)
  return { page, calls, query }
}

async function main() {
  // 「档案 → 查看已确认稿」：后端 confirmed 状态仍然带已发布草稿的 draft_id，
  // 跳转绝不能把草稿参数带过去，否则结果页会请求草稿预览并拿到 409。
  const confirmed = {
    subject: 'personal', status: 'confirmed', has_updates: false,
    draft_id: 'published-draft', expected_revision: 3, preview_id: 'published-preview',
    published_revision_id: 42,
  }
  const url = archiveNavigate(confirmed, true)
  assert.match(url, /published=1/)
  assert.match(url, /revision_id=42/)
  assert.doesNotMatch(url, /draft_id=/, '已确认分支不得携带草稿参数')
  assert.doesNotMatch(url, /preview_id=/, '已确认分支不得携带预览参数')
  assert.doesNotMatch(url, /expected_revision=/)
  const target = resultOnLoad(url)
  assert.equal(target.page.publishedMode, true, '结果页必须识别为正式版本模式')
  assert.equal(target.page.draftId, '')
  assert.equal(target.page.previewId, '')
  assert.equal(target.page.expectedRevision, 0)
  assert.equal(target.page.publishedRevisionId, 42)
  assert.equal(target.calls.narrative, 1, '只读正式版本')
  assert.equal(target.calls.continuousPreview, 0, '不得请求草稿成稿预览')
  assert.equal(target.calls.preview, 0, '不得回落到旧草稿预览接口')

  // 已确认但补上了新证据时的「先看原稿」：同样走正式版本分支。
  const withUpdates = { ...confirmed, has_updates: true }
  const updatedUrl = archiveNavigate(withUpdates, true)
  assert.match(updatedUrl, /published=1/)
  assert.doesNotMatch(updatedUrl, /draft_id=/)
  const updated = resultOnLoad(updatedUrl)
  assert.equal(updated.page.publishedMode, true)
  assert.equal(updated.calls.continuousPreview, 0)

  // 反向保护：真正的最新草稿仍必须带草稿参数并读取草稿预览，不能被改成只读正式版。
  const draft = {
    subject: 'personal', status: 'awaiting_confirmation', has_updates: false,
    draft_id: 'live-draft', expected_revision: 5, preview_id: 'live-preview', published_revision_id: 42,
  }
  const draftUrl = archiveNavigate(draft, false)
  assert.match(draftUrl, /draft_id=live-draft/)
  assert.match(draftUrl, /preview_id=live-preview/)
  assert.doesNotMatch(draftUrl, /published=1/)
  const draftTarget = resultOnLoad(draftUrl)
  assert.equal(draftTarget.page.publishedMode, false, '待核对草稿不能被当成正式版本')
  assert.equal(draftTarget.page.draftId, 'live-draft')
  assert.equal(draftTarget.page.previewId, 'live-preview')
  assert.equal(draftTarget.calls.continuousPreview, 1, '草稿必须读取草稿成稿预览')
  assert.equal(draftTarget.calls.narrative, 0)

  // 已确认模式下读到别的版本必须如实说明，不能把另一版正文当作刚确认的那一版。
  const stale = resultOnLoad(url)
  assert.equal(stale.page.narrativeNotice, '', '版本一致时不得残留提示')
  const other = resultOnLoad(url)
  other.calls.queries.push({})
  const page = other.page
  page.publishedRevisionId = 99
  page.continuousReadSeq = 0
  await page.loadNarrative(false)
  assert.match(page.narrativeNotice, /第 7 版/, '版本漂移必须提示当前生效版本')
}
main().then(() => console.log('PASS continuous_v2 crosspage: 档案→结果页参数组合（已确认只读正式版/草稿仍走预览/版本漂移提示）'))
  .catch(error => { console.error(error); process.exitCode = 1 })
