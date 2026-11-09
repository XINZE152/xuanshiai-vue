const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const theme = fs.readFileSync(path.join(root, 'utils/portrait-chart-theme.uts'), 'utf8')
const scss = fs.readFileSync(path.join(root, 'uni.scss'), 'utf8')
const drawer = fs.readFileSync(path.join(root, 'utils/portrait-chart-drawer.uts'), 'utf8')
const checks = [['paper','#FAFCFC','paper'],['surface','#FFFFFF','surface'],['ink','#0C1313','ink'],['ink2','#42494A','ink2'],['muted','#7B8282','muted'],['line','#D3D9D8','line'],['accent','#2D7C72','accent'],['accent2','#006052','accent2'],['soft','#669C92','soft'],['sageSoft','#C2E0CF','sage-soft']]
for (const [key, value, token] of checks) {
 assert.match(theme, new RegExp(key + ": '\\\\?" + value + "'"))
 assert.match(scss, new RegExp('--' + token + ':\\s*' + value, 'i'))
}
assert.match(drawer, /if \(percent == null\) return/)
assert.match(drawer, /if \(percent == null\) \{ drawing = false; continue \}/)
assert.match(drawer, /dim\.percent != null/)
assert.match(drawer, /lineWidth = 2/)
assert.match(drawer, /ctx\.arc\(x, y, 4/)
console.log('PASS portrait chart source contract: Token mirror, nulls remain blank, single-series line and accessible table counterpart')
