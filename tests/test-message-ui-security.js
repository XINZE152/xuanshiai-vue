const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
const messageCenter = read('pagesSub/parent/components/XsaMessageCenter.uvue')
const chatDetail = read('pagesSub/chat/detail.uvue')
const messageApi = read('api/message.uts')
const requestApi = read('api/request.uts')
const reportSheet = read('components/XsaReportSheet.uvue')

function includes(source, expected, label) {
  assert.ok(source.includes(expected), `${label}: missing ${expected}`)
}

function extract(source, startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `unable to extract ${startText}`)
  return source.slice(start, end)
}

function ref(value) {
  return { value }
}

console.log('消息 UI 主体隔离与失效清理测试')

// Every message operation uses an explicit role subject.
includes(messageCenter, "{ mode: 'self' } as MessageSubject", 'standard center subject')
includes(messageCenter, "{ mode: 'parent', childId: childId } as MessageSubject", 'parent center child subject')
includes(messageCenter, "isParentMode.value ? 'protected' : 'standard',\n\t\t\t\tsubject", 'center reads carry subject')
includes(messageCenter, 'markAllMessagesRead(subject)', 'mark-all-read carries subject')
includes(messageCenter, 'getChatPermission(userId, subject)', 'center permission carries subject')
includes(
  messageCenter,
  'handleApplication(item.id, action, clientCommandId, subject)',
  'application command carries idempotency key and subject',
)

includes(chatDetail, "activateMessageSubject({ mode: 'self' } as MessageSubject)", 'standard chat subject')
includes(
  chatDetail,
  "activateMessageSubject({ mode: 'parent', childId: childId } as MessageSubject)",
  'parent chat subject comes from ParentContext child',
)
assert.ok(
  (chatDetail.match(/getChatPermission\(userId\.value, subject\)/g) || []).length >= 2,
  'entry and send-time permission checks must carry the subject',
)
includes(chatDetail, "isParentMode.value ? 'protected' : 'standard',\n\t\t\t\tsubject", 'chat history carries subject')
assert.match(
  chatDetail,
  /message\.clientMessageId,\s+subject,\s+message\.mediaId/,
  'chat send carries subject and media binding after client message id',
)
includes(chatDetail, 'message.mediaId != null ? Number(message.mediaId) : null', 'chat send binds an uploaded media ID when present')
includes(chatDetail, ':parent-mode="isParentMode"', 'chat report sheet receives the parent-mode boundary')
includes(chatDetail, ':parent-context="activeParentContext"', 'chat report sheet receives the verified parent context')
includes(chatDetail, 'activeParentContext.value = context', 'verified parent context is retained for safety actions')
includes(reportSheet, 'reportParentCandidate', 'parent chat reports use the parent safety adapter')
includes(reportSheet, 'blockParentCandidate', 'parent chat blocks use the parent safety adapter')
includes(reportSheet, 'props.parentMode && props.parentContext == null', 'parent safety actions fail closed without context')
includes(reportSheet, "uni.showToast({ title: '举报已提交', icon: 'success' })", 'parent reports use product-facing confirmation copy')
assert.ok(!reportSheet.includes('内部演示'), 'parent reports do not expose internal implementation state')

