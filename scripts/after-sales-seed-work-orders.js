#!/usr/bin/env node
/**
 * 批处理工作台种子脚本：向生产 connector 写入真实售后工单（AfterSalesWorkOrder）。
 *
 * 用途：给 /admin/after-sales/batch-workbench 准备可被选择、可跑批处理的工单数据。
 *
 * 用法：
 *   node scripts/after-sales-seed-work-orders.js                 # 用内置 10 个真实订单号
 *   node scripts/after-sales-seed-work-orders.js O1 O2 O3 ...     # 指定订单号
 *   node scripts/after-sales-seed-work-orders.js --dry-run       # 只预览，不写入
 *   node scripts/after-sales-seed-work-orders.js --greeting=Hi   # 指定回信抬头（默认 Dear Buyer）
 *
 * 说明：
 *   - 订单号必须真实存在于 Email4Final（否则批处理时拉不到邮件、会标记 failed）。
 *   - 每条工单创建为 pending / has_ai_guide=否，便于直接选中跑批处理。
 *   - 自动从 Email4Final 回填买家邮箱。
 *   - 同一个 order_id 允许重复创建：不同时间的顾客新回复算新的工单，不做去重。
 *
 * 环境变量：AFTER_SALES_CONNECTOR_BASE_URL（默认 http://120.79.239.166:3000）
 */

'use strict';

const CONNECTOR_BASE_URL = (process.env.AFTER_SALES_CONNECTOR_BASE_URL || 'http://120.79.239.166:3000').replace(
  /\/$/,
  '',
);
const CONNECTOR_TOKEN = process.env.AFTER_SALES_BATCH_TOKEN || '';

// 内置真实 Email4Final 买家订单号（已验证存在、email_source=买家）
const DEFAULT_ORDER_IDS = [
  '112-8258279-9010605',
  '113-4466437-9349007',
  '114-0169692-8724233',
  '111-8412999-5301852',
  '114-7686605-0340262',
  '113-6955691-4080209',
  '113-5811571-3618644',
  '111-4586558-0664212',
  '114-1590955-3928221',
  '111-4999778-1297807',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const greetingArg = args.find((a) => a.startsWith('--greeting='));
const replyGreeting = greetingArg ? greetingArg.split('=')[1] : 'Dear Buyer';
const orderIds = args.filter((a) => !a.startsWith('--'));
const targets = (orderIds.length ? orderIds : DEFAULT_ORDER_IDS).slice(0, 100);

async function connectorGet(path, query = {}) {
  const url = new URL(`${CONNECTOR_BASE_URL}/ai${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: CONNECTOR_TOKEN ? { 'x-after-sales-batch-token': CONNECTOR_TOKEN } : {},
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`connector 返回非 JSON (${res.status}) ${url.pathname}`);
    }
  }
  if (!res.ok || data.success === false)
    throw new Error(`list 失败 (${res.status}) ${url.pathname}: ${data.message || ''}`);
  return data;
}

async function connectorPost(path, body) {
  const res = await fetch(`${CONNECTOR_BASE_URL}/ai${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CONNECTOR_TOKEN ? { 'x-after-sales-batch-token': CONNECTOR_TOKEN } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`connector 返回非 JSON (${res.status}) ${path}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok || data.success === false) throw new Error(`创建失败 (${res.status}) ${path}: ${data.message || ''}`);
  return data;
}

async function getBuyerEmail(orderId) {
  const data = await connectorGet('/tracking-email', { orderId });
  const records = data.records || [];
  const buyer = records.find((r) => r.email_source === '买家') || records[0];
  return (buyer && (buyer.customer_email || buyer.sender_email || '')) || null;
}

async function main() {
  console.log(`connector=${CONNECTOR_BASE_URL}  greeting=${replyGreeting}  dryRun=${dryRun}`);
  console.log(`目标订单数：${targets.length}\n`);

  let created = 0;
  let failed = 0;

  for (const orderId of targets) {
    try {
      const buyerEmail = await getBuyerEmail(orderId);
      if (dryRun) {
        console.log(`[DRY] ${orderId}  buyer_email=${buyerEmail || '-'}  greeting=${replyGreeting}`);
        created += 1;
        continue;
      }
      const resp = await connectorPost('/after-sales/work-orders', {
        records: [
          {
            order_id: orderId,
            buyer_email: buyerEmail,
            reply_greeting: replyGreeting,
            additional_context: '[166 真机测试种子]',
          },
        ],
      });
      const record = (resp.records || [])[0] || {};
      console.log(`[OK]  ${orderId}  workOrderId=${record.id}  buyer_email=${buyerEmail || '-'}`);
      created += 1;
    } catch (error) {
      console.log(`[FAIL] ${orderId}  ${error.message}`);
      failed += 1;
    }
  }

  console.log(`\n完成：created=${created} failed=${failed}`);
  if (dryRun) console.log('（--dry-run 预览，未写入）');
}

main().catch((error) => {
  console.error('种子脚本异常：', error);
  process.exit(1);
});
