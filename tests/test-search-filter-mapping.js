// 搜索筛选映射纯函数契约：MBTI、丧偶、居住地 6 位码与旧标签兼容。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils', 'searchFilterMapping.uts'), 'utf8')
const js = babel.transformSync(source.replace(/^export /gm, ''), {
  filename: 'searchFilterMapping.ts',
  configFile: false,
  babelrc: false,
  plugins: ['@babel/plugin-transform-typescript']
}).code
const fns = new Function(
  js + '\nreturn { educationMinFor, marriageStatusFor, residenceCityCodeFor, incomeYuanFromWanPerYear, buildStructuredSearchParams };'
)()

const {
  educationMinFor,
  marriageStatusFor,
  residenceCityCodeFor,
  incomeYuanFromWanPerYear,
  buildStructuredSearchParams
} = fns

assert.equal(educationMinFor('高中'), 1)
assert.equal(educationMinFor('博士'), 5)
assert.equal(educationMinFor('小学'), null)

assert.equal(marriageStatusFor('未婚'), 1)
assert.equal(marriageStatusFor('离异'), 2)
assert.equal(marriageStatusFor('丧偶'), 3)
assert.equal(marriageStatusFor('不限'), null)

assert.equal(residenceCityCodeFor('南京'), '320100')
assert.equal(residenceCityCodeFor('杭州'), '330100')
assert.equal(residenceCityCodeFor('上海'), '310100')
assert.equal(residenceCityCodeFor('深圳'), '440300')
assert.equal(residenceCityCodeFor('北京'), null)

assert.equal(incomeYuanFromWanPerYear(15), 150000)
assert.equal(incomeYuanFromWanPerYear(500), 1000000)

const mbti = buildStructuredSearchParams({ mbti: ['INTJ', 'ENFP'] })
assert.equal(mbti.mbti.length, 2)
assert.equal(mbti.mbti[0], 'INTJ')
assert.equal(mbti.mbti[1], 'ENFP')
assert.equal(Object.keys(buildStructuredSearchParams({ mbti: [] })).length, 0)

const city = buildStructuredSearchParams({ residenceCityCode: '320100' })
assert.equal(city.city_code, '320100')
assert.equal(city.province_code, undefined)

const province = buildStructuredSearchParams({ residenceProvinceCode: '320000' })
assert.equal(province.province_code, '320000')
assert.equal(province.city_code, undefined)

const legacy = buildStructuredSearchParams({ residenceLabel: '南京' })
assert.equal(legacy.city_code, '320100')

const combined = buildStructuredSearchParams({
  mbti: ['INTJ'],
  marriage: '丧偶',
  education: '本科',
  residenceCityCode: '320100',
  ageMin: 25,
  ageMax: 35
})
assert.equal(combined.marriage_status, 3)
assert.equal(combined.education_min, 3)
assert.equal(combined.city_code, '320100')
assert.equal(combined.age_min, 25)
assert.equal(combined.age_max, 35)

console.log('PASS search filter mapping: MBTI、丧偶、6 位居住地码与旧标签兼容')
