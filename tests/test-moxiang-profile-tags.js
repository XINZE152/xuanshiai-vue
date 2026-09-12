const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

const profilePage = read('pages', 'profile', 'profile.uvue')
const detailPage = read('pagesSub', 'userExtra', 'user', 'detail.uvue')
const mockUser = read('mock', 'user.uts')

// 锁定态分支：详情被门禁挡住时展示的降级内容。AI 人格推断不得在此泄漏。
const lockedBranch = (() => {
  const start = detailPage.indexOf('locked-detail-content')
  assert.ok(start >= 0, 'detail.uvue must have a locked-detail-content branch')
  const end = detailPage.indexOf('</scroll-view>', start)
  return detailPage.slice(start, end > 0 ? end : undefined)
})()

test('profile page renders the moxiang badge and routes to the portrait', () => {
  assert.match(profilePage, /aiPersonaTitle/, 'profile.uvue must declare aiPersonaTitle state')
  assert.match(profilePage, /aiPersonaTags/, 'profile.uvue must declare aiPersonaTags state')
  assert.match(profilePage, /aiAttachmentStyle/, 'profile.uvue must declare aiAttachmentStyle state')
  assert.match(profilePage, /class="moxiang-badge-wrap"/, 'profile.uvue template must render moxiang badge container')
  assert.match(profilePage, /class="moxiang-title-badge"/, 'profile.uvue template must render persona title badge')
  assert.match(profilePage, /class="moxiang-title-seal"/, 'profile.uvue template must render seal mark')
  assert.match(profilePage, /class="moxiang-tag-pill"/, 'profile.uvue template must render trait pill tags')
  assert.match(profilePage, /@tap="onAiPortrait"/, 'profile.uvue badge must trigger onAiPortrait')
  assert.match(profilePage, /#9C5B42|#6E4535|#A8383B/, 'profile.uvue styles must use Song tea-brown & cinnabar tokens')
})

test('detail page renders the moxiang card for the unlocked view', () => {
  assert.match(detailPage, /moxiangPersonaTitle/, 'detail.uvue must support moxiangPersonaTitle')
  assert.match(detailPage, /moxiangPersonaTags/, 'detail.uvue must support moxiangPersonaTags')
  assert.match(detailPage, /moxiangAttachmentStyle/, 'detail.uvue must support moxiangAttachmentStyle')
  assert.match(detailPage, /moxiang-section-card/, 'detail.uvue must render moxiang-section-card')
  assert.match(detailPage, /知遇墨相 · 灵魂底色/, 'detail.uvue must display the poetic section title')
  assert.match(detailPage, /onViewMyPortrait/, 'detail.uvue must provide onViewMyPortrait action for profile owner')
  assert.match(detailPage, /attachmentStyleLabel/, 'detail.uvue must delegate attachment labels to the shared util')
  assert.match(detailPage, /\.moxiang-section-card[\s\S]*?\.moxiang-persona-badge[\s\S]*?\.moxiang-tag-item/, 'detail.uvue must include moxiang section styles')
})

test('locked detail view never exposes AI persona traits', () => {
  assert.doesNotMatch(
    lockedBranch,
    /moxiangPersonaTitle|moxiangPersonaTags|moxiangAttachmentStyle|moxiang-section-card/,
    'locked-detail-content must not render moxiang persona traits: details are gated, so the AI inference must be too'
  )
})

test('persona title is truncated so long titles cannot break the layout', () => {
  for (const [name, source, cssClass] of [
    ['profile.uvue', profilePage, 'moxiang-title-text'],
    ['detail.uvue', detailPage, 'moxiang-persona-title']
  ]) {
    const block = source.slice(source.indexOf(`.${cssClass} {`))
    const rule = block.slice(0, block.indexOf('}'))
    assert.match(rule, /text-overflow: ellipsis/, `${name} .${cssClass} must ellipsize`)
    assert.match(rule, /overflow: hidden/, `${name} .${cssClass} must hide overflow`)
  }
})

test('shared moxiang badge util gates unconfirmed narratives', () => {
  const raw = read('utils', 'moxiang-badge.uts')
  const source = stripTypeScriptTypes(raw).replace(/^export /gm, '')
  const sandbox = {}
  vm.runInNewContext(source, sandbox)
  const { narrativeBadgeVisible, attachmentStyleLabel } = sandbox

  // 仅用户确认后的成稿可上资料页；历史行兼容值 published 同样放行。
  for (const status of ['confirmed', 'published']) {
    assert.equal(narrativeBadgeVisible({ status }), true, `${status} must be displayable`)
  }
  // AI 已生成但用户未确认，以及脏数据，都不得展示。
  for (const status of ['pending', 'pending_confirmation', '', 'deleted']) {
    assert.equal(narrativeBadgeVisible({ status }), false, `${status} must not be displayable`)
  }
  for (const junk of [null, undefined, 'confirmed', 42]) {
    assert.equal(narrativeBadgeVisible(junk), false, `non-object payload ${junk} must not be displayable`)
  }

  assert.equal(attachmentStyleLabel('secure'), '安全型')
  assert.equal(attachmentStyleLabel('anxious'), '焦虑型')
  assert.equal(attachmentStyleLabel('avoidant'), '回避型')
  assert.equal(attachmentStyleLabel('fearful'), '恐惧回避型')
  // 未知/空值必须回落空串（由调用方隐藏微标），绝不把后端枚举码漏给用户。
  for (const unknown of [null, undefined, '', 'unknown', '纠缠型', 42]) {
    assert.equal(attachmentStyleLabel(unknown), '', `unknown style ${unknown} must not be displayed`)
  }
})

test('self-view fallbacks honour the narrative status gate', () => {
  // 两处前端兜底直接调 getPortraitNarrative（按设计透传 status），必须自行过滤。
  assert.match(
    profilePage,
    /narrativeBadgeVisible\(/,
    'profile.uvue loadOverview must gate the badge on narrative status'
  )
  assert.match(
    detailPage,
    /narrativeBadgeVisible\(/,
    'detail.uvue own-profile fallback must gate the badge on narrative status'
  )
})

test('mock fixtures carry the moxiang fields', () => {
  assert.match(mockUser, /moxiang_persona_title/, 'mockUserDetail must include moxiang_persona_title')
  assert.match(mockUser, /moxiang_persona_tags/, 'mockUserDetail must include moxiang_persona_tags')
  assert.match(mockUser, /moxiang_attachment_style/, 'mockUserDetail must include moxiang_attachment_style')
})
