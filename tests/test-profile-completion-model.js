/**
 * 资料完整度累加模型（profile-v5）前端契约测试。
 *
 * 钉住 2026-11-02 需求：
 * - 前端不再维护权重表，只读 /completion 的 items[].weight/completed；
 * - 9 项详细资料参与 +X% 展示；
 * - 编辑页与个人中心只读同一 score，保存/onShow 后重新拉取；
 * - 认证 0/4 明确只有实名、单身承诺计分。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const edit = read('pagesSub/userExtra/user/edit.uvue')
const profile = read('pages/profile/profile.uvue')

// 1. 删除旧硬编码权重表与 fallback。
assert.ok(!/avatar:\s*15/.test(edit), 'edit.uvue 不得保留 avatar:15 硬编码权重')
assert.ok(!/intro:\s*10/.test(edit), 'edit.uvue 不得保留 intro:10 硬编码权重')
assert.ok(!/album:\s*8/.test(edit), 'edit.uvue 不得保留 album:8 硬编码权重')
assert.ok(!/personal_tags:\s*8/.test(edit), 'edit.uvue 不得保留 personal_tags:8 硬编码权重')
assert.ok(!edit.includes('fallbackCompletion'), 'edit.uvue 不得保留本地完成度 fallback')
assert.ok(!edit.includes('completionScore.value = data.completion_score'), '完整度 score 只能来自 /completion')

// 2. 只读接口的 weight/completed。
assert.ok(edit.includes('completionItems.value[key]'), 'edit.uvue 必须从 completionItems 读取 completed')
assert.ok(edit.includes('Number(item.weight)'), 'edit.uvue 必须从接口 item.weight 读取权重')
assert.ok(edit.includes('填写后 +'), '未填写项必须显示「填写后 +X%」')
assert.ok(edit.includes("'company'") && edit.includes("'school'") && edit.includes("'house'") && edit.includes("'car'"), '9 项详细资料必须参与完整度展示')
assert.ok(edit.includes("'household'") && edit.includes("'ethnicity'") && edit.includes("'religion'") && edit.includes("'smoking'") && edit.includes("'drinking'"), '9 项详细资料必须参与完整度展示')

// 3. 认证 0/4 只标注实名、单身承诺计分。
assert.ok(edit.includes('仅实名、单身承诺计分'), '四重认证必须标注只有实名/单身承诺计分')

// 4. 两处进度条共用 /completion score，并在 onShow 刷新。
assert.ok(profile.includes('const score = completionData.score'), '个人中心必须读取 /completion 的 score')
assert.ok(!profile.includes('completionData.score != null ? completionData.score : completionData.completion_score'), '个人中心不得回退到 completion_score')
assert.ok(profile.includes('onShow(() =>') && profile.includes('loadOverview()'), '个人中心 onShow 必须刷新完整度')
assert.ok(edit.includes('refreshCompletion') && edit.includes('onShow(() =>'), '编辑页 onShow/保存后必须刷新完整度')

console.log('资料完整度前端契约测试通过')
