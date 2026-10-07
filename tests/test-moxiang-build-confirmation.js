const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const page = fs.readFileSync(
  path.join(root, 'pagesSub/profileExtra/my-portrait-master.uvue'),
  'utf8'
)

assert.match(
  page,
  /buildPromptShown/,
  'build confirmation must be deduplicated per portrait subject'
)
assert.match(
  page,
  /maybePromptBuild\(subject:\s*ProfileSubject(?:,\s*inviteId:\s*string\s*=\s*['"]['"])?\)/,
  'master page must expose a subject-scoped build confirmation helper'
)
assert.match(
  page,
  /uni\.showModal\(/,
  'reaching the build gate must ask the user before opening a preview'
)
assert.match(
  page,
  /confirmText:\s*['"]现在构建['"]/
)

assert.doesNotMatch(
  page,
  /onPublishReady:|gateBySubject\(|hardGateMet/,
  'only a durable build_invite may open the formal build prompt'
)

const inviteStart = page.indexOf('onBuildInvite:')
const inviteEnd = page.indexOf('onBuildInviteResolved:', inviteStart)
assert.ok(inviteStart >= 0 && inviteEnd > inviteStart, 'build invite callback not found')
const inviteCallback = page.slice(inviteStart, inviteEnd)
assert.match(
  inviteCallback,
  /maybePromptBuild\(invite\.subject,\s*String\(invite\.invite_id/,
  'threshold invite must trigger the same explicit build prompt'
)
assert.match(
  page,
  /ws\.acceptBuildInvite\(subject,\s*inviteId\)/,
  'confirming a journey invite must accept it before opening a draft'
)
assert.match(
  inviteCallback,
  /bucket\.journeyStage\s*=\s*invite\.journey_stage/,
  'invite delivery must sync the authoritative building stage for the fallback card'
)
assert.match(
  page,
  /journeyStage == 'building' && inviteId != ''[\s\S]{0,220}maybePromptBuild\(subject, inviteId\)/,
  'a restored pending invite must prompt after the journey socket is ready'
)
// 主体切换回调内必须重新核对待构建邀请。按回调边界取块判断，不用字符预算：
// 注释变长不该误报，同时也不会匹配到后续回调里的同类判断。
const subjectChangeStart = page.indexOf('onSubjectChanged:')
const subjectChangeEnd = page.indexOf('onJourneyReady:', subjectChangeStart)
const subjectChangeBlock = page.slice(
  subjectChangeStart,
  subjectChangeEnd > subjectChangeStart ? subjectChangeEnd : subjectChangeStart + 3000
)
assert(subjectChangeStart >= 0, 'master page must wire the onSubjectChanged callback')
assert.match(
  subjectChangeBlock,
  /summary\.journeyStage == 'building' && inviteId != ''[\s\S]{0,180}maybePromptBuild\(subject, inviteId\)/,
  'a background subject invite must prompt when the user switches back to it'
)

const promptStart = page.indexOf('function maybePromptBuild')
const promptRemainder = page.slice(promptStart)
const promptClose = promptRemainder.match(/\r?\n}\r?\n/)
const promptEnd = promptClose == null
  ? -1
  : promptStart + promptClose.index + promptClose[0].length
assert.ok(promptStart >= 0 && promptEnd > promptStart, 'build prompt helper not found')
const prompt = page.slice(promptStart, promptEnd)
assert.match(prompt, /res\.confirm[\s\S]{0,400}ws\.acceptBuildInvite\(subject, inviteId\)/)
assert.doesNotMatch(prompt, /goPortrait\(\)/)
assert.doesNotMatch(prompt, /publishProfileDraft|confirmPortraitNarrative/)

console.log('PASS moxiang build confirmation contract')
