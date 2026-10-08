const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const avatar = fs.readFileSync(path.join(root, 'components', 'MoxiangMasterAvatar.uvue'), 'utf8')
const page = fs.readFileSync(path.join(root, 'pagesSub', 'profileExtra', 'my-portrait-master.uvue'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(avatar.includes('size?: string'), 'avatar should expose size prop')
assert(avatar.includes('mm-avatar-small'), 'avatar should have small size class')
assert(page.includes(":size=\"continuousFlow ? 'small' : 'large'\""), 'continuous header should be compact while legacy keeps the large hero')
assert(avatar.includes('<XsaZhiyuMark'), 'all master states should reuse the existing cat component')
assert(!avatar.includes('/static/moxiang-master/'), 'master avatar must not retain a second character')
for (const state of ['thinking', 'speaking', 'listening']) assert(avatar.includes('.mm-' + state), 'cat should preserve state feedback: ' + state)
assert(page.includes('size="small"'), 'message avatars should use small size')
assert(page.includes('background: var(--canvas)'), 'page should use global design tokens')

console.log('test-moxiang-visual-contract: PASS')
