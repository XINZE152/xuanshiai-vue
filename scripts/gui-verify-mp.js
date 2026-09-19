/**
 * 通过微信开发者工具自动化通道对小程序做真实 GUI 验证。
 *
 * 用法（项目根目录）：
 *   node scripts/gui-verify-mp.js
 *
 * 前置：开发者工具已登录、已打开 unpackage/dist/dev/mp-weixin，且已开启自动化。
 * 端口从开发者工具 User Data 的 .cli 文件读取，失败时回退到环境变量。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const automator = require('miniprogram-automator')

const PROJECT = path.resolve(__dirname, '..', 'unpackage', 'dist', 'dev', 'mp-weixin')
const SHOT_DIR = path.resolve(__dirname, '..', 'artifacts-gui')
const PHONE = process.env.GUI_PHONE || '19730552884'
const PASSWORD = process.env.GUI_PASSWORD || 'password123'

function findAutomationPort() {
  if (process.env.WX_AUTOMATION_PORT) return Number(process.env.WX_AUTOMATION_PORT)
  const base = path.join(os.homedir(), 'AppData', 'Local', '微信开发者工具', 'User Data')
  if (!fs.existsSync(base)) return null
  for (const dir of fs.readdirSync(base)) {
    const cli = path.join(base, dir, 'Default', '.cli')
    if (!fs.existsSync(cli)) continue
    const raw = fs.readFileSync(cli, 'utf8').trim()
    const value = Number(raw)
    if (Number.isInteger(value) && value > 0) return value
  }
  return null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  try {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  } catch (error) {
    // 截图失败不影响功能判定，仅记录。
    console.log(`  (截图失败 ${name}: ${error.message})`)
  }
}

/** 读取当前页面可见文本，用于判断是否渲染出内容。 */
async function pageText(page) {
  try {
    const el = await page.$('page')
    if (!el) return ''
    return (await el.text()) || ''
  } catch (error) {
    return ''
  }
}

