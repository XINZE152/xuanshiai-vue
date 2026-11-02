const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const expect = (content, fragment, label) => {
  if (!content.includes(fragment)) throw new Error(`${label}: missing ${fragment}`)
  console.log(`PASS ${label}`)
}
const expectAbsent = (content, fragment, label) => {
  if (content.includes(fragment)) throw new Error(`${label}: must not contain ${fragment}`)
  console.log(`PASS ${label}`)
}

console.log('Matchmaker workspace real-service checks')

const api = read('api/matchmaker.uts')
for (const endpoint of [
  '/matchmaker/management-center/access',
  '/matchmaker/management-center/dashboard',
  '/matchmaker/workbench/members',
  '/matchmaker/partner-center',
  '/matchmaker/promoter-center'
]) expect(api, endpoint, `workspace endpoint ${endpoint}`)
for (const legacy of [
  'MATCHMAKER_MANAGEMENT_CENTER_USE_MOCK',
  'PARTNER_CENTER_USE_MOCK',
  'PROMOTER_CENTER_USE_MOCK',
  'canUseWorkspaceDemoFallback'
]) expectAbsent(api, legacy, `${legacy} removed`)
expect(api, "from './matchmaker-remote.uts'", 'workspace requests use remote endpoint guard')
expect(api, 'const useDemoFallback = USE_MOCK', 'demo fallback requires explicit global mock mode')

const accessPage = read('pagesSub/matchmaker/become-matchmaker.uvue')
expect(accessPage, 'getMatchmakerManagementCenterAccess', 'entry loads access state')
expect(accessPage, 'getMatchmakerManagementCenterSnapshot', 'entry loads dashboard snapshot')
expect(accessPage, '<MatchmakerPendingReview', 'pending review workbench mounted')
expectAbsent(accessPage, '完成服务开通付款', 'payment is not an entry gate')

const review = read('components/MatchmakerPendingReview.uvue')
for (const apiName of [
  'getMatchmakerReviewMembers',
  'updateMatchmakerReviewMember',
  'getMatchmakerMemberFollowUps',
  'getMatchmakerMemberMatchCandidates',
  'getMatchmakerMemberMatchHistory'
]) expect(review, apiName, `pending review uses ${apiName}`)
expect(review, "emit('contact', member)", 'review delegates contact to parent authorization flow')
expect(accessPage, 'getMatchmakerMemberContact', 'parent uses audited member contact endpoint')
expect(review, '公开资料审核只对总店（SUPER）红娘开放', 'review role boundary')
expectAbsent(review, 'pendingReviewProfiles', 'no local review fixture')

const partner = read('pagesSub/matchmaker/partner-center.uvue')
expect(partner, 'getPartnerCenterSnapshot', 'partner page loads server snapshot')
expect(partner, 'createPartnerTeamInvite', 'partner page creates server invite')
const promoter = read('pagesSub/matchmaker/promoter-center.uvue')
expect(promoter, 'getPromoterCenterSnapshot', 'promoter page loads server snapshot')
expect(promoter, 'addPromoterLead', 'promoter page creates server lead')
expect(promoter, 'createPromoterPromotionCode', 'promoter page creates server promotion code')

console.log('Matchmaker workspace real-service checks passed')
