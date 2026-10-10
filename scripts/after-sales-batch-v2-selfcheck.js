#!/usr/bin/env node
/**
 * 售后批处理（阶段二）链路自检脚本 —— 通过 NocoBase 的 afterSalesBatch actions 跑完整条链路
 *
 * 覆盖链路：登录 → 回信抬头候选 → 建单 → 列表 → 触发前检查 → 触发批次（连接器后台编排）
 *          → 轮询进度四项 → 取指南（6 个 AI 字段）→ 人工审核 + 回填实际回信 → 核查文件下载 → 清理
 *
 * 与旧脚本的区别：旧脚本针对生产连接器与旧表（数字主键 + NocoBase 侧 AI 员工问答式生成）只做只读校验；
 * 本脚本针对阶段二 V2 接口（work_order_serial 主键、连接器侧编排 + Dify 生成），会真实建单/生成/审核，
 * 默认结束后清理自己创建的工单（--keep 可保留用于页面上人工查看）。
 *
 * 用法：
 *   node scripts/after-sales-batch-v2-selfcheck.js
 *   node scripts/after-sales-batch-v2-selfcheck.js --order-id=113-9233930-0206620 --keep
 *   node scripts/after-sales-batch-v2-selfcheck.js --email-only=xxx@marketplace.amazon.com
 *
 * 环境变量：
 *   NOCOBASE_BASE_URL   默认 http://127.0.0.1:13000
 *   NOCOBASE_USERNAME   默认取仓库 .env 的 INIT_ROOT_USERNAME
 *   NOCOBASE_PASSWORD   默认取仓库 .env 的 INIT_ROOT_PASSWORD
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 1) 参数与环境
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const hit = args.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

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
const ORDER_ID = argValue('order-id', '113-9233930-0206620');
const EMAIL_ONLY = argValue('email-only');
const KEEP = hasFlag('keep');
const POLL_TIMEOUT_MS = Number(argValue('timeout-ms', '600000'));
const POLL_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// 2) 断言与输出
// ---------------------------------------------------------------------------

const results = [];
let token = '';

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    const error = new Error(`断言失败：${name}`);
    error.assertion = true;
    throw error;
  }
}

function step(title) {
  console.log(`\n=== ${title} ===`);
}

/** 调用 NocoBase 的 afterSalesBatch action（resource action 统一走 POST） */
async function action(name, data = {}) {
  const response = await fetch(`${BASE_URL}/api/afterSalesBatch:${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`action ${name} 返回非 JSON（${response.status}）：${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message || payload?.message || `HTTP ${response.status}`;
    const error = new Error(`action ${name} 失败：${message}`);
    error.status = response.status;
    throw error;
  }
  return payload?.data ?? payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 3) 主流程
// ---------------------------------------------------------------------------

async function main() {
  console.log(`NocoBase: ${BASE_URL} | 登录用户: ${USERNAME}`);
  if (!PASSWORD) {
    throw new Error('未取到登录密码：请在 .env 设置 INIT_ROOT_PASSWORD，或用 NOCOBASE_PASSWORD 指定');
  }

  step('0. 登录');
  const loginResponse = await fetch(`${BASE_URL}/api/auth:signIn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: USERNAME, password: PASSWORD }),
  });
  const loginPayload = await loginResponse.json().catch(() => ({}));
  token = loginPayload?.data?.token || '';
  check('登录成功并取到 token', Boolean(token));

  let workOrderSerial = '';

  try {
    step('1. 回信抬头候选');
    const greetings = await action('listReplyGreetings');
    const greetingValues = (greetings.records || []).map((item) => item.greeting);
    check('候选项来自连接器且非空', greetingValues.length > 0, `候选项：${greetingValues.join('、')}`);

    step('2. 建单');
    const record = EMAIL_ONLY
      ? { buyer_email: EMAIL_ONLY, reply_greeting: greetingValues[0] || 'Hi' }
      : {
          order_id: ORDER_ID,
          reply_greeting: greetingValues[1] || greetingValues[0] || 'Hi',
          tone_and_language: '英文，礼貌专业',
        };
    const created = await action('createWorkOrders', { records: [record] });
    workOrderSerial = created.records?.[0]?.work_order_serial || '';
    check('建单返回序列号', Boolean(workOrderSerial), workOrderSerial);
    check(
      '深度默认 表A=3 / 表B=1',
      created.records?.[0]?.table_a_depth === 3 && created.records?.[0]?.table_b_depth === 1,
      `表A=${created.records?.[0]?.table_a_depth} 表B=${created.records?.[0]?.table_b_depth}`,
    );

    step('3. 列表查询');
    const listed = await action('listWorkOrders', { page: 1, pageSize: 10, keyword: workOrderSerial });
    check('关键字命中刚建的工单', Number(listed.total) === 1, `total=${listed.total}`);

    step('4. 触发前检查');
    const inspected = await action('inspectWorkOrders', { work_order_serials: [workOrderSerial] });
    check(
      '提示动作 = generate',
      inspected.records?.[0]?.suggested_action === 'generate',
      JSON.stringify(inspected.records?.[0]?.suggested_action),
    );

    step('5. 触发批次（连接器后台编排 + Dify 生成）');
    const startedAt = Date.now();
    const started = await action('startGuideBatch', { work_order_serials: [workOrderSerial] });
    const batchSerial = started.batch?.batch_serial || '';
    check(
      '批次已创建并接受执行',
      Boolean(batchSerial) && started.accepted !== false,
      `${batchSerial}${started.reason ? `（${started.reason}）` : ''}`,
    );

    step('6. 轮询批次进度四项');
    let batch = started.batch;
    let attempts = 0;
    while (batch?.status === 'running' && Date.now() - startedAt < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      attempts += 1;
      const polled = await action('getGuideBatch', { batch_serial: batchSerial });
      batch = polled.batch;
      process.stdout.write(
        `\r   进度：总数 ${batch.total_count} / 已完成 ${batch.done_count} / 未完成 ${batch.pending_count} / 失败 ${batch.failed_count} / 已去除 ${batch.skipped_count}   `,
      );
    }
    console.log('');
    check('批次已跑完（状态非 running）', batch?.status !== 'running', `状态=${batch?.status} 轮询 ${attempts} 次`);
    check(
      '进度四项收敛：已完成 1、失败 0',
      Number(batch.done_count) === 1 && Number(batch.failed_count) === 0 && Number(batch.pending_count) === 0,
      `总数 ${batch.total_count} / 已完成 ${batch.done_count} / 未完成 ${batch.pending_count} / 失败 ${batch.failed_count}`,
    );
    if (Number(batch.failed_count) > 0) {
      console.log(`   失败明细：${JSON.stringify(batch.failure_detail)}`);
    }

    step('7. 取指南并校验文档 20 字段口径');
    const guideResponse = await action('getGuide', {
      guide_serial: (await action('listWorkOrders', { keyword: workOrderSerial })).records[0].guide_serial,
    });
    const guide = guideResponse.guide;
    const aiFields = [
      'communication_history_summary',
      'current_email_summary',
      'buyer_other_info',
      'seller_reply_draft',
      'seller_action_guide',
      'reasoning_explanation',
    ];
    check('工单已反向绑定指南序列号', guide.work_order_serial === workOrderSerial, guide.guide_serial);
    check(
      '②③④ 来自表 A 锚点行',
      Boolean(guide.store_name && guide.order_id && guide.buyer_email),
      `店铺=${guide.store_name} 订单=${guide.order_id}`,
    );
    check(
      '⑤⑥⑦ 锚点行回填',
      Boolean(guide.buyer_email_body) && Boolean(guide.buyer_email_time) && Boolean(guide.mail_record_id),
      `邮件记录=${guide.mail_record_id} 正文 ${String(guide.buyer_email_body || '').length} 字`,
    );
    check(
      '⑧～⑬ 六个 AI 字段齐备',
      aiFields.every((field) => String(guide[field] || '').trim().length > 0),
      aiFields.map((field) => `${field}=${String(guide[field] || '').length}`).join(' '),
    );
    check('⑱ 审核状态初始为空', guide.review_status === null, String(guide.review_status));

    step('8. 人工审核 + 回填实际回信（⑮⑯⑱）');
    const stamp = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const replyTime = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(
      stamp.getHours(),
    )}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
    const updated = await action('updateGuide', {
      guide_serial: guide.guide_serial,
      values: { review_status: '已审核', actual_seller_reply_body: '（自检脚本回填）', seller_reply_time: replyTime },
    });
    check('审核状态已置为已审核', updated.guide?.review_status === '已审核');
    check(
      '实际回信与时间已回填',
      updated.guide?.actual_seller_reply_body === '（自检脚本回填）' && Boolean(updated.guide?.seller_reply_time),
      String(updated.guide?.seller_reply_time),
    );
    check('AI 字段未被整行覆盖（⑧ 仍在）', String(updated.guide?.communication_history_summary || '').length > 0);

    step('9. 核查文件下载');
    for (const [label, url] of [
      ['邮件历史 CSV', guide.email_history_csv_url],
      ['实时快递详情 TXT', guide.realtime_express_txt_url],
    ]) {
      if (!url) {
        check(`${label} 链接已写入`, false, '链接为空');
        continue;
      }
      const download = await fetch(url);
      const content = await download.text();
      check(
        `${label} 可下载且非空`,
        download.status === 200 && content.length > 20,
        `${download.status} ${content.length} 字节 ${download.headers.get('content-type')}`,
      );
    }

    step('10. 已有指南时的"去除 / 重新生成"提示');
    const recheck = await action('inspectWorkOrders', { work_order_serials: [workOrderSerial] });
    check(
      '再次触发会提示 skip_or_regenerate',
      recheck.records?.[0]?.suggested_action === 'skip_or_regenerate',
      JSON.stringify(recheck.records?.[0]?.suggested_action),
    );

    step('11. 清理');
    if (KEEP) {
      console.log(`   已按 --keep 保留工单：${workOrderSerial}（可在页面上查看）`);
      console.log(`   页面地址：${BASE_URL}/admin/after-sales/batch-workbench（v2 客户端：${BASE_URL}/v2/）`);
    } else {
      const deleted = await action('deleteWorkOrders', { work_order_serials: [workOrderSerial] });
      check(
        '自检工单已删除且指南已解绑',
        Number(deleted.deletedCount) === 1 && Number(deleted.unboundCount) === 1,
        `删除 ${deleted.deletedCount} 条 / 解绑 ${deleted.unboundCount} 条`,
      );
      workOrderSerial = '';
    }
  } finally {
    if (workOrderSerial && !KEEP) {
      try {
        await action('deleteWorkOrders', { work_order_serials: [workOrderSerial] });
        console.log(`   （异常清理）已删除自检工单 ${workOrderSerial}`);
      } catch (error) {
        console.log(`   （异常清理失败，请手工删除工单 ${workOrderSerial}）${error.message}`);
      }
    }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n汇总：断言 ${results.length - failed.length}/${results.length} 通过${
      failed.length ? `，失败：${failed.map((item) => item.name).join('；')}` : ''
    }`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n自检中断：${error.message}`);
  const failed = results.filter((item) => !item.ok);
  if (results.length) {
    console.log(`已通过断言 ${results.length - failed.length}/${results.length}`);
  }
  process.exit(1);
});
