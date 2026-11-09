const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const root = path.resolve(__dirname, '../..')
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function load(file, names, context = {}) {
  const source = read(file)
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const code = ast.program.body.filter(n => n.type !== 'ImportDeclaration').map(n => {
    if (n.type === 'ExportNamedDeclaration') return n.declaration ? source.slice(n.declaration.start, n.declaration.end) : ''
    return source.slice(n.start, n.end)
  }).join('\n')
  const js = babel.transformSync(code, { filename: 'runtime.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
  return vm.runInNewContext(js + '\n;({' + names.join(',') + '})', context)
}
module.exports = { load, read }