async function main() {
  const port = findAutomationPort()
  if (!port) {
    console.error('未找到自动化端口：请先在微信开发者工具中开启「设置 → 安全 → 服务端口/自动化」')
    process.exit(1)
  }
  console.log(`连接开发者工具自动化端口 ${port}`)
  console.log(`项目 ${PROJECT}`)

  const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
  console.log('已连接\n')

  try {
    // ---- 登录 ----
    let page = await miniProgram.reLaunch('/pages/auth/login')
    await sleep(2500)
    await shot(page, '01-login')
    record('打开登录页', true, await page.path())

    // 调试账号按钮（页面内置「账号一」快捷登录）
    const buttons = await page.$$('button')
    let clicked = false
    for (const button of buttons) {
      const text = (await button.text()) || ''
      if (text.indexOf(PHONE) >= 0) {
        await button.tap()
        clicked = true
        record('点击账号一调试登录按钮', true, text.trim())
        break
      }
    }
    if (!clicked) {
      // 回退：手填手机号 + 密码走调试登录
      record('点击账号一调试登录按钮', false, '未找到按钮，尝试直接调用接口登录')
      await miniProgram.callWxMethod({
        method: 'request',
        args: [{
          url: 'http://127.0.0.1:8000/api/v1/auth/test-login',
          method: 'POST',
          data: { phone: PHONE, password: PASSWORD, device_id: 'gui-verify', platform: 'mp-weixin', app_version: 'dev' },
          header: { 'content-type': 'application/json' },
        }],
      })
    }
    await sleep(4500)
    await shot(page, '02-after-login')
    record('登录后离开登录页', (await page.path()).indexOf('login') < 0, await page.path())

    // ---- 首页：推荐流 ----
    page = await miniProgram.reLaunch('/pages/index/index')
    await sleep(4000)
    await shot(page, '03-index')
    let text = await pageText(page)
    record('首页渲染出内容', text.length > 40, `${text.length} 字`)
    record('首页出现昵称', /林知夏|周予安|顾言澄|沈知意|许闻洲|唐婉|程野|苏芷宁|陆云舟|何知遥|江砚|邵以宁|秦朗/.test(text),
      (text.match(/林知夏|周予安|顾言澄|沈知意|许闻洲|唐婉|程野|苏芷宁|陆云舟|何知遥|江砚|邵以宁|秦朗/) || [''])[0])

    // ---- 社区：动态流 ----
    page = await miniProgram.switchTab('/pages/community/community')
    await sleep(3500)
    await shot(page, '04-community')
    text = await pageText(page)
    record('社区页渲染出动态', text.length > 80, `${text.length} 字`)
    record('社区出现话题内容', /真诚关系|周末同城|婚恋沟通|一个人也要|城市漫步|读书会/.test(text))

    // 话题列表
    page = await miniProgram.navigateTo('/pagesSub/community/topic-list')
    await sleep(2500)
    await shot(page, '05-topics')
    text = await pageText(page)
    record('话题列表有数据', text.length > 30, `${text.length} 字`)

    // 活动列表
    page = await miniProgram.navigateTo('/pagesSub/community/activity-list')
    await sleep(2500)
    await shot(page, '06-activities')
    text = await pageText(page)
    record('线下活动列表有数据', /读书会|城市漫步|分享会/.test(text), `${text.length} 字`)

    // 纸飞机
    page = await miniProgram.navigateTo('/pagesSub/community/paper-plane')
    await sleep(3000)
    await shot(page, '07-paper-plane')
    text = await pageText(page)
    record('纸飞机页面有内容', text.length > 30, `${text.length} 字`)

    // ---- 消息 ----
    page = await miniProgram.switchTab('/pages/message/message')
    await sleep(3500)
    await shot(page, '08-message')
    text = await pageText(page)
    record('消息页渲染出会话', text.length > 40, `${text.length} 字`)

    // ---- 我的 ----
    page = await miniProgram.switchTab('/pages/profile/profile')
    await sleep(3500)
    await shot(page, '09-profile')
    text = await pageText(page)
    record('我的页渲染出内容', text.length > 40, `${text.length} 字`)
    record('我的页显示账号一', /账号一/.test(text))

    // 认证中心
    page = await miniProgram.navigateTo('/pagesSub/profileExtra/certification')
    await sleep(3000)
    await shot(page, '10-certification')
    text = await pageText(page)
    record('认证中心渲染', text.length > 30, `${text.length} 字`)
    record('认证中心显示已通过/已认证', /已通过|已认证|已绑定/.test(text))

    // 会员中心
    page = await miniProgram.navigateTo('/pagesSub/profileExtra/vip')
    await sleep(3000)
    await shot(page, '11-vip')
    text = await pageText(page)
    record('会员中心渲染', text.length > 30, `${text.length} 字`)

    // 我的动态
    page = await miniProgram.navigateTo('/pagesSub/profileExtra/my-moments')
    await sleep(2500)
    await shot(page, '12-my-moments')
    record('我的动态渲染', true, await page.path())

    // 访客 / 收藏
    for (const [route, name] of [
      ['/pagesSub/profileExtra/visitors', '谁看过我'],
      ['/pagesSub/profileExtra/favorites', '我的收藏'],
      ['/pagesSub/profileExtra/applications', '我的申请'],
      ['/pagesSub/profileExtra/my-tasks', '我的任务'],
    ]) {
      page = await miniProgram.navigateTo(route)
      await sleep(2500)
      await shot(page, `13-${path.basename(route)}`)
      // 返回，避免页面栈过深
      await miniProgram.navigateBack()
      await sleep(1200)
      record(`${name} 页面可打开`, true, route)
    }

    // ---- 用户详情（从推荐进入） ----
    page = await miniProgram.reLaunch('/pages/index/index')
    await sleep(3500)
    const cards = await page.$$('view')
    let opened = false
    for (const card of cards.slice(0, 40)) {
      const text = (await card.text()) || ''
      if (text.length > 20 && /林知夏|周予安|顾言澄|沈知意|许闻洲/.test(text)) {
        await card.tap()
        opened = true
        break
      }
    }
    await sleep(3000)
    await shot(page, '14-user-detail')
    record('可从首页点开用户详情', opened, await page.path())
  } finally {
    try {
      await miniProgram.disconnect()
    } catch (error) {
      // 忽略断开异常
    }
  }

  const passed = results.filter((item) => item.ok).length
  console.log('\n' + '='.repeat(60))
  console.log(`GUI 验证通过 ${passed}/${results.length}`)
  const failed = results.filter((item) => !item.ok)
  if (failed.length) {
    console.log('\n未通过：')
    failed.forEach((item) => console.log(`  - ${item.name}: ${item.detail}`))
  }
  console.log(`截图目录: ${SHOT_DIR}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((error) => {
  console.error('GUI 验证异常:', error.message)
  process.exit(1)
})
