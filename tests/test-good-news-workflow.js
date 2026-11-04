const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const root = path.join(__dirname, '..')
function compile(file, requireModule, extra = {}, suffix = '') {
  let source = fs.readFileSync(path.join(root, file), 'utf8')
  if(file.endsWith('.uvue')) source = source.match(/<script setup lang="uts">([\s\S]*?)<\/script>/)[1]
  const code = babel.transformSync(source+suffix,{filename:'test.ts',configFile:false,babelrc:false,plugins:['@babel/plugin-transform-typescript','@babel/plugin-transform-modules-commonjs']}).code
  const context = {exports:{},require:requireModule,console,...extra}
  vm.runInNewContext(code,context)
  return context.exports
}
const calls=[]
let response = {success:true,data:{}}
const media = value=>value.startsWith('/')?'http://127.0.0.1:8000'+value:value
const api = compile('api/workspace-good-news.uts', name=>name.includes('config')?{resolveMediaUrl:media}:{request:async options=>{calls.push(options);return {...response}}})
const helpers=compile('utils/good-news.uts',()=>({}))
assert.equal(helpers.GOOD_NEWS_STAGES.length,8)
assert.equal(helpers.goodNewsTone('已领证'),'pink')
const item=api.normalizeGoodNews({id:7,stage:'恋爱生活',from_user_id:62,to_user_id:63,from_name:'李先生',to_name:'林女士',images:['/storage/photo.webp'],blessing_count:3,public:false})
assert.equal(item.fromUserId,'62')
assert.equal(item.fromName,'李先生')
assert.equal(item.images[0],'http://127.0.0.1:8000/storage/photo.webp')
assert.equal(item.public,false)
const events=[]
let detailReply = async ()=>({success:true,data:item})
const ui = compile('components/MatchmakerGoodNews.uvue', name=>{
  if(name==='vue') return {ref:value=>({value}),computed:fn=>({get value(){return fn()}}),onMounted:()=>{},getCurrentInstance:()=>({proxy:{}}),nextTick:async()=>{}}
  if(name.includes('api/good-news')) return {...api,getGoodNewsDetail:(...args)=>detailReply(...args)}
  if(name.includes('api/matchmaker')) return {getMatchmakerWorkspaceGoodNews:async()=>({success:true,data:{items:[],hasMore:false}}),getMatchmakerWorkspaceGoodNewsPennants:async()=>({success:true,data:{items:[],hasMore:false}})}
  if(name.includes('utils/good-news')) return helpers
  if(name.includes('api/config')) return {resolveMediaUrl:media}
  return {}
},{defineProps:()=>({displayName:'测试红娘',initialItemId:'',initialKind:'news'}),withDefaults:(value)=>value,defineEmits:()=>((...args)=>events.push(args)),defineExpose:()=>{},uni:{showToast:()=>{},previewImage:()=>{}}}, `
exports.test={openDetail,back,detail,detailLoading,openFeedback,submitFeedback,feedbackName,partnerName,feedbackConsent,formError,feedbackVisible,formImages,openBless,submitBlessing,blessVisible,blessMessage,rows,submitGift,giftConsent,giftError,selectedStage};
` ).test

async function run() {
  const nativeComponent = {id:'native-mini-program-component'}
  let painted = false
  const canvas = {}
  const createImage = ()=>({set src(value){this.onload()}})
  const context = {canvas,scale(){},drawImage(){painted=true},fillText(){}}
  const drawer = compile('utils/pennant-drawer.uts',()=>({}),{uni:{createCanvasContextAsync(options){
    assert.equal(options.component,nativeComponent,'the WeChat canvas query needs the native scope')
    options.success({getContext:()=>context,createImage})
  }}})
  await drawer.renderPennant('canvas',{ $scope:nativeComponent },{giver:'李先生',receiver:'服务红娘',leftWords:'感谢牵线',rightWords:'成就姻缘',dateText:'2026年'})
  assert(painted,'the preview must draw its background')
  assert.match(fs.readFileSync(path.join(root,'components/GoodNewsPennantCanvas.uvue'),'utf8'),/<canvas[^>]+type="2d"/)
  response={success:true,data:{id:7,stage:'恋爱生活'}}
  await api.getGoodNewsDetail('7','news')
  assert.equal(calls.at(-1).url,'/matchmaker/workbench/good-news/7')
  await api.sendGoodNewsBlessing('7',' 祝福你们 ')
  assert.equal(calls.at(-1).data.message,'祝福你们')
  response={success:false,code:500,message:'服务暂时异常'}
  assert.equal((await api.getGoodNewsDetail('7','news')).success,false,'remote errors cannot become demo success')
  let resolveDetail
  detailReply=()=>new Promise(resolve=>{resolveDetail=resolve})
  const pending=ui.openDetail({id:'7',kind:'news'})
  assert(ui.detailLoading.value)
  assert(ui.back(),'back should return to the list while detail is loading')
  resolveDetail({success:true,data:item})
  await pending
  assert.equal(ui.detail.value,null,'a late response cannot reopen a closed detail')
  ui.openFeedback()
  ui.feedbackName.value='李先生';ui.partnerName.value='林女士'
  let before=calls.length
  await ui.submitFeedback()
  assert.equal(calls.length,before,'feedback must wait for explicit consent')
  assert(ui.formError.value.includes('同意'))
  ui.feedbackConsent.value=true
  response={success:false,code:500,message:'服务器异常'}
  await ui.submitFeedback()
  assert(ui.feedbackVisible.value,'failure preserves the form for retry')
  response={success:true,data:{id:10,pending_review:true}}
  await ui.submitFeedback()
  assert.equal(ui.feedbackVisible.value,false)
  assert.equal(calls.at(-1).data.consent_confirmed,true)
  assert(calls.at(-1).data.client_request_id.length>=8)
  before=calls.length
  await ui.submitGift()
  assert.equal(calls.length,before,'pennant submission must wait for consent')
  const row={...item,public:true,pendingReview:false}
  ui.rows.value=[row]
  ui.openBless({...row,pendingReview:true})
  assert.equal(ui.blessVisible.value,false,'pending news cannot receive blessings')
  ui.openBless(row)
  response={success:true,data:{blessing_count:4,blessed:true,created:true}}
  await ui.submitBlessing()
  assert.equal(row.blessingCount,4)
  assert.equal(ui.blessVisible.value,false)
  ui.openBless(row)
  assert.equal(ui.blessVisible.value,false,'already-blessed items cannot reopen the send sheet')
  console.log('PASS good news: real API mapping, consent barriers, retry, late responses and blessing state')
}
run().catch(error=>{console.error(error);process.exitCode=1})



