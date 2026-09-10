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

for (const label of ['实名认证', '学历认证', '头像认证']) {
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
assert.match(authApi, /url:\s*['"]\/users\/me\/certifications\/education['"][\s\S]{0,100}method:\s*['"]PUT['"]/, 'education submission API must be connected')
assert.match(profileEdit, /getUserCertifications\(\)/, 'profile page must refresh education certification status after returning')

console.log('certification direct-entry contract passed')
