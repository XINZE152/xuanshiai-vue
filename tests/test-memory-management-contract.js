/**
 * 微信记忆管理的源级契约回归。
 *
 * UniApp X 的 .uts/.uvue 由 HBuilderX 编译；这里先锁住前端与 FastAPI 的
 * 路径、乐观锁、幂等和本地数据边界，编译产物另由 mp-weixin 门禁验证。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
// Windows 检出（core.autocrlf）会把 LF 转成 CRLF；契约断言必须与行尾无关。
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n')

const memoryApi = read('api/ai-memory.uts')
const memoryMock = read('mock/ai-memory.uts')
const memorySheet = read('components/MemoryManagementSheet.uvue')
const archivePage = read('pagesSub/profileExtra/my-portrait-archive.uvue')
const avatarApi = read('api/ai-avatar.uts')
const chatPage = read('pagesSub/chat/detail.uvue')

assert(memoryApi.includes("buildApiUrl('/ai/memory/view')"), '记忆视图必须请求服务端 /ai/memory/view')
assert(memoryApi.includes('expected_revision: expectedRevision'), '确认/纠正必须传递条目 revision')
assert(memoryApi.includes("'Idempotency-Key': key"), '写操作必须使用幂等键')
assert(memoryApi.includes("status == 409"), '前端必须向用户说明 revision 冲突')
assert(memoryMock.includes('let items: any[] = clone(seedItems)'), 'Mock 状态必须只在运行期内存中维护')
assert(!memoryMock.includes('setStorageSync'), 'Mock 不得把记忆内容写入本地持久化 storage')
assert(memorySheet.includes("selectSubject('personal')"), '管理页必须提供“关于我”主体')
assert(memorySheet.includes("selectSubject('ideal_partner')"), '管理页必须提供“伴侣偏好”主体')
assert(memorySheet.includes('confirmMemory(item.claimId, item.revision'), '确认必须以当前 revision 乐观锁提交')
assert(memorySheet.includes('revokeMemoryGrant(grant.grantId, key)'), '授权撤回应通过后端 grant 接口')
assert(archivePage.includes('MemoryManagementSheet'), '档案页必须挂载微信端记忆管理 Sheet')
assert(archivePage.includes('openMemorySheet()'), '档案页必须有打开记忆管理的入口')
assert(avatarApi.includes("url: '/ai/avatar/' + String(userId) + '/reply'"), '真实模式的 AI 分身必须调用服务端公开资料接口')
assert(avatarApi.includes('if (USE_MOCK !== true)'), '本地演示必须只保留在显式 Mock 模式')
const realAvatarBranch = avatarApi.split('if (USE_MOCK !== true) {')[1].split('\n  }\n\n  const result')[0]
assert(!realAvatarBranch.includes('writeMessages('), '真实 AI 分身回复不得写入 uni storage')
assert(memoryApi.includes("throw new Error('记忆服务返回了无效 revision"), '缺失 revision 的服务端条目必须拒绝写入，不能以 0 继续更新')
assert(chatPage.includes('await sendAiAvatarMessage('), '聊天页面必须等待真实 AI 分身异步结果')

console.log('memory management contract: PASS')
