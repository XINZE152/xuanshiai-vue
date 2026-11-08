const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const ws = read('api/voice-master-ws.uts')
const page = read('pagesSub/profileExtra/my-portrait-master.uvue')
const panel = read('pagesSub/profileExtra/components/moxiang/MoxiangProgressPanel.uvue')

assert.match(ws, /onExtractionStatus\?:/, 'journey client must expose extraction status')
assert.match(ws, /onJourneyProgress\?:/, 'journey client must expose six-dimension progress')
assert.match(ws, /case 'extraction_status':/, 'journey client must handle extraction status')
assert.match(ws, /case 'journey_progress':/, 'journey client must handle journey progress')
assert.doesNotMatch(ws, /profile_build/, 'legacy profile_build wire mode must be removed')
assert.match(page, /startJourneyMode\(currentSubject\.value, 'profile-text-v1'\)/)
assert.doesNotMatch(page, /startBuildMode\(/, 'page must not fall back to legacy build mode')
assert.match(page, /onExtractionStatus:/)
assert.match(page, /onJourneyProgress:/)
assert.match(panel, /已理解 \{\{ dim\.evidenceCount \}\} 条/)
assert.match(panel, /正在理解/, 'panel must show unobtrusive extraction status')

console.log('PASS journey realtime progress contract')
