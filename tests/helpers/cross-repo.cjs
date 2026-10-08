/**
 * 跨仓路径解析的唯一入口。
 *
 * 由来（见 2026-10-08 验收报告 C2/C3）：跨仓测试此前各写各的——
 * `test-message-real-contract.js` 读 `XSA_BACKEND_ROOT`，其余测试硬编码
 * `../xuanshiai-backend`。CI 把后端契约检出到 `backend-contract`，于是只有
 * 一部分测试能看清后端；其余在干净检出里静默 SKIP 或失败，门禁形同虚设。
 *
 * 现在统一：优先 `XSA_BACKEND_ROOT`（可绝对、可相对前端仓库根），否则回退到
 * 同级目录 `../xuanshiai-backend`。找不到就显式返回 null，由调用方决定 SKIP，
 * 不静默假装通过。
 */
const fs = require('node:fs')
const path = require('node:path')

const frontendRoot = path.resolve(__dirname, '..', '..')

function backendRoot() {
  const configured = String(process.env.XSA_BACKEND_ROOT ?? '').trim()
  const candidate = configured !== ''
    ? path.resolve(frontendRoot, configured)
    : path.resolve(frontendRoot, '..', 'xuanshiai-backend')
  return fs.existsSync(candidate) ? candidate : null
}

/** 读后端文件内容；后端不可用时返回 null，调用方据此显式 SKIP。 */
function readBackend(relative) {
  const root = backendRoot()
  if (root == null) return null
  const file = path.join(root, relative)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

module.exports = { frontendRoot, backendRoot, readBackend }
