const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const homePagePath = path.join(projectRoot, 'pages', 'index', 'index.uvue')
const homePageSource = fs.readFileSync(homePagePath, 'utf8')

assert.doesNotMatch(
  homePageSource,
  /资料完善度|去完善资料/,
  '首页不应展示资料完善度横幅或“去完善资料”入口'
)

assert.doesNotMatch(
  homePageSource,
  /getProfileCompletion|profileCompletion/,
  '首页不应请求或维护资料完善度状态'
)

console.log('首页资料完善度横幅回归检查通过')
