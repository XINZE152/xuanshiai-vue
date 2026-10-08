const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const artifactRoot = path.resolve(__dirname, '..', 'unpackage', 'dist', 'dev', 'mp-weixin')
const expectedAssets = [
  path.join('pagesSub', 'matchmaker', 'static', 'cases', 'shenzhen-zhang-liu.webp'),
  path.join('pagesSub', 'matchmaker', 'static', 'cases', 'wuhan-zhou-zheng.webp'),
  path.join('static', 'portraits', 'custom-matchmaker-hero.webp')
]
const expectedProfileExtraAssets = [
  path.join('pagesSub', 'profileExtra', 'static', 'moxiang-master-idle.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'moxiang-master-listening.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'moxiang-master-speaking.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'moxiang-master-thinking.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'poster-templates', 'ehi3K.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'poster-templates', 'X7hDIt.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'poster-templates', 'gabCv.webp'),
  path.join('pagesSub', 'profileExtra', 'static', 'poster-templates', 'v4EFK.webp')
]

// SKIP 协议：产物缺失（干净检出、CI）时显式降级，不把「没跑」记作失败或通过。
// 产物由 HBuilderX 生成（AGENTS §6.1），发布验收须在有产物的环境跑 npm run test:artifact。
if (!fs.existsSync(artifactRoot)) {
  console.log('SKIP test-mp-subpackage-assets.js: compiled artifact missing unpackage/dist/dev/mp-weixin — regenerate via HBuilderX per AGENTS §6.1; artifact gate inactive')
  process.exit(0)
}

for (const asset of expectedAssets) {
  assert.ok(fs.existsSync(path.join(artifactRoot, asset)), `missing generated matchmaker asset: ${asset}`)
}
for (const asset of expectedProfileExtraAssets) {
  assert.ok(fs.existsSync(path.join(artifactRoot, asset)), `missing generated profile-extra asset: ${asset}`)
}
assert.ok(!fs.existsSync(path.join(artifactRoot, 'pagesSub', 'matchmaker', 'assets')), 'matchmaker assets must not be copied into an untracked subpackage directory')
assert.ok(!fs.existsSync(path.join(artifactRoot, 'assets')), 'profile-extra assets must remain in their subpackage instead of being emitted into the main package')

console.log('PASS mp-weixin subpackage assets')
