const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'api', 'community.uts'), 'utf8')

assert.match(source, /purchasePaperPlaneChance[\s\S]*?redeemPointProduct\(['"]paper_plane_unlock['"]\)/, 'paper-plane quota purchase must redeem paper_plane_unlock via the points endpoint')
assert.doesNotMatch(source, /url:\s*['"]\/community\/paper-planes\/chances/, 'paper-plane quota purchase must not call the nonexistent chances endpoint')
assert.match(source, /imageMediaIds/, 'post and paper-plane publishing must preserve uploaded image ids')
assert.match(source, /videoMediaId/, 'post publishing must preserve the uploaded video id')
assert.match(source, /ensureMockPlaneConversation/, 'paper-plane replies must preserve conversation creation')
assert.match(source, /conversationId: convId/, 'paper-plane replies must return the backend conversation id')
assert.match(source, /normalizedType == 'post'[\s\S]*?\/community\/reports/, 'content reports must use the community report endpoint')
assert.match(source, /\/security\/reports\/['"]? \+ targetId|\/security\/reports\/['"]? \+ normalizedType/, 'user reports must retain the security report endpoint')

assert.match(source, /clearAuthTokens/, 'media upload must be able to clear rejected authentication')
assert.match(source, /purposeVal != 'post' && purposeVal != 'paper_plane'/, 'community media upload must reject unsupported purposes')
assert.match(source, /res\.statusCode == 401[\s\S]*?clearAuthTokens\(\)/, 'media upload must clear tokens after a 401 response')
assert.match(source, /uploadMedia[\s\S]*?extractUploadDetail\(data\)/, 'voice upload must use the shared upload error parser')
assert.match(source, /上传失败[^\n]*err\.errMsg|err\.errMsg[^\n]*上传失败/, 'upload transport errors must preserve the UniApp error message')

assert.match(source, /topic\.participantCount = Math\.max\(0,/, 'topic participant decrement must stay non-negative')
assert.match(source, /followTabIndex[\s\S]*?\.splice\(followTabIndex, 1\)/, 'Mock unfollow must remove the follow tab membership')
assert.match(source, /if \(comment == null\) return failRes\('评论不存在', 404\)/, 'Mock comment likes must fail when the comment no longer exists')
assert.match(source, /comment: raw != null \? mapComment\(raw\) : null/, 'real comment likes must retain the mapped comment payload')

const compatibilityNames = [
  'getPaperPlanePeerNameV2',
  'upsertPaperPlaneConversationV2',
  'getPaperPlaneConversationsLegacy',
  'getSentPaperPlanesLegacy',
  'getPaperPlaneUnreadCountLegacy',
  'markPaperPlaneConversationReadLegacy',
  'getPaperPlaneMessagesLegacy',
  'sendPaperPlaneMessageLegacy',
  'readPaperPlaneConversationLegacy',
  'endPaperPlaneConversationLegacy',
  'uploadCommunityMediaLegacy',
  'uploadMediaLegacy',
  'deleteCommunityMediaLegacy'
]

for (const name of compatibilityNames) {
  assert.match(source, new RegExp(`function ${name}\\b`), `${name} must remain available as a private compatibility alias`)
}

console.log('PASS community reconstruction contract')