// Execute the production stable command-id function.
let commandFunction = extract(
  messageCenter,
  'const getApplicationCommandId = (',
  'const reconcileIncomingApplications',
)
commandFunction = commandFunction.replace(
  /const getApplicationCommandId = \(\s*applicationId: number,\s*action: string,\s*subject: MessageSubject\s*\): string =>/,
  'const getApplicationCommandId = (applicationId, action, subject) =>',
)
const commandContext = {
  String,
  applicationCommandIds: ref({}),
  subjectKey: (subject) => subject.mode === 'parent' ? `parent-${subject.childId || 0}` : 'self',
}
commandContext.globalThis = commandContext
vm.runInNewContext(
  `${commandFunction}\nglobalThis.getApplicationCommandId = getApplicationCommandId`,
  commandContext,
  { filename: 'XsaMessageCenter.uvue#command-id' },
)
const parentSubject = { mode: 'parent', childId: 42 }
const firstCommandId = commandContext.getApplicationCommandId(8, 'accept', parentSubject)
const retryCommandId = commandContext.getApplicationCommandId(8, 'accept', parentSubject)
const rejectCommandId = commandContext.getApplicationCommandId(8, 'reject', parentSubject)
assert.strictEqual(retryCommandId, firstCommandId, 'same item/action retry must reuse the command id')
assert.notStrictEqual(rejectCommandId, firstCommandId, 'different actions must not share a command id')
includes(
  messageCenter,
  "return await loadApplicationPage('incoming', true, true)",
  'failed application action force-reconciles the received list',
)
assert.ok(
  (messageCenter.match(/await continueFromReconciledApplication\(/g) || []).length >= 2,
  'business and transport failures must both reconcile and interpret final application state',
)
includes(messageCenter, 'await loadConversationPage(true, true)', 'accepted reconciliation force-refreshes conversations')
includes(messageCenter, 'await openAllowedChat(', 'accepted reconciliation rechecks chat permission')
includes(messageCenter, 'parentAccessRequest', 'parallel parent reads reuse one access request')
assert.ok(
  !messageCenter.includes('const requestEpoch = parentAccessEpoch + 1'),
  'parallel parent reads must not invalidate each other by advancing the access epoch',
)
includes(messageCenter, 'incomingApplicationRequestVersion', 'incoming pagination has an independent request generation')
includes(messageCenter, 'outgoingApplicationRequestVersion', 'outgoing pagination has an independent request generation')
includes(messageCenter, 'invalidateConversationRequests()', 'conversation invalidation releases stale loading state')
includes(messageCenter, 'invalidateApplicationRequests()', 'application invalidation releases stale loading state')
includes(messageCenter, 'attemptId == applicationActionSequence', 'old application finally blocks cannot clear a newer action')
includes(messageCenter, 'let componentActive = true', 'message center tracks component lifecycle')
includes(messageCenter, 'onUnmounted(() => {', 'unmount invalidates pending message work')
includes(messageCenter, 'componentActive = false', 'unmount marks the center inactive')
includes(messageCenter, 'componentActive &&', 'async status writes require an active center')

// Execute the production 401 recognizer for top-level and nested business responses.
let unauthorizedFunction = extract(
  messageCenter,
  'const isUnauthorizedResponse = (',
  'const handleUnauthorizedResponse',
)
unauthorizedFunction = unauthorizedFunction.replace(
  /const isUnauthorizedResponse = \(res: any\): boolean =>/,
  'const isUnauthorizedResponse = (res) =>',
)
const unauthorizedContext = { String }
unauthorizedContext.globalThis = unauthorizedContext
vm.runInNewContext(
  `${unauthorizedFunction}\nglobalThis.isUnauthorizedResponse = isUnauthorizedResponse`,
  unauthorizedContext,
  { filename: 'XsaMessageCenter.uvue#unauthorized' },
)
assert.strictEqual(unauthorizedContext.isUnauthorizedResponse({ code: 401 }), true, 'numeric 401 is recognized')
assert.strictEqual(unauthorizedContext.isUnauthorizedResponse({ code: '401' }), true, 'string 401 is recognized')
assert.strictEqual(
  unauthorizedContext.isUnauthorizedResponse({ data: { code: 401 } }),
  true,
  'nested business 401 is recognized',
)
assert.strictEqual(unauthorizedContext.isUnauthorizedResponse({ code: 403 }), false, 'non-401 is not over-cleared')

// Execute the center cleanup used by 401 and revoked parent context.
let centerCleanup = extract(
  messageCenter,
  'const clearSensitiveMessageState = (',
  'const clearParentMessageState',
)
centerCleanup = centerCleanup.replace(
  /const clearSensitiveMessageState = \([\s\S]*?\) =>/,
  "const clearSensitiveMessageState = (message = '', keepApplicationOpen = false) =>",
)
const centerContext = {
  appVisible: ref(true),
  conversationMutationVersion: ref(2),
  applicationMutationVersion: ref(3),
  incomingApplicationRequestVersion: ref(4),
  outgoingApplicationRequestVersion: ref(5),
  conversations: ref([{ id: 1 }]),
  conversationCursor: ref('cursor'),
  conversationHasMore: ref(true),
  unreadTotal: ref(4),
  initialLoading: ref(true),
  loadingMore: ref(true),
  pageError: ref(''),
  conversationErrorMode: ref(''),
  incomingApplications: ref([{ id: 2 }]),
  outgoingApplications: ref([{ id: 3 }]),
  incomingCursor: ref('incoming'),
  outgoingCursor: ref('outgoing'),
  incomingHasMore: ref(true),
  outgoingHasMore: ref(true),
  incomingApplicationLoading: ref(true),
  outgoingApplicationLoading: ref(true),
  incomingApplicationError: ref(''),
  outgoingApplicationError: ref(''),
  incomingApplicationErrorMode: ref(''),
  outgoingApplicationErrorMode: ref(''),
  incomingPendingCount: ref(2),
  markingAllRead: ref(true),
  navigatingUserId: ref(99),
  applicationActionId: ref(2),
  applicationCommandIds: ref({ existing: 'command' }),
  activeMessageSubject: ref(parentSubject),
  parentAccessEpoch: 0,
  parentAccessRequest: {},
  parentAccessRequestEpoch: 0,
  markAllReadAttemptSequence: 1,
  navigationAttemptSequence: 1,
  applicationActionSequence: 1,
}
centerContext.invalidateConversationRequests = () => {
  centerContext.conversationMutationVersion.value += 1
  centerContext.initialLoading.value = false
  centerContext.loadingMore.value = false
}
centerContext.invalidateApplicationRequests = () => {
  centerContext.applicationMutationVersion.value += 1
  centerContext.incomingApplicationRequestVersion.value += 1
  centerContext.outgoingApplicationRequestVersion.value += 1
  centerContext.incomingApplicationLoading.value = false
  centerContext.outgoingApplicationLoading.value = false
}
centerContext.globalThis = centerContext
vm.runInNewContext(
  `${centerCleanup}\nglobalThis.clearSensitiveMessageState = clearSensitiveMessageState`,
  centerContext,
  { filename: 'XsaMessageCenter.uvue#cleanup' },
)
centerContext.clearSensitiveMessageState('登录状态已失效', true)
assert.strictEqual(centerContext.conversations.value.length, 0, '401 clears loaded conversations')
assert.strictEqual(centerContext.incomingApplications.value.length, 0, '401 clears received applications')
assert.strictEqual(centerContext.outgoingApplications.value.length, 0, '401 clears sent applications')
assert.strictEqual(centerContext.unreadTotal.value, 0, '401 clears unread count')
assert.strictEqual(centerContext.incomingPendingCount.value, 0, '401 clears pending count')
assert.strictEqual(centerContext.activeMessageSubject.value, null, '401 clears the active subject')
assert.strictEqual(centerContext.pageError.value, '登录状态已失效', '401 leaves a visible error state')
assert.strictEqual(centerContext.appVisible.value, true, 'standard application sheet can render its error state')

// Chat cleanup invalidates stale requests and removes all parent-sensitive state.
includes(chatDetail, 'chatMutationVersion.value += 1', 'chat cleanup invalidates stale requests')
includes(chatDetail, 'messages.value = []', 'chat cleanup clears history')
includes(chatDetail, "clearChatSensitiveState('暂时无法确认父母端访问权限', true)", 'parent gate failure clears chat')
includes(chatDetail, 'permissionRequestSequence', 'permission checks use latest-wins request generations')
includes(chatDetail, 'roleAccessEpoch', 'parent context responses are tied to an access generation')
includes(chatDetail, 'roleAccessRequest', 'parallel parent role checks share one request')
includes(chatDetail, 'isHistoryRequestCurrent', 'history rejects stale subject responses')
includes(chatDetail, 'isDeliveryAttemptCurrent', 'send rejects stale subject responses')
assert.ok(!chatDetail.includes('permissionRequestInFlight'), 'onShow must not discard a newer permission check')
includes(chatDetail, 'const handleSubjectUnauthorizedResponse = (', 'chat uses one subject-aware 401 handler')
includes(chatDetail, 'if (!isUnauthorizedResponse(res)) return false', 'chat 401 handler recognizes normalized failures')
includes(
  chatDetail,
  "clearChatSensitiveState(responseMessage(res, '登录状态已失效，请重新登录'), true)",
  'chat 401 handler clears sensitive state',
)
assert.ok(
  (chatDetail.match(/handleSubjectUnauthorizedResponse\(res, /g) || []).length >= 4,
  'permission, history, send-time permission and send use the subject-aware 401 handler',
)
assert.ok(
  !chatDetail.includes('ensureChatFeatureUnlocked'),
  'removed points unlock flows must not remain in the chat page',
)

// The current transport resolves HTTP failures into the shared response
// contract. Message APIs then normalize that response and fail closed.
includes(requestApi, 'success: false', 'HTTP failures resolve as failed responses')
includes(requestApi, 'clearAuthTokens()', 'HTTP 401 clears auth tokens')
includes(messageApi, 'async function messageRequest(options: any)', 'message request boundary')
includes(messageApi, 'normalizeBusinessResponse', 'message responses use the shared normalizer')
assert.ok(!requestApi.includes('normalizeCloudFailure'), 'obsolete cloud rejection normalizer must stay removed')

console.log('消息 UI 主体隔离与失效清理测试通过')
