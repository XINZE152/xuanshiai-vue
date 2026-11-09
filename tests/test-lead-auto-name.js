const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const source = fs.readFileSync(require('node:path').join(__dirname, '../pagesSub/matchmaker/become-matchmaker.uvue'), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const body = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const decl = name => body.find(n => n.type === 'VariableDeclaration' && n.declarations?.[0]?.id?.name === name)
const compile = nodes => babel.transformSync(nodes.map(n => source.slice(n.start, n.end)).join('\n'), { filename: 'lead-auto-name.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code

// 前缀必须与后台「客源线索-功能配置」的 name_prefix 默认值一致。
assert.equal(vm.runInNewContext(compile([decl('LEAD_AUTO_NAME_PREFIX')]) + '\n;LEAD_AUTO_NAME_PREFIX', {}), '客源')

// 只取「自动生成称呼」这一组函数在沙箱里执行；状态由外部注入，便于断言。
const NAMES = ['resetLeadAutoName', 'onLeadFormNameInput', 'nextLeadAutoNameCode', 'toggleLeadAutoName', 'applyCreatedLeadAutoName']
const nodes = NAMES.map(decl)
assert.equal(nodes.filter(n => n != null).length, NAMES.length, '自动生成称呼的函数声明缺失')
const ref = value => ({ value })
let calls = [], pages = [], patches = []
const state = {
  LEAD_AUTO_NAME_PREFIX: '客源',
  leadAutoName: ref(false), leadAutoNameCode: ref(''), leadAutoNameBusy: ref(false),
  leadFormName: ref(''), leadFormIsEdit: ref(false), leadFormError: ref(''),
  getMatchmakerWorkspaceLeads: async page => { calls.push(page); return pages.shift() },
  updateWorkspaceLead: async (id, changes) => { patches.push(id + '=' + changes.name); return { success: true, data: null } }
}
const api = vm.runInNewContext(compile(nodes) + '\n;({ resetLeadAutoName, onLeadFormNameInput, nextLeadAutoNameCode, toggleLeadAutoName, applyCreatedLeadAutoName })', state)
const result = (items, more) => ({ success: true, data: { page: 1, items, has_more: more } })
async function run() {
  // 1. 已有客源：预览号 = 列表首条（编号倒序的最大编号）+1，且只读第一页。
  calls = []; pages = [result([{ id: 26 }, { id: 24 }], true), result([{ id: 2 }], false)]
  await api.toggleLeadAutoName()
  assert.equal(calls.join(','), '1')
  assert.equal(state.leadAutoName.value, true)
  assert.equal(state.leadAutoNameCode.value, '客源_27')
  assert.equal(state.leadFormName.value, '客源_27')
  // 2. 库里还没有客源：第一位写成 客源_1。
  calls = []; pages = [result([], false)]
  state.leadAutoName.value = false
  await api.toggleLeadAutoName()
  assert.equal(state.leadFormName.value, '客源_1')
  // 3. 编号读取失败：退回未勾选，不占住称呼输入框。
  pages = [{ success: false, message: '连接失败' }]
  state.leadAutoName.value = false
  state.leadFormName.value = ''
  await api.toggleLeadAutoName()
  assert.equal(state.leadAutoName.value, false)
  assert.equal(state.leadFormName.value, '')
  assert.match(state.leadFormError.value, /客源编号获取失败/)
  // 4. 勾选后手动改称呼：自动退出勾选，文本原样保留。
  state.leadFormError.value = ''
  pages = [result([{ id: 26 }], false)]
  await api.toggleLeadAutoName()
  api.onLeadFormNameInput({ detail: { value: '客源_27（李老师）' } })
  assert.equal(state.leadAutoName.value, false)
  assert.equal(state.leadFormName.value, '客源_27（李老师）')
  // 5. 真实编号与预览一致：不再补一次改写请求。
  patches = []
  state.leadAutoName.value = true
  state.leadFormIsEdit.value = false
  state.leadFormName.value = '客源_27'
  await api.applyCreatedLeadAutoName({ success: true, data: { id: 27 } })
  assert.equal(patches.join(','), '')
  // 6. 工作范围外已有更大编号：用服务端返回的真实编号校正。
  await api.applyCreatedLeadAutoName({ success: true, data: { id: 31 } })
  assert.equal(patches.join(','), '31=客源_31')
  assert.equal(state.leadAutoNameCode.value, '客源_31')
  // 7. 编辑既有客源时不套编号。
  patches = []
  state.leadAutoName.value = true
  state.leadFormIsEdit.value = true
  await api.applyCreatedLeadAutoName({ success: true, data: { id: 88 } })
  assert.equal(patches.join(','), '')
  console.log('lead auto-name checks passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
