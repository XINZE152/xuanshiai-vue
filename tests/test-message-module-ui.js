const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const item = read('components/XsaMessageItem.uvue')
const messagePage = read('pages/message/message.uvue')
const messageApi = read('api/message.uts')

// F-M2 会话列表头像兜底：空值与加载失败都落中性占位，不按性别猜图。
assert.ok(item.includes('@error="onAvatarError"'), 'avatar image should handle load failures')
assert.ok(item.includes('const displayAvatar = computed('), 'avatar source should be derived before rendering')
assert.ok(item.includes('avatar-fallback'), 'empty avatars should render a fallback block')
assert.ok(!/gender/i.test(item), 'the session list has no gender field, so avatars must not be guessed by gender')
assert.ok(messageApi.includes('avatar: resolveMediaUrl(target.avatar)'), 'list avatars should resolve bare storage paths')
assert.ok(!messageApi.includes("target.avatar != null ? resolveMediaUrl(target.avatar) : ''"), 'list avatars should not hand an unfiltered value to the image')

// F-M3 置顶视觉：底色必须与页面底色可辨，并给出「置顶」标识。
assert.ok(/\.xsa-message-item\.pinned\s*\{[^}]*var\(--warm\)/.test(item), 'pinned rows should use the warmer token so the state is visible')
assert.ok(item.includes('>置顶</text>'), 'pinned rows should be labelled, not colour-only')
assert.ok(!/\.xsa-message-item\.pinned\s*\{[^}]*var\(--canvas\)/.test(item), 'pinned rows must not reuse the near-identical canvas colour')
assert.ok(!messagePage.includes('#FDFDFD'), 'message page should use tokens instead of a hard-coded off-white')

// F-M3 置顶持久化前半段：后端尚未下发 pinned，重拉是唯一的置前手段，不能删。
assert.ok(
  /const togglePin[\s\S]{0,900}await loadMessages\(true, true\)/.test(messagePage),
  'pinning should still refetch the list so pinned rows sort first until the backend returns pinned',
)
assert.ok(
  messageApi.includes('pinned: item != null && item.pinned == true'),
  'the list mapper should already read the backend pinned flag for when it lands',
)

console.log('消息模块 UI 契约（头像兜底 / 置顶视觉 / 重拉保留）测试通过')
