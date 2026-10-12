/**
 * 售后处理指南 A/B 双页面渲染检查（真实浏览器）
 *
 * 目的：验证"本地生成（A）"与"Dify 生成（B）"两个页面都能打开、且各自渲染的是正确的版本，
 *       不会互相串页。两页分别调 afterSalesBatchLocal / afterSalesBatch 两个独立资源。
 *
 * 用法：
 *   node scripts/after-sales-guide-ab-check.js
 *   node scripts/after-sales-guide-ab-check.js --base-url=http://127.0.0.1:13000
 *   node scripts/after-sales-guide-ab-check.js --screenshot-dir=/tmp
 *
 * 环境变量：NOCOBASE_BASE_URL / NOCOBASE_USERNAME / NOCOBASE_PASSWORD
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const hit = args.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function readEnvFile() {
  const file = path.resolve(__dirname, '../.env');
  const result = {};
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return result;
}

const envFile = readEnvFile();
const BASE_URL = (argValue('base-url') || process.env.NOCOBASE_BASE_URL || 'http://127.0.0.1:13000').replace(/\/$/, '');
const USERNAME = process.env.NOCOBASE_USERNAME || envFile.INIT_ROOT_USERNAME || 'nocobase';
const PASSWORD = process.env.NOCOBASE_PASSWORD || envFile.INIT_ROOT_PASSWORD || '';
const SHOT_DIR = argValue('screenshot-dir', '/tmp');

// A 页（本地生成）独有文案；B 页（Dify）独有文案。用来确认没有串页。
const PAGE_A = {
  key: 'A',
  route: '/admin/after-sales/batch-workbench',
  label: 'AI 售后处理指南 A（本地生成）',
  mustHave: ['AI 员工', '回答时限'],
  mustNotHave: ['批次序列号'],
};
const PAGE_B = {
  key: 'B',
  route: '/admin/after-sales/batch-workbench-b',
  label: 'AI 售后处理指南 B（Dify 生成）',
  mustHave: ['批次号', '批次进度'],
  mustNotHave: ['回答守卫', 'AI 员工'],
};

function resolveChromium() {
  const explicit = argValue('executable-path') || process.env.PLAYWRIGHT_CHROMIUM_PATH || '';
  if (explicit && fs.existsSync(explicit)) return explicit;
  const cacheRoot = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cacheRoot)) return undefined;
  const candidates = [];
  for (const entry of fs.readdirSync(cacheRoot)) {
    if (!entry.startsWith('chromium-')) continue;
    for (const relative of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const full = path.join(cacheRoot, entry, relative);
      if (fs.existsSync(full)) candidates.push(full);
    }
  }
  return candidates.sort().pop();
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function countText(page, text) {
  return page.getByText(text, { exact: false }).count();
}

async function checkPage(page, spec) {
  console.log(`\n【${spec.label}】${spec.route}`);
  await page.goto(`${BASE_URL}${spec.route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(6000);

  check(`${spec.key} 页路由可打开（未跳回登录）`, !page.url().includes('signin'), page.url());

  for (const text of spec.mustHave) {
    check(`${spec.key} 页含独有标识「${text}」`, (await countText(page, text)) > 0);
  }
  for (const text of spec.mustNotHave) {
    check(`${spec.key} 页不含另一版本标识「${text}」`, (await countText(page, text)) === 0);
  }

  const errors = await page.locator('.ant-alert-error, .ant-message-error').count();
  check(`${spec.key} 页无错误提示`, errors === 0, errors ? `${errors} 处` : '');

  const shot = path.join(SHOT_DIR, `after-sales-guide-${spec.key}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`   📷 截图：${shot}`);
}

async function main() {
  if (!PASSWORD) {
    console.error('缺少密码：请在 .env 配置 INIT_ROOT_PASSWORD，或设置 NOCOBASE_PASSWORD');
    process.exitCode = 1;
    return;
  }
  const { chromium } = require('playwright');
  const executablePath = resolveChromium();
  console.log(`NocoBase ${BASE_URL} | 用户 ${USERNAME}${executablePath ? '' : ' | 使用默认浏览器'}`);

  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  try {
    // 登录：显式等待表单出现，按 placeholder 定位，并等待真正跳离 signin。
    await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('input[type="password"]', { timeout: 60000 });
    await page.locator('input[placeholder="用户名/邮箱"], input[placeholder*="用户名"]').first().fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button:has-text("登录"), button:has-text("Sign in")').first().click();
    try {
      await page.waitForURL((url) => !url.pathname.includes('signin'), { timeout: 60000 });
    } catch (error) {
      // 部分版本会停留原地或要求二次验证；这里不直接失败，交由后续断言暴露。
    }
    await page.waitForTimeout(4000);
    console.log(`登录后地址：${page.url()}`);
    if (page.url().includes('signin')) {
      const tip = await page.locator('.ant-form-item-explain-error, .ant-message').allInnerTexts();
      console.log(`   登录仍在 signin 页${tip.length ? `，提示：${tip.join(' / ').slice(0, 120)}` : ''}`);
    }

    await checkPage(page, PAGE_A);
    await checkPage(page, PAGE_B);
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    failed.forEach((item) => console.log(`  ❌ ${item.name} ${item.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`检查失败: ${error.message}`);
  process.exitCode = 1;
});
