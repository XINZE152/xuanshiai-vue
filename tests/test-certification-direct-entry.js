const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const certification = fs.readFileSync(
  path.join(root, 'pagesSub/profileExtra/certification.uvue'),
  'utf8'
)
const profileEdit = fs.readFileSync(
  path.join(root, 'pagesSub/userExtra/user/edit.uvue'),
  'utf8'
)
const authApi = fs.readFileSync(path.join(root, 'api/auth.uts'), 'utf8')

for (const label of ['实名认证', '学历认证', '头像认证', '单身承诺']) {
  assert.match(certification, new RegExp(label), `certification center must expose ${label}`)
}

assert.match(
  profileEdit,
  /url:\s*['"`]\/pagesSub\/profileExtra\/certification\?type=['"`]\s*\+\s*key/,
  'profile certification action must preserve the selected certification type'
)

assert.match(
  profileEdit,
  /key\s*==\s*['"]avatar['"][\s\S]{0,120}chooseAvatar\(\)[\s\S]{0,80}return/,
  'avatar certification must open image upload directly from the profile page'
)

assert.match(
  certification,
  /options\.type[\s\S]{0,160}options\.focus/,
  'certification center must support both profile type and gate focus parameters'
)

assert.match(
  certification,
  /openStep\(['"]education['"]\)/,
  'education certification must have its own direct action'
)

assert.match(authApi, /url:\s*['"]\/users\/me\/certifications['"]/, 'certification status API must be connected')
assert.match(authApi, /\/users\/me\/certifications\/education\/material/, 'education image submission API must be connected')
assert.match(authApi, /\/users\/me\/certifications\/single-pledge/, 'single pledge signature API must be connected')
assert.match(certification, /canvas-id=['"]pledgeSignature['"]/, 'single pledge must expose a handwritten signature canvas')
assert.match(certification, /createCanvasContextAsync[\s\S]*getContext\(['"]2d['"]\)/, 'signature board must use the 2D context required by the compiled mini-program canvas')
assert.doesNotMatch(certification, /createCanvasContext\(['"]pledgeSignature['"]\)/, 'signature board must not mix the legacy context with a 2D canvas')
assert.match(certification, /educationOptions[\s\S]*school[\s\S]*chooseEducationImage/, 'education form must collect degree, school and one image')
assert.match(certification, /\.line-field\s*\{[^}]*flex-direction:\s*row/, 'education fields must stay in a horizontal label-value row')
assert.doesNotMatch(certification, /您的毕业学校[^\n]*picker-arrow/, 'school text input must not render a navigation arrow')
assert.doesNotMatch(certification, /detail-heading|back-link/, 'detail views must not duplicate the native navigation title or back button')
assert.match(certification, /navigateTo\(\{\s*url:\s*['"]\/pagesSub\/profileExtra\/certification\?type=['"]\s*\+\s*step/, 'center entries must open a stacked detail so the native back button returns to the center')
assert.match(certification, /已完成 \{\{ completed \}\}\/4/, 'phone binding must not count toward the four-certification progress')
assert.match(profileEdit, /getUserCertifications\(\)/, 'profile page must refresh education certification status after returning')

console.log('certification direct-entry contract passed')
