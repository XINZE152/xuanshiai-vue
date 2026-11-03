const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const source = fs.readFileSync(path.join(__dirname, '../api/request.uts'), 'utf8')
const compiled = babel.transformSync(source, {
  filename: 'request.ts', configFile: false, babelrc: false,
  plugins: ['@babel/plugin-transform-typescript', '@babel/plugin-transform-modules-commonjs']
}).code
let reply = null
const warnings = []
const context = {
  exports: {}, console: { ...console, warn: value => warnings.push(value) },
  require: name => name.includes('config') ? {
    USE_MOCK: false, API_CONFIG: { timeout: 1000 }, getAccessToken: () => 'test-session',
    buildApiUrl: url => 'https://example.test/api/v1' + url
  } : { debugLog: () => {} },
  uni: { request: options => options.success(reply), getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) }
}
vm.runInNewContext(compiled, context)
async function check(body, status = 500) {
  reply = { statusCode: status, data: body, header: { 'x-request-id': 'test-request-1' } }
  const result = await context.exports.request({ url: '/matchmaker/workbench/members' })
  assert.equal(result.success, false)
  assert.equal(result.code, status)
  assert.equal(result.requestId, 'test-request-1')
  return result
}
async function run() {
  for (const body of [
    'Traceback (most recent call last):\nFile "/app/main.py", line 172\nsqlalchemy.exc.OperationalError: password=private',
    { detail: 'ExceptionGroup: SQLAlchemy failure [SQL: SELECT private FROM users]' },
    { message: '<!doctype html><html>502 Bad Gateway</html>' },
    { detail: { code: 'INTERNAL_ERROR', message: 'OperationalError: database credentials' } }
  ]) {
    const result = await check(body)
    assert.equal(result.message, '服务暂时异常，请稍后重试')
    assert.doesNotMatch(result.message, /private|password|database|SELECT/)
  }
  assert.equal((await check({ detail: '仅总店红娘可审核会员公开资料' }, 403)).message, '仅总店红娘可审核会员公开资料')
  const business = await check({ detail: { code: 'PROVIDER_BUSY', message: '服务繁忙，请稍后重试', retryable: true } }, 503)
  assert.equal(business.message, '服务繁忙，请稍后重试')
  assert.equal(business.businessCode, 'PROVIDER_BUSY')
  const diagnostic = await check("sqlalchemy.exc.OperationalError: (1054, \"Unknown column 'l.photo' in 'field list'\")\n[parameters: phone=13800000000, password=private]")
  assert.match(diagnostic.diagnostic, /缺少字段=l\.photo/)
  assert.doesNotMatch(diagnostic.diagnostic, /password|private|13800000000/)
  assert.match(warnings.at(-1), /缺少字段=l\.photo/)
  assert.match(warnings.at(-1), /数据库错误号=1054/)
  assert.doesNotMatch(warnings.join('\n'), /password|private|13800000000|SELECT/)
  const count = warnings.length
  context.uni.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
  assert.equal((await check('Traceback: password=private')).diagnostic, '')
  assert.equal(warnings.length, count, 'release must not emit development diagnostics')
  console.log('PASS error display: traceback/HTML/SQL hidden; business messages, status and request ID preserved')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
