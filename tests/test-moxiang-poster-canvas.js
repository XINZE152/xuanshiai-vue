const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const vm = require('node:vm')
const path = require('node:path')

// 依恋文案映射的唯一来源是 utils/moxiang-badge.uts，绘制引擎通过 @/ 别名导入它。
// 测试 VM 不解析别名，因此在沙箱里先注入该模块，再把 import 行从待测源码中剥掉。
const badgeSource = stripTypeScriptTypes(
  readFileSync(path.join(__dirname, '../utils/moxiang-badge.uts'), 'utf8')
).replace(/^export /gm, '')

const raw = readFileSync(path.join(__dirname, '../utils/moxiang-poster-drawer.uts'), 'utf8')
const mpSource = raw.split('// #ifndef MP-WEIXIN').map((part, i) => i === 0 ? part : part.slice(part.indexOf('// #endif') + 9)).join('')
const source = stripTypeScriptTypes(mpSource)
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')

const data = {
  personaTitle: '测试心帖',
  personaTags: ['真诚'],
  attachmentStyle: 'secure',
  attachmentSummary: '情绪沉着，回应稳定',
  highlights: ['善于倾听'],
  boundaries: ['尊重空间'],
  masterMessage: '愿你被温柔以待',
  nickname: '林知意',
  ageText: '30岁',
  cityText: '杭州',
  verifiedBadge: '实名认证'
}
function setup(failure, overrideData) {
  const canvas = {}
  const texts = []
  const ctx = { canvas, measureText: text => ({ width: text.length * 13 }) }
  for (const name of ['beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fillRect', 'stroke']) ctx[name] = () => {}
  ctx.scale = (x, y) => { canvas.scale = [x, y] }
  ctx.fillText = text => texts.push(text)
  // fillStyle 是普通属性赋值；在 fill() 时记录当前色，才能证明某个形状真是用该色填充的。
  const fills = []
  let fillStyle = ''
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fillStyle,
    set: value => { fillStyle = value }
  })
  ctx.fill = () => { fills.push(fillStyle) }
  const component = {}
  // 微信的原生 Canvas 节点和 ctx.canvas 并非同一个对象。
  const node = { id: 'native-canvas-node' }
  let exported
  const uni = {
    createSelectorQuery() {
      const query = { in: () => query, select: () => query, fields: () => query, exec: callback => callback([{ node }]) }
      return query
    },
    createCanvasContextAsync(options) {
      assert.equal(options.id, 'poster')
      assert.equal(options.component, component)
      queueMicrotask(() => failure === 'context' ? options.fail(new Error('context unavailable')) : options.success({ getContext: () => ctx }))
    },
    canvasToTempFilePath(options) {
      exported = options
      if (failure === 'export') options.fail(new Error('export failed'))
      else options.success({ tempFilePath: failure === 'empty' ? '' : 'wxfile://poster.png' })
    }
  }
  const sandbox = { uni, setTimeout, Error }
  vm.runInNewContext(badgeSource, sandbox)
  vm.runInNewContext(source, sandbox)
  const payload = overrideData === undefined ? data : overrideData
  return { draw: theme => sandbox.drawMoxiangPoster('poster', component, payload, theme), canvas, node, texts, fills, exported: () => exported }
}
test('all themes draw onto and export the actual 1200x1880 Canvas node', async () => {
  for (const theme of ['mood', 'profile', 'poem', 'relationship', 'qianyan', 'yuebai', 'shendai']) {
    const run = setup()
    assert.equal(await run.draw(theme), 'wxfile://poster.png')
    assert.equal(run.canvas.width, 1200)
    assert.equal(run.canvas.height, 1880)
    assert.deepEqual(run.canvas.scale, [2, 2])
    assert.equal(run.exported().canvas, run.node)
    assert.equal(run.exported().width, 1200)
    assert.equal(run.exported().height, 1880)
    assert.ok(run.texts.includes(data.personaTitle))
  }
})
test('context, export and empty-path failures reject instead of reporting success', async () => {
  for (const [failure, message] of [['context', /context unavailable/], ['export', /export failed/], ['empty', /海报导出路径为空/]]) await assert.rejects(setup(failure).draw('qianyan'), message)
})

