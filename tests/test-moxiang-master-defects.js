const fs = require('fs')
const assert = require('assert')

const pagePath = 'pagesSub/profileExtra/my-portrait-master.uvue'
const source = fs.readFileSync(pagePath, 'utf8')
const progressSource = fs.readFileSync('components/moxiang/MoxiangProgressPanel.uvue', 'utf8')

function test(name, check) {
  check()
  console.log(`PASS ${name}`)
}

test('legacy ready card is removed and voice label remains a stable computed string', () => {
  assert(!source.includes('const readyTitle = computed'), 'legacy readiness card must not be driven by candidate progress')
  assert(!source.includes('class="mm-ready"'), 'legacy readiness card must not render in the chat')
  assert(source.includes('const voiceActionLabel = computed'), 'voiceActionLabel computed is missing')
  assert(source.includes('{{ voiceActionLabel }}'), 'voice action still renders an inline expression')
})

test('empty conversation has a useful first-step prompt', () => {
  assert(source.includes('v-else-if="sessionStarted" class="mm-body"'), 'chat body is visible before a session starts')
  assert(source.includes('v-if="visibleMessages.length == 0"'), 'empty-state branch is missing')
  assert(source.includes('class="mm-empty-title"'), 'empty-state title is missing')
  assert(source.includes('class="mm-empty-sub"'), 'empty-state guidance is missing')
})

test('state loading settles when there is no resumable session', () => {
  assert(source.includes('async function loadStateAndMaybeConnect()'), 'state/session coordinator is missing')
  assert(source.includes('loadStateAndMaybeConnect()'), 'lifecycle does not use the state/session coordinator')
  assert(source.includes('connecting.value = false'), 'no-session path never clears connecting state')
})

test('flex layout reserves navigation and input bars', () => {
  assert(/\.mm-nav\s*\{[^}]*flex-shrink:\s*0/s.test(source), 'navigation bar is allowed to collapse')
  assert(/\.mm-input-bar\s*\{[^}]*flex-shrink:\s*0/s.test(source), 'input bar is allowed to collapse')
})

test('progress panel uses Chinese, compact, user-facing language', () => {
  // 标题保留口语化抬头；文案随「知遇」两个主体改名（我的真实画像 / 期待的长期关系），见 PRODUCT.md。
  assert(progressSource.includes('正在一起整理你的真实画像'), 'progress panel has no conversational heading')
  assert(
    progressSource.includes("import { dimensionLabel } from '@/utils/moxiang-dimension.uts'"),
    'dimension labels are not translated via the shared util (#21 single mapping table)',
  )
  assert(progressSource.includes('dimensionLabel(key)'), 'dimension labels are not mapped to Chinese')
  assert(!progressSource.includes('{{ key }}'), 'raw dimension keys are still rendered')
  assert(progressSource.includes('flex-wrap: wrap'), 'dimensions are not laid out compactly')
})

test('progress has one visible track and follows live websocket progress', () => {
  assert(!source.includes('<view v-if="buildMode" class="mm-progress">'), 'duplicate page progress track is still visible')
  assert(source.includes(':livePercent="liveProgressPercent"'), 'progress panel is not bound to the live progress value')
  assert(progressSource.includes('livePercent?: number'), 'progress panel has no live progress input')
  assert(progressSource.includes('displayOverallPercent'), 'progress panel does not derive its displayed live percentage')
})

test('progress panel can collapse to protect the conversation viewport', () => {
  assert(progressSource.includes('toggleCollapsed'), 'progress panel has no collapse interaction')
  assert(progressSource.includes('const collapsed = ref(true)'), 'progress panel should start compact for conversation-first use')
  assert(progressSource.includes('v-if="!collapsed"'), 'expanded progress content is not conditionally rendered')
  assert(progressSource.includes('v-if="collapsed"'), 'collapsed progress summary is not conditionally rendered')
})

test('dimension metrics are normalized before rendering on mp-weixin', () => {
  assert(progressSource.includes('const dimensionItems = computed'), 'dimension object is rendered without a stable view model')
  assert(progressSource.includes('v-for="dim in dimensionItems"'), 'dimension list still relies on object key/value iteration')
  assert(!progressSource.includes('v-for="(dim, key) in metrics.dimensions"'), 'unstable object iteration can render [object Object]')
  assert(!progressSource.includes("dimensionLabel('' + key)"), 'dimension label still stringifies an unstable iterator key')
})

test('conversation bubbles use compact readable spacing', () => {
  assert(/\.mm-msg\s*\{[^}]*margin-bottom:\s*8px/s.test(source), 'conversation rows remain too loose')
  assert(/\.mm-bubble\s*\{[^}]*max-width:\s*78%/s.test(source), 'conversation bubbles are too narrow')
  assert(/\.mm-bubble-text\s*\{[^}]*line-height:\s*1\.45/s.test(source), 'conversation text line-height is not compact')
  assert(source.includes('word-break: break-all'), 'long conversation text can overflow its bubble')
})

test('confirmed draft actions refresh the progress summary', () => {
  const confirmStart = source.indexOf('async function confirmCardItem')
  const deleteStart = source.indexOf('async function deleteItem', confirmStart)
  const confirmBlock = source.slice(confirmStart, deleteStart)
  assert(confirmBlock.includes('await loadMoxiangState()'), 'confirming an item leaves the progress summary stale')
  assert(source.includes('onJourneyProgress'), 'live progress events must update the six-dimension summary')
})

test('confirmation cards advance one item at a time', () => {
  assert(source.includes('confirmIndex'), 'confirmation cursor is missing')
  assert(source.includes('async function confirmCardItem'), 'single-item confirmation action is missing')
  assert(source.includes('确认这一条'), 'single-item confirmation copy is missing')
  assert(source.includes('第 '), 'confirmation progress is not expressed in Chinese')
  assert(source.includes('我想和你确认一件小事'), 'confirmation card is not conversational')
})

test('session-start errors stop stale reconnect loops', () => {
  const onErrorStart = source.indexOf('onError: (code: string, message: string) =>')
  const onCloseStart = source.indexOf('onClose: () =>', onErrorStart)
  const onErrorBlock = source.slice(onErrorStart, onCloseStart)
  assert(/sessionStartFailed\.value = true[\s\S]*?if \(ws != null\)[\s\S]*?ws\.disconnect\(\)/.test(onErrorBlock), 'session-start errors can leave an auto-reconnect loop alive')
})

test('text messages require a ready session and explain transient reconnects', () => {
  const sendStart = source.indexOf('function sendText()')
  const sendEnd = source.indexOf('\n}\n\nfunction switchToVoice', sendStart)
  const sendBlock = source.slice(sendStart, sendEnd)
  assert(sendBlock.includes('!sessionStarted.value'), 'text messages can be sent before the session is ready')
  assert(sendBlock.includes('正在准备中'), 'transient send failures are silently ignored')
})

console.log('Moxiang master defect regression checks passed')
