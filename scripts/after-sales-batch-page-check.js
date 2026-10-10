#!/usr/bin/env node
/**
 * 售后批处理工作台 —— 页面渲染检查（真实浏览器）
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
const SCREENSHOT = argValue('screenshot', `/tmp/after-sales-batch-page-${CLIENT}.png`);
// v1 客户端挂在 /admin 下；v2（modern）客户端前缀由 APP_MODERN_CLIENT_PREFIX 决定，默认 /v
const MODERN_PREFIX = process.env.APP_MODERN_CLIENT_PREFIX || argValue('modern-prefix', 'v');
const ROUTE =
  CLIENT === 'v1'
    ? '/admin/after-sales/batch-workbench'
    : `/${MODERN_PREFIX.replace(/^\/+|\/+$/g, '')}/after-sales/batch-workbench`;
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
      const hasTitle = await page.getByText('售后批处理工作台', { exact: false }).count();
      if (hasTitle > 0) {
        break;
      }
      await page.waitForTimeout(2000);
    }

    const titleCount = await page.getByText('售后批处理工作台', { exact: false }).count();
    check('页面标题渲染（售后批处理工作台）', titleCount > 0, `命中 ${titleCount} 处`);

    for (const [label, text] of [
      ['批次进度卡片', '批次进度'],
      ['售后工单卡片', '售后工单'],
      ['进度四项-待处理总数', '待处理总数'],
      ['进度四项-已完成', '已完成'],
      ['进度四项-未完成', '未完成'],
      ['进度四项-生成失败', '生成失败'],
      ['开始批处理按钮', '开始批处理'],
      ['新建工单按钮', '新建工单'],
      ['导入文件按钮', '导入文件'],
    ]) {
      const count = await page.getByText(text, { exact: false }).count();
      check(label, count > 0, `命中 ${count} 处`);
    }

    const statsText = (await page.locator('.ant-statistic').allInnerTexts()).join(' | ');
    const totalMatch = statsText.match(/待处理总数\s*(\d+)/);
    check(
      '刷新后回显最近批次的进度四项（待处理总数 ≥ 1）',
      Boolean(totalMatch) && Number(totalMatch[1]) >= 1,
      statsText.slice(0, 120),
    );
    const batchSerialVisible = await page.getByText('ASGB-', { exact: false }).count();
    check('页面可见批次号（ASGB-）', batchSerialVisible > 0, `命中 ${batchSerialVisible} 处`);

    console.log('\n=== 3. 工单列表数据 ===');
    const tableRows = await page.locator('.ant-table-tbody tr.ant-table-row').count();
    check('工单表格已渲染数据行', tableRows > 0, `${tableRows} 行`);
    const serialVisible = await page.getByText('ASWO-', { exact: false }).count();
    check('表格可见工单序列号（ASWO-）', serialVisible > 0, `命中 ${serialVisible} 处`);
    const guideSerialVisible = await page.getByText('ASG-', { exact: false }).count();
    check('表格可见指南序列号（ASG-，说明已生成过）', guideSerialVisible > 0, `命中 ${guideSerialVisible} 处`);

    console.log('\n=== 4. 指南详情抽屉 ===');
    const viewGuideButton = page.getByRole('button', { name: '查看指南' }).first();
    if (await viewGuideButton.count()) {
      await viewGuideButton.click();
      await page.waitForTimeout(4000);
      const drawerFields = [
        '买卖双方历史沟通总结',
        '卖家回信正文参考',
        '审核状态',
        '实际发送的卖家回信正文',
        '邮件历史 CSV',
      ];
      for (const field of drawerFields) {
        const count = await page.getByText(field, { exact: false }).count();
        check(`抽屉字段：${field}`, count > 0, `命中 ${count} 处`);
      }
      await page.screenshot({ path: SCREENSHOT, fullPage: true });
      check('已截图留档', fs.existsSync(SCREENSHOT), SCREENSHOT);
    } else {
      check('存在可查看的指南（用于抽屉检查）', false, '当前列表没有已生成指南的工单');
      await page.screenshot({ path: SCREENSHOT, fullPage: true });
    }

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
