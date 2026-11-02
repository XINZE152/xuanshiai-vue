const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const source = fs.readFileSync(path.join(__dirname, '../api/matchmaker.uts'), 'utf8')
const start = source.indexOf('export async function getMatchmakerWorkspaceHomepage()')
const end = source.indexOf('export async function getMatchmakerWorkspaceLeads()', start)
const code = babel.transformSync(source.slice(start, end).replace(/^export /gm, ''), {
  filename: 'homepage.ts', configFile: false, babelrc: false,
  plugins: ['@babel/plugin-transform-typescript']
}).code
let response = { success: true, data: { nickname: '新昵称', success_cases: [{ description: '案例', images: ['/case.webp'] }] } }
const calls = []
const api = vm.runInNewContext(code + '\n;({getMatchmakerWorkspaceHomepage,updateMatchmakerWorkspaceHomepage})', {
  MATCHMAKER_REMOTE_MODE: true,
  request: async options => { calls.push(options); return response },
  getMatchmakerWorkspaceProfile: async () => { throw Error('新版读取不应覆盖公开昵称') }
})
async function run() {
  const page = await api.getMatchmakerWorkspaceHomepage()
  assert.equal(page.data.nickname, '新昵称')
  assert.equal(page.data.cases[0].images[0], '/case.webp')
  assert.equal(calls.length, 1)
  await api.updateMatchmakerWorkspaceHomepage({ nickname: ' 新昵称 ', slogan: '', specialties: [], introduction: ' 这是更新后的完整红娘介绍 ', cases: [{ description: ' 新案例 ', images: ['/case.webp'] }] })
  const saved = JSON.parse(JSON.stringify(calls.at(-1)))
  assert.equal(saved.method, 'PATCH')
  assert.deepEqual(saved.data, { nickname: '新昵称', slogan: '', specialties: [], introduction: '这是更新后的完整红娘介绍', success_cases: [{ description: '新案例', images: ['/case.webp'] }] })
  response = { success: false, code: 404 }
  assert.equal((await api.updateMatchmakerWorkspaceHomepage({ nickname: '新昵称' })).success, false)
  response = { success: false, code: 403, message: '无权限' }
  assert.equal((await api.getMatchmakerWorkspaceHomepage()).message, '无权限')
  console.log('homepage edit transport checks passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
