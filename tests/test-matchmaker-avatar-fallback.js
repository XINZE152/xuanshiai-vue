const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function expect(content, fragment, label) {
  if (!content.includes(fragment)) {
    throw new Error(`${label}: missing ${fragment}`)
  }
  console.log(`PASS ${label}`)
}

console.log('Matchmaker avatar fallback checks')

const avatar = read('components/MatchmakerAvatar.uvue')
expect(avatar, "if (name.length === 3) return name.slice(1);", 'three-character names remove surname')
expect(avatar, 'if (name.length === 2) return name;', 'two-character names retain full name')
expect(avatar, '@error="handleImageError"', 'broken avatar image falls back to initials')
expect(avatar, 'imageFailed.value = true;', 'image failure state is recorded')

const card = read('components/MatchmakerCard.uvue')
expect(card, '<MatchmakerAvatar :src="data.avatar" :name="data.name" variant="card" />', 'card uses shared avatar fallback')

const ranking = read('components/MatchmakerRank.uvue')
expect(ranking, '<MatchmakerAvatar :src="slot.item.avatar" :name="slot.item.name" :variant="slot.variant" />', 'ranking uses shared avatar fallback')

const detail = read('pagesSub/matchmaker/detail.uvue')
expect(detail, '<MatchmakerAvatar :src="matchmaker.avatar" :name="matchmaker.name" variant="detail" />', 'detail uses shared avatar fallback')

console.log('Matchmaker avatar fallback checks passed')