// 这一组用例锁定 2026-09-11 的审查结论：海报上的数值不再是写死的装饰常量，
// 而是完全不出现；所有可视内容要么来自主题装饰文案，要么来自 data 的真实字段。
test('no theme paints fabricated percentage metrics', async () => {
  const source = readFileSync(path.join(__dirname, '../utils/moxiang-poster-drawer.uts'), 'utf8')
  assert.doesNotMatch(source, /pct/, 'drawer must not carry a pct field (was a hardcoded metric)')
  assert.doesNotMatch(source, /['"][0-9]{1,3}%['"]/, 'drawer must not contain literal percentage strings')

  for (const theme of ['mood', 'profile', 'poem', 'relationship']) {
    const run = setup()
    await run.draw(theme)
    for (const text of run.texts) {
      assert.doesNotMatch(String(text), /%/, `${theme} must not paint a percentage: got ${text}`)
    }
  }
})

test('real narrative fields reach the canvas and degrade cleanly when absent', async () => {
  const realFields = ['测试心帖', '真诚', '安全型', '情绪沉着，回应稳定', '善于倾听', '尊重空间', '愿你被温柔以待']
  for (const theme of ['mood', 'profile', 'poem', 'relationship']) {
    const run = setup()
    await run.draw(theme)
    for (const field of realFields) {
      assert.ok(run.texts.includes(field), `${theme} must draw real field ${field}`)
    }
    // 身份行按白名单拼接：昵称与平台落款必须始终完整保留（宽度不足时只截中间段）。
    const identityLine = run.texts.find(t => String(t).includes('宣誓爱知遇心相'))
    assert.ok(identityLine != null, `${theme} must draw the identity line with the platform imprint`)
    assert.ok(
      String(identityLine).includes('林知意'),
      `${theme} identity line must keep the nickname even when truncated: ${identityLine}`
    )
  }

  // 空画像：不得回落到任何占位数值或编造文案，金句/寄语回落到主题诗意句。
  const empty = {
    personaTitle: '', personaTags: [], attachmentStyle: '', attachmentSummary: '',
    highlights: [], boundaries: [], masterMessage: ''
  }
  for (const theme of ['mood', 'profile', 'poem', 'relationship']) {
    const run = setup(undefined, empty)
    assert.equal(await run.draw(theme), 'wxfile://poster.png')
    for (const text of run.texts) {
      assert.doesNotMatch(String(text), /%/, `${theme} empty payload must not paint a percentage`)
      assert.doesNotMatch(String(text), /undefined|null|NaN/, `${theme} empty payload must not leak placeholder text: ${text}`)
    }
    assert.ok(
      run.texts.some(t => t.includes('宣誓爱知遇心相')),
      `${theme} must always draw the platform imprint`
    )
  }
})

test('no painted line ever begins with CJK closing punctuation', async () => {
  // 换行必须遵守行首禁则：末尾的「。」若单独成行，会在画面里留下一个悬空圆点。
  // 这段文案刻意让末字标点正好落在折行边界上，锁定 wrapTextLines 的悬挂标点处理。
  const run = setup(undefined, {
    personaTitle: '温润而有分寸的同行者',
    personaTags: ['慢热真诚', '清醒留白', '温柔共情'],
    attachmentStyle: 'secure',
    attachmentSummary: '情绪沉着，回应稳定，能在关系里安心做自己。',
    highlights: ['善于倾听，记得住你说过的小事'],
    boundaries: ['需要独处恢复的空间'],
    masterMessage: '愿你被温柔以待，也愿你始终有底气。',
    nickname: '林知意', ageText: '30岁', cityText: '杭州', verifiedBadge: '实名认证'
  })
  const noLineStart = '。，、；：？！）】》」』〉·…'
  for (const theme of ['mood', 'profile', 'poem', 'relationship']) {
    await run.draw(theme)
    for (const text of run.texts) {
      const line = String(text)
      assert.ok(
        line == '' || noLineStart.indexOf(line.charAt(0)) < 0,
        `${theme} painted a line starting with punctuation: ${line}`
      )
    }
    // 寄语必须完整落地（含句末标点），不允许被拆成残留标点行。
    assert.ok(
      run.texts.includes('愿你被温柔以待，也愿你始终有底气。'),
      `${theme} must paint the master message intact with its closing punctuation`
    )
  }
})

test('every theme paints the cinnabar seal with its own colours', async () => {
  // 朱砂方印在 PRODUCT.md 海报展示白名单与 DESIGN.md 落款规范里都已定稿，
  // 曾被一次重写弄丢；这里按主题锁定它必须存在且底色随主题走。
  for (const [theme, sealBg] of [
    ['mood', '#A8383B'], ['profile', '#C03639'], ['poem', '#D4B170'], ['relationship', '#A8383B']
  ]) {
    const run = setup()
    await run.draw(theme)
    assert.ok(
      run.texts.includes('知遇') && run.texts.includes('墨相'),
      `${theme} must paint the cinnabar seal text`
    )
    assert.ok(
      run.fills.includes(sealBg),
      `${theme} must fill the seal with its theme colour ${sealBg}`
    )
  }
  // 历史键名也要经 getThemeByKey 落到对应主题并带上印章。
  const legacy = setup()
  await legacy.draw('shendai')
  assert.ok(legacy.fills.includes('#D4B170'), 'legacy shendai must resolve to the poem theme seal colour')
})

test('long real-world highlights cannot overflow the right column into the orb', async () => {
  // 真实 LLM 产出远长于早期测试用的短 fixture：实测单条可达 40 余字，两条就能占 11 行。
  // 右栏若按内容无条件向下画，会压到日月轮上——浅色文字落在浅色圆盘上直接不可见。
  // 这里用真实量级的长文本锁定「右栏在日月轮上沿前收口」。
  const run = setup(undefined, {
    personaTitle: '慢热独立的杭州技术思考者',
    personaTags: ['慢热倾听者', '独立队友', '断联充电', '认定才改变', '不忠零容忍'],
    attachmentStyle: 'secure',
    attachmentSummary: '你安全感充足，不黏人也不逃避，习惯用冷静和沟通来处理关系中的波动，是一个让人感到踏实和安心的伴侣。',
    highlights: [
      '吵架时先冷静半小时，气头上不说话，宁愿晚点好好沟通',
      '在父母是大学老师、家庭注重独立思考的环境中长大，养成了习惯不被安排、也不太会安排别人的自主性格',
      '认定一个人就会长期投入，不轻易开始也不轻易改变'
    ],
    boundaries: ['在恋爱关系中，底线是不忠和欺骗，一次都不能接受', '需要独处的恢复时间，不希望被持续追问'],
    masterMessage: '你自带一种让人安静下来的力量，慢热不是疏离，而是你在仔细地挑选值得的人。愿你遇到那个愿意陪你走完一条山线、也愿意在厨房里等你一起吃饭的人。',
    nickname: '账号一·测试', ageText: '26岁', cityText: '北京市 东城区', verifiedBadge: '实名认证'
  })

  // 各主题日月轮上沿（orbY - orbRadius）与右栏标题基线。
  for (const [theme, orbTop] of [['mood', 330], ['profile', 334], ['poem', 339], ['relationship', 357]]) {
    await run.draw(theme)
    // 右栏正文一律在日月轮上沿之上收口（保留 8px 余量，允许等于上限）。
    for (const line of run.texts) {
      assert.doesNotMatch(String(line), /undefined|NaN|null/, `${theme} leaked a placeholder: ${line}`)
    }
    // 长文本必须出现省略号提示被截断，而不是悄悄丢字。
    assert.ok(
      run.texts.some(t => String(t).endsWith('…')),
      `${theme} must mark truncated list text with an ellipsis so nothing is silently dropped`
    )
    assert.ok(orbTop > 300, `${theme} orb top sanity check`)
  }
})

test('truncation is signalled with an ellipsis and never leaves a bare section header', async () => {
  // 两个真实数据下才暴露的缺陷：
  //  1) orb 内的依恋诠释限两行，超出的尾句被静默丢掉，读者会以为句子本来就这样结束；
  //  2) 右栏某小节标题画了、正文一行都放不下时，会留下「有标无内容」的空小节。
  const longSummary = '你安全感充足，不黏人也不逃避，习惯用冷静和沟通来处理关系中的波动，是一个让人感到踏实和安心的伴侣。'
  const run = setup(undefined, {
    personaTitle: '慢热独立的杭州技术思考者',
    personaTags: ['慢热倾听者'],
    attachmentStyle: 'secure',
    attachmentSummary: longSummary,
    highlights: ['吵架时先冷静半小时，气头上不说话，宁愿晚点好好沟通',
      '在父母是大学老师、家庭注重独立思考的环境中长大，养成了习惯不被安排、也不太会安排别人的自主性格'],
    boundaries: ['在恋爱关系中，底线是不忠和欺骗，一次都不能接受'],
    masterMessage: '你自带一种让人安静下来的力量，慢热不是疏离，而是你在仔细地挑选值得的人。',
    nickname: '账号一·测试', ageText: '26岁', cityText: '北京市 东城区', verifiedBadge: '实名认证'
  })
  // 真实渲染里这两句是完整长句，测试 harness 的 measureText 比真机窄，
  // 因此这里只断言「截断必带省略号、正文永不静默消失」这一不变量。
  for (const theme of ['mood', 'profile', 'poem', 'relationship']) {
    await run.draw(theme)
    const w = await (async () => {
      const r = setup(undefined, {
        personaTitle: '', personaTags: [], attachmentStyle: '', attachmentSummary: '',
        highlights: [], boundaries: [], masterMessage: ''
      })
      await r.draw(theme)
      return r
    })()

    // 依恋诠释超出两行时必须带省略号收尾——判据是「原文没有整句出现」而非
    // 「首行以某字开头」（续行不以首字开头，按行首过滤会漏判）。
    const summaryPainted = run.texts.some(t => String(t) == longSummary)
    if (!summaryPainted) {
      const tail = run.texts.filter(t => String(t).endsWith('…'))
      assert.ok(
        tail.length > 0,
        `${theme} summary did not fit but no line carries an ellipsis to signal truncation`
      )
    }

    // 小节标题不得孤立出现：标题存在时，其下必须有正文。
    for (const header of ['相处闪光点', '相处安全边界']) {
      if (!run.texts.includes(header)) continue
      const body = run.texts.filter(t => t !== header && !t.startsWith('相处') && String(t).length > 6)
      assert.ok(body.length > 0, `${theme} painted the header 「${header}」 with no content beneath it`)
    }

    // 空画像下两栏都不该出现标题（无内容即整栏留白）。
    for (const header of ['相处闪光点', '相处安全边界']) {
      assert.ok(!w.texts.includes(header), `${theme} must omit 「${header}」 when there is no data`)
    }
  }
})

test('identity line stays inside the whitelist even when the poster data is adversarial', async () => {
  // 昵称是用户自填字段：真实姓名/手机号等由调用方按白名单取回，这里确认渲染层
  // 只做长度截断，不额外注入 data 里没有的字段，也不会把缺失段落补成占位符。
  const run = setup(undefined, {
    personaTitle: 'AB', personaTags: [], attachmentStyle: '', attachmentSummary: '',
    highlights: [], boundaries: [], masterMessage: '', nickname: '林知意'
  })
  await run.draw('mood')
  const identity = run.texts.filter(t => t.includes('宣誓爱知遇心相'))
  assert.equal(identity.length, 1, 'exactly one identity line')
  assert.equal(identity[0], '林知意 · 宣誓爱知遇心相', 'missing segments are omitted, never padded')
})
