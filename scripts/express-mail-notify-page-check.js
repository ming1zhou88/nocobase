#!/usr/bin/env node
/**
 * 快递通知邮件（7E2 → 7E1 → Dify 逐封发送）—— 页面渲染检查（真实浏览器）
 *
 * 目的：验证 NocoBase 页面本体（不只是接口）能正常打开、关键区块渲染出来、并能看到工单数据。
 * 依赖：仓库已安装 playwright（node_modules/.bin/playwright）+ 本地已下载 Chromium。
 *
 * 用法：
 *   node scripts/after-sales-batch-page-check.js                 # 默认检查 v2 客户端
 *   node scripts/after-sales-batch-page-check.js --client=v1     # 检查 v1 客户端（/admin 路由）
 *   node scripts/after-sales-batch-page-check.js --screenshot=/tmp/after-sales-page.png
 *   node scripts/after-sales-batch-page-check.js --executable-path=/path/to/chrome
 *
 * 环境变量：同自检脚本（NOCOBASE_BASE_URL / NOCOBASE_USERNAME / NOCOBASE_PASSWORD）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const hit = args.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

function readEnvFile() {
  const envPath = path.resolve(__dirname, '../.env');
  const result = {};
  if (!fs.existsSync(envPath)) {
    return result;
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}

const envFile = readEnvFile();
const BASE_URL = (argValue('base-url') || process.env.NOCOBASE_BASE_URL || 'http://127.0.0.1:13000').replace(/\/$/, '');
const USERNAME = process.env.NOCOBASE_USERNAME || envFile.INIT_ROOT_USERNAME || 'nocobase';
const PASSWORD = process.env.NOCOBASE_PASSWORD || envFile.INIT_ROOT_PASSWORD || '';
const CLIENT = argValue('client', 'v2');
const SCREENSHOT = argValue('screenshot', `/tmp/express-mail-notify-page-${CLIENT}.png`);
// v1 客户端挂在 /admin 下；v2（modern）客户端前缀由 APP_MODERN_CLIENT_PREFIX 决定，默认 /v
const MODERN_PREFIX = process.env.APP_MODERN_CLIENT_PREFIX || argValue('modern-prefix', 'v');
const ROUTE =
  CLIENT === 'v1' ? '/admin/express-mail/notify' : `/${MODERN_PREFIX.replace(/^\/+|\/+$/g, '')}/express-mail/notify`;
const LOGIN_CANDIDATES =
  CLIENT === 'v1' ? ['/signin'] : [`/${MODERN_PREFIX.replace(/^\/+|\/+$/g, '')}/signin`, '/signin'];

/**
 * 定位本机 Chromium：优先 --executable-path / PLAYWRIGHT_CHROMIUM_PATH，
 * 再扫描 ~/Library/Caches/ms-playwright 下的 chromium-* 目录（Playwright 版本与缓存版本可能不一致）。
 */
