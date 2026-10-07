const fs = require('fs')
const path = require('path')
const assert = require('assert')

const vueRoot = path.join(__dirname, '..')
const backendRoot = path.join(vueRoot, '..', 'xuanshiai-backend')
const read = (root, relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const prompt = read(backendRoot, 'app/services/ai/prompts/moxiang_master.py')
const sharedPrompt = read(backendRoot, 'app/services/ai/prompts/moxiang_ip.py')
const route = read(backendRoot, 'app/api/routes/voice_moxiang.py')
const ws = read(vueRoot, 'api/voice-master-ws.uts')
const page = read(vueRoot, 'pagesSub/profileExtra/my-portrait-master.uvue')
const badge = read(vueRoot, 'utils/moxiang-badge.uts')

assert.match(sharedPrompt, /MOXIANG_ROLE_NAME\s*=\s*["']知遇["']/, 'shared backend prompt must define the dedicated persona name')
assert.match(prompt, /MOXIANG_ROLE_NAME/, 'master prompt must import the shared persona name')
assert.match(prompt, /AI_ROLE_NAME\s*=\s*MOXIANG_ROLE_NAME/, 'master prompt must alias the shared persona name')
assert.match(prompt, /build_moxiang_ip_system_prompt\(/, 'master prompt must compile system prompts through the shared IP prompt')
assert.match(prompt, /你好，我是\{AI_ROLE_NAME\}/, 'opening must introduce the persona name')
assert.match(route, /f"\{AI_ROLE_NAME\}暂时无法回复"/, 'voice errors must use the persona name')
// 前端角色名单一定义在 utils/moxiang-badge.uts，voice-master-ws.uts 只做 re-export，
// 避免两处硬编码「知遇」在改名时漂移。
assert.match(badge, /MASTER_ROLE_NAME\s*=\s*'知遇'/, 'shared frontend util must define the same persona name')
assert.match(ws, /export\s*\{[^}]*\bMASTER_ROLE_NAME\b[^}]*\}/, 'frontend WS must re-export the shared persona name')
assert.doesNotMatch(ws, /MASTER_ROLE_NAME\s*=\s*['"]/, 'frontend WS must not duplicate the persona name literal')
assert.match(page, /const masterRoleName\s*=\s*MASTER_ROLE_NAME/, 'page must render the dedicated persona name')
assert.doesNotMatch(page, /我是点点/, 'legacy nickname must not be shown by the page')

console.log('Moxiang role identity checks passed')
