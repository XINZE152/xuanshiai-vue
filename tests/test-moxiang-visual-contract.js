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
assert(page.includes('size="large"'), 'hero avatar should use large size')
assert(page.includes('size="small"'), 'message avatars should use small size')
assert(page.includes('background: var(--canvas)'), 'page should use global design tokens')

console.log('test-moxiang-visual-contract: PASS')