function resolveChromium() {
  const explicit = argValue('executable-path') || process.env.PLAYWRIGHT_CHROMIUM_PATH || '';
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  const cacheRoot = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cacheRoot)) {
    return undefined;
  }
  const candidates = [];
  for (const entry of fs.readdirSync(cacheRoot)) {
    if (!entry.startsWith('chromium-')) {
      continue;
    }
    for (const relative of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const full = path.join(cacheRoot, entry, relative);
      if (fs.existsSync(full)) {
        candidates.push(full);
      }
    }
  }
  return candidates.sort().pop();
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const chromiumPath = resolveChromium();
  console.log(`NocoBase ${BASE_URL} | 客户端 ${CLIENT} | 路由 ${ROUTE}`);
  console.log(`Chromium：${chromiumPath || '（使用 Playwright 默认路径）'}`);
  if (!PASSWORD) {
    throw new Error('未取到登录密码：请在 .env 设置 INIT_ROOT_PASSWORD，或用 NOCOBASE_PASSWORD 指定');
  }

  const browser = await chromium.launch({ headless: true, executablePath: resolveChromium() });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let consoleErrors = [];
  const capture = (text) => consoleErrors.push(String(text));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      capture(msg.text());
    }
  });
  page.on('pageerror', (error) => capture(error.message));

  try {
    console.log('\n=== 1. 登录 ===');
    let loggedIn = false;
    for (const loginPath of LOGIN_CANDIDATES) {
      await page.goto(`${BASE_URL}${loginPath}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(4000);
      if ((await page.locator('input[type="password"]').count()) === 0) {
        console.log(`   ${loginPath} 没有登录表单，尝试下一个入口`);
        continue;
      }
      await page.locator('input').first().fill(USERNAME);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(8000);
      loggedIn = !page.url().includes('signin');
      console.log(`   入口 ${loginPath} → ${page.url()}`);
      if (loggedIn) {
        break;
      }
    }
    check('登录后进入后台（URL 不再是登录页）', loggedIn, page.url());

    console.log('\n=== 2. 打开工作台页面 ===');
    // 登录期的 401 / 核心插件告警与本页面无关，从这里开始只统计页面自身的报错
    consoleErrors = [];
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const hasTitle = await page.getByText('快递通知邮件', { exact: false }).count();
      if (hasTitle > 0) {
        break;
      }
      await page.waitForTimeout(2000);
    }

    const titleCount = await page.getByText('快递通知邮件', { exact: false }).count();
    check('页面标题渲染（快递通知邮件）', titleCount > 0, `命中 ${titleCount} 处`);

    for (const [label, text] of [
      ['今日可发卡片', '今日可发快递邮件'],
      ['发送进度卡片', '发送进度'],
      ['今日可发按钮', '今日可发快递邮件'],
      ['发件邮箱映射按钮', '发件邮箱映射'],
      ['触发发送按钮', '触发发送'],
      ['重发失败项按钮', '重新尝试失败项'],
      ['演练模式开关', '演练模式'],
      ['筛选窗口提示', '美西'],
    ]) {
      const count = await page.getByText(text, { exact: false }).count();
      check(label, count > 0, `命中 ${count} 处`);
    }

    console.log('\n=== 2b. 日期控件（美西口径 + 快捷项） ===');
    const laDate = (offset) => {
      const base = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (!offset) return base;
      const [y, m, d] = base.split('-').map(Number);
      const shifted = new Date(Date.UTC(y, m - 1, d + offset));
      return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
        shifted.getUTCDate(),
      ).padStart(2, '0')}`;
    };
    for (const label of ['今天', '昨天', '前天']) {
      const count = await page.getByText(label, { exact: false }).count();
      check(`快捷项：${label}`, count > 0, `命中 ${count} 处`);
    }
    const dateInput = page.locator('.ant-picker-input input').first();
    check('日期为选择器（只读输入 + 日历图标）', (await dateInput.count()) > 0, `值=${await dateInput.inputValue()}`);
    check(
      '默认日期 = 美西今天',
      (await dateInput.inputValue()) === laDate(0),
      `页面=${await dateInput.inputValue()} 期望=${laDate(0)}`,
    );
    await page.locator('.ant-picker-input input').first().click();
    await page.waitForTimeout(1200);
    const presetCount = await page.locator('.ant-picker-presets li').count();
    check('日历面板带预设项（今天/昨天/前天）', presetCount >= 3, `${presetCount} 项`);
    await page.keyboard.press('Escape');
    await page.getByText('前天', { exact: false }).first().click();
    await page.waitForTimeout(6000);
    const afterQuick = await dateInput.inputValue();
    check('点「前天」后切到美西前天', afterQuick === laDate(-2), `页面=${afterQuick} 期望=${laDate(-2)}`);
    const alertText = (await page.locator('.ant-alert').allInnerTexts()).join(' | ');
    check('筛选窗口提示同步更新', alertText.includes(laDate(-2)), alertText.slice(0, 120).replace(/\n/g, ' '));
    await page.screenshot({ path: SCREENSHOT.replace('.png', '-date.png'), fullPage: true });

    console.log('\n=== 3. 收件人与正文预览 ===');
    // 日期框是只读的（只能从日历选择），这里点开日历选 2026-10-08
    await page.locator('.ant-picker-input input').first().click();
    await page.waitForTimeout(1000);
    await page.locator('.ant-picker-cell[title="2026-10-08"]').first().click();
    await page.waitForTimeout(6000);
    const pickedDate = await page.locator('.ant-picker-input input').first().inputValue();
    check('从日历选择 2026-10-08 成功', pickedDate === '2026-10-08', `页面=${pickedDate}`);
    const rows = await page.locator('.ant-table-tbody tr.ant-table-row').count();
    check('可发清单表格已渲染数据行', rows > 0, `${rows} 行`);
    const subjectVisible = await page
      .getByText('Notification of Tracking Information of Order', { exact: false })
      .count();
    check('表格可见邮件主题（模板渲染）', subjectVisible > 0, `命中 ${subjectVisible} 处`);
    const senderVisible = await page.getByText('@rattanartisan.com', { exact: false }).count();
    check('表格可见发件邮箱（店铺映射命中）', senderVisible > 0, `命中 ${senderVisible} 处`);
    const checkbox = page.locator('.ant-table-tbody tr.ant-table-row input[type="checkbox"]').first();
    check('存在可勾选框', (await checkbox.count()) > 0);
    await page.screenshot({ path: SCREENSHOT, fullPage: true });
    check('已截图留档', fs.existsSync(SCREENSHOT), SCREENSHOT);
    console.log('（跳过原售后工作台的抽屉检查）');

    console.log('\n=== 5. 浏览器控制台错误 ===');
    // 已知噪声：站点图标、React DevTools 提示、核心插件（块模板/流程引擎）的状态更新告警
    const NOISE = /favicon|ResizeObserver|Download the React DevTools|Failed to load resource: the server responded with a status of 401|^AxiosError$|Can't perform a React state update on a component that hasn't mounted yet/i;
    const fatalErrors = consoleErrors.filter((item) => !NOISE.test(item));
    check('页面自身无非预期控制台报错', fatalErrors.length === 0, fatalErrors.slice(0, 3).join(' | ') || '无');
    if (consoleErrors.length !== fatalErrors.length) {
      console.log(`   （已忽略 ${consoleErrors.length - fatalErrors.length} 条核心/登录期噪声）`);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n汇总：断言 ${results.length - failed.length}/${results.length} 通过${
      failed.length ? `，失败：${failed.map((item) => item.name).join('；')}` : ''
    }`,
  );
  console.log(`截图：${SCREENSHOT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n页面检查中断：${error.message}`);
  process.exit(1);
});
