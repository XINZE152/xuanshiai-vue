// 海报公开来源安全：海报只能使用 export 接口返回的已采用公开字段，
// 不得再从 narrative.emotional_insight（依恋/底线/小结等仅本人可见内容）取材。
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
const PAGE = 'pagesSub/profileExtra/my-portrait-result.uvue'


async function main() {
  // 1. 源码层：posterData() 不得读取 emotional_insight。
  {
    const scriptSrc = sfc.parse(read(PAGE)).descriptor.script.content
    const nodes = parser.parse(scriptSrc, { sourceType: 'module', plugins: ['typescript'] }).program.body
    const options = nodes.find(n => n.type === 'ExportDefaultDeclaration').declaration
    const comp = options.properties.find(p => p.key?.name === 'computed')
    const posterProp = comp.value.properties.find(p => p.key?.name === 'posterData')
    const posterSrc = scriptSrc.slice(posterProp.start, posterProp.end)
    assert.ok(!posterSrc.includes('emotional_insight'), 'posterData 不得读取 emotional_insight')
    assert.ok(posterSrc.includes('posterPublic'), 'posterData 必须来自 posterPublic（export 结果）')
  }

  // 2. 真实方法执行：posterData 仅映射公开字段，私密洞察字段为空。
  {
    const parsed = sfc.parse(read(PAGE))
    assert.deepEqual(parsed.errors, [])
    const template = sfc.compileTemplate({ source: parsed.descriptor.template.content, filename: 'result.uvue', id: 'poster-public-test' })
    assert.deepEqual(template.errors, [])
    const src = parsed.descriptor.script.content
    const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body
    const pageCode = nodes.filter(n => n.type !== 'ImportDeclaration').map(n => n.type === 'ExportDefaultDeclaration' ? 'const page = ' + src.slice(n.declaration.start, n.declaration.end) : src.slice(n.start, n.end)).join('\n')
    const ctx = {
      MoxiangPosterSheet: {}, fieldLabel: x => x, genIdempotencyKey: () => 'k',
      setTimeout: () => 1, clearTimeout: () => {},
      uni: {
        getSystemInfoSync: () => ({ windowWidth: 375 }), getMenuButtonBoundingClientRect: () => null,
        showToast: () => {}, showModal: () => {}, enableAlertBeforeUnload: () => {}, disableAlertBeforeUnload: () => {}
      },
      getPublicProfileCardExport: async () => ({ success: true, data: { status: 'ready', subject: 'personal', revision_id: 7, source_revision_id: 7, public: { persona_title: '我的公开介绍', persona_tags: ['周末徒步'], self_intro: '喜欢徒步和看展' } } }),
      getPortraitNarrative: async () => ({ success: true, data: { status: 'confirmed', revision_id: 7 } }),
      getMeProfile: async () => ({ success: true, data: {} }), getOwnProfile: async () => ({ success: true, data: {} })
    }
    const options = vm.runInNewContext(compile(pageCode) + '\n;page', ctx)
    const page = { ...options.data(), subject: 'personal', narrative: { status: 'confirmed', revision_id: 7, persona_title: '内部标题', emotional_insight: { attachment_summary: '私密洞察', boundaries: ['私密底线'] } } }
    for (const [name, fn] of Object.entries(options.methods)) page[name] = fn.bind(page)
    for (const [name, fn] of Object.entries(options.computed)) Object.defineProperty(page, name, { get: fn.bind(page) })

    assert.equal(page.posterData, null, '未加载公开导出时不得渲染海报')
    await page.loadPublicPosterContent()
    assert.ok(page.posterData != null)
    assert.equal(page.posterData.personaTitle, '我的公开介绍')
    assert.equal(JSON.stringify(page.posterData.personaTags), JSON.stringify(['周末徒步']))
    assert.equal(JSON.stringify(page.posterData.highlights), JSON.stringify(['喜欢徒步和看展']))
    assert.equal(page.posterData.attachmentSummary, '')
    assert.equal(JSON.stringify(page.posterData.boundaries), JSON.stringify([]))
    assert.equal(page.posterData.masterMessage, '')
    assert.ok(!JSON.stringify(page.posterData).includes('私密洞察'))
    assert.ok(!JSON.stringify(page.posterData).includes('私密底线'))
  }

  // 3. 无公开内容 / 失败时不得渲染，并给出可解释提示。
  {
    const parsed = sfc.parse(read(PAGE))
    const src = parsed.descriptor.script.content
    const nodes = parser.parse(src, { sourceType: 'module', plugins: ['typescript'] }).program.body
    const pageCode = nodes.filter(n => n.type !== 'ImportDeclaration').map(n => n.type === 'ExportDefaultDeclaration' ? 'const page = ' + src.slice(n.declaration.start, n.declaration.end) : src.slice(n.start, n.end)).join('\n')
    const mk = api => {
      const ctx = { MoxiangPosterSheet: {}, fieldLabel: x => x, genIdempotencyKey: () => 'k', setTimeout: () => 1, clearTimeout: () => {}, uni: { getSystemInfoSync: () => ({ windowWidth: 375 }), getMenuButtonBoundingClientRect: () => null, showToast: () => {}, showModal: () => {}, enableAlertBeforeUnload: () => {}, disableAlertBeforeUnload: () => {} }, getPublicProfileCardExport: api, getMeProfile: async () => ({ success: true, data: {} }), getOwnProfile: async () => ({ success: true, data: {} }) }
      const options = vm.runInNewContext(compile(pageCode) + '\n;page', ctx)
      const page = { ...options.data(), subject: 'personal', narrative: { status: 'confirmed', revision_id: 7 } }
      for (const [name, fn] of Object.entries(options.methods)) page[name] = fn.bind(page)
      for (const [name, fn] of Object.entries(options.computed)) Object.defineProperty(page, name, { get: fn.bind(page) })
      return page
    }
    const noContent = mk(async () => ({ success: false, code: 404, message: '尚未采用可公开的资料卡内容' }))
    await noContent.loadPublicPosterContent()
    assert.equal(noContent.posterData, null)
    assert.ok(noContent.posterPublicError != '')

    const failed = mk(async () => { throw new Error('boom') })
    await failed.loadPublicPosterContent()
    assert.equal(failed.posterData, null)
    assert.ok(failed.posterPublicError != '')

    const noRevision = mk(async () => { throw new Error('should not be called') })
    noRevision.narrative = { status: 'confirmed' }
    await noRevision.loadPublicPosterContent()
    assert.equal(noRevision.posterData, null)
    assert.ok(noRevision.posterPublicError != '')
  }

  console.log('PASS poster public source: 3 场景（仅公开字段/私密不入选/失败可解释）')
}

module.exports = { main }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
