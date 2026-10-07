const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const config = fs.readFileSync(path.join(root, 'api/config.uts'), 'utf8')
const ws = fs.readFileSync(path.join(root, 'api/voice-master-ws.uts'), 'utf8')

// AI voice WebSocket authentication is two-step: Bearer HTTP ticket issuance,
// then a single-use ticket in the WebSocket query. A long-lived JWT must never
// be placed in the AI WebSocket URL.
assert.match(config, /export function buildWsTicketUrl\(path: string, ticket: string\)/)
assert.match(config, /sep \+ 'ticket=' \+ encodeURIComponent\(ticket\)/)
assert.match(ws, /import \{ request \} from '\.\/request\.uts'/)
assert.match(ws, /url: '\/voice\/ws-ticket'/)
assert.match(ws, /method: 'POST'/)
assert.match(ws, /ticketResponse\.success === true/)
assert.match(ws, /buildWsTicketUrl\('\/voice\/moxiang-master', ticket\)/)
assert.doesNotMatch(ws, /buildWsUrl\('\/voice\/moxiang-master'/)

console.log('PASS moxiang WebSocket ticket contract')
