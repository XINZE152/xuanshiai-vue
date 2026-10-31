/**
 * L1 批前端独立修复的源码契约（修改方案 2026-10-29 全量版）。
 *
 * 覆盖四条：
 *  1) 聊天头像：己方取真实资料头像、对方裸路径必须 resolveMediaUrl，空串才回退默认；
 *  2) AI 军师：创建会话必须带 Idempotency-Key（后端 Header min_length=8 必填）；
 *  3) 首页空区块：无照片/无动态/无 bio 时整块不渲染；
 *  4) 情感实验室：mock 模式下禁止提示「已同步」（E1 本地体验版）。
 *
 * 只做源码契约断言，不依赖 node_modules，不读编译产物。
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

// ========== 1. 聊天头像 ==========

const messageApi = read('api/message.uts')
const chatPage = read('pagesSub/chat/detail.uvue')
const apiIndex = read('api/index.uts')
const authApi = read('api/auth.uts')

assert.match(messageApi, /export async function getMyAvatarUrl\(\): Promise<string>/, '必须提供己方头像读取函数（带缓存）')
assert.match(messageApi, /function resolveAvatarUrl\(raw: any, fallback: string\): string/, '必须提供裸路径解析，兜住空串')
assert.match(messageApi, /const myAvatar = await getMyAvatarUrl\(\)/, '历史消息必须使用真实己方头像')
assert.doesNotMatch(
  messageApi,
  /avatar: isMine \? DEFAULT_ME_AVATAR : peerAvatar/,
  '历史消息不得再把己方头像写死成默认男头像'
)
assert.match(messageApi, /avatar: isMine \? myAvatar : peerAvatar/, '历史消息己方头像必须取 myAvatar')
assert.match(messageApi, /export function resetMyAvatarCache\(\): void/, '必须提供缓存清理，换号后不能沿用上个账号头像')
assert.match(apiIndex, /getMyAvatarUrl,/, '@/api 必须导出 getMyAvatarUrl 供页面使用')
assert.match(authApi, /resetMyAvatarCache\(\)/, '退出登录必须清理头像缓存')

const chatAvatarLiterals = (chatPage.match(/\/static\/portraits\/profile-man-light\.webp/g) || []).length
assert.strictEqual(chatAvatarLiterals, 1, '聊天页只允许保留 1 处默认头像字面量（ref 初值），新发消息必须用 myAvatar')
assert.match(chatPage, /avatar: isParentMode\.value \? '' : myAvatar\.value/, '文本消息必须使用 myAvatar')
assert.match(chatPage, /avatar: myAvatar\.value/, '媒体消息必须使用 myAvatar')

// ========== 2. AI 军师幂等键 ==========

const advisorApi = read('api/ai-advisor.uts')
const advisorSheet = read('components/XsaAiAdvisorSheet.uvue')

assert.match(advisorApi, /'Idempotency-Key': advisorIdempotencyKey\(chatSessionId\)/, '创建军师会话必须带 Idempotency-Key')
assert.match(advisorApi, /function advisorIdempotencyKey\(chatSessionId: number\): string/, '幂等键必须按会话复用，重试不能换键')
assert.match(
  advisorApi,
  /advisorSessionKeySeed\.length|advisorSessionKeySeed == ''|advisorSessionKeyChatId != chatSessionId/,
  '幂等键必须缓存：同一会话的重复创建要返回同一键'
)
assert.ok(
  /Idempotency-Key/.test(advisorApi) && /min_length|8/.test(advisorApi),
  '代码注释需记录后端 min_length=8 的约束来源'
)
assert.match(
  advisorSheet,
  /Number\(sessionRes\.code\) == 422 \? '军师会话创建失败/,
  '建会话 422 不能复用「内容不适合」文案，必须提示请求参数异常'
)

// ========== 3. 首页空区块 ==========

const indexPage = read('pages/index/index.uvue')

assert.match(indexPage, /<view class="about-section" v-if="currentBioText != ''">/, '无 bio 时必须整块隐藏「关于我」')
assert.match(indexPage, /const currentBioText = computed/, '必须提供 currentBioText 计算属性（含未解锁判定）')
assert.match(indexPage, /<view class="photos-section" v-if="firstMomentPhoto != ''">/, '无照片时必须隐藏「Ta的瞬间」')
assert.match(indexPage, /<view class="feed-section" v-if="feedDynamics.length > 0">/, '无动态时必须隐藏「Ta的动态」')
assert.doesNotMatch(
  indexPage,
  /<view class="photos-section">\s*<view class="feed-section-header">/,
  '照片区块不得再无条件渲染（会留下空标题）'
)

// ========== 4. 情感实验室 E1 降级 ==========

const labPage = read('pages/emotion-lab/emotion-lab.uvue')

assert.match(labPage, /EMOTION_LAB_USE_MOCK\s*\n?\s*\} from '@\/api'/, '情感实验室必须经统一入口拿到 mock 开关（页面禁止直连 api/config.uts）')
assert.doesNotMatch(labPage, /from '@\/api\/config\.uts'/, '情感实验室不得绕过 api/index.uts 直连配置模块')
assert.match(labPage, /const emotionLabLocalOnly = EMOTION_LAB_USE_MOCK/, '必须以开关派生本地体验版标记')
assert.match(
  labPage,
  /if \(emotionLabLocalOnly\) \{\s*\n\s*noticeMessage\.value = '情感实验室为本地体验版/,
  'mock 模式下保存结果必须直接拦下，不调接口'
)
assert.match(labPage, /emotionLabLocalOnly \? '同步暂未开放'/, '同步 CTA 必须在本地体验版时显示未开放')
assert.match(labPage, /:disabled="emotionLabLocalOnly \|\| !assessmentConfirmed \|\| savingProfile"/, '同步按钮在本地体验版时禁用')

/** 保证「已同步」只在真实链路出现：mock 拦截块必须位于 toast 之前。 */
const guardIdx = labPage.indexOf('if (emotionLabLocalOnly) {')
const syncToastIdx = labPage.indexOf("title: '已同步'")
assert.ok(guardIdx > 0 && syncToastIdx > guardIdx, '「已同步」toast 必须在 mock 拦截之后')

console.log('PASS L1 批契约：头像取真实资料 / 军师带幂等键 / 空区块隐藏 / 情感实验室不再假同步')
