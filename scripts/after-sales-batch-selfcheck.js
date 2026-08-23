#!/usr/bin/env node
/**
 * 售后批处理链路自检脚本（只读 + 本地临时表，零生产副作用）
 *
 * 目的：在不动生产库的前提下，验证 @zhoumingrui/plugin-after-sales-batch 的批处理链路是否真的能跑通。
 *
 * 安全边界：
 *   - 对生产 connector 只发起 GET（/ai/tracking-email、/ai/orders/complete），绝不调用任何写接口。
 *   - 所有“入库”都写入本机 SQLite 临时文件（默认 /tmp/after-sales-selfcheck.sqlite），
 *     临时表镜像 AfterSalesWorkOrder / AIAfterSalesGuide / AIAfterSalesGuideContextArtifact 三张表结构。
 *   - AI 默认使用确定性 stub（产出合法指南 JSON），可选 --ai=openai 用真实模型验证产出是否过校验。
 *
 * 用法：
 *   node scripts/after-sales-batch-selfcheck.js [订单号...] [--ai=stub|openai] [--db=/path.sqlite]
 *
 * 示例：
 *   node scripts/after-sales-batch-selfcheck.js 112-8258279-9010605 113-4466437-9349007
 *   node scripts/after-sales-batch-selfcheck.js --ai=openai 114-0169692-8724233
 *
 * 环境变量：
 *   AFTER_SALES_CONNECTOR_BASE_URL  默认 http://120.79.239.166:3000
 *   AFTER_SALES_BATCH_TOKEN         默认空（生产当前未配置）
 *   OPENAI_API_KEY / OPENAI_MODEL   仅 --ai=openai 时需要
 */

'use strict';

const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// 1) 配置
// ---------------------------------------------------------------------------

const CONNECTOR_BASE_URL = (process.env.AFTER_SALES_CONNECTOR_BASE_URL || 'http://120.79.239.166:3000').replace(
  /\/$/,
  '',
);
const CONNECTOR_TOKEN = process.env.AFTER_SALES_BATCH_TOKEN || '';

const args = process.argv.slice(2);
const aiMode = (args.find((a) => a.startsWith('--ai=')) || '--ai=stub').split('=')[1];
const dbPathArg = args.find((a) => a.startsWith('--db='));
const dbPath = dbPathArg ? dbPathArg.split('=')[1] : '/tmp/after-sales-selfcheck.sqlite';
const commitMode = args.includes('--commit');
const orderIds = args.filter((a) => !a.startsWith('--')).slice(0, 5);

// ---------------------------------------------------------------------------
// 2) 忠实复刻的纯逻辑（来源：packages/plugins/@zhoumingrui/plugin-after-sales-batch
//    与 power-automate-connector/routes/ai-gateway/*）
// ---------------------------------------------------------------------------

const GUIDE_FIELDS = Object.freeze([
  'store_name',
  'order_id',
  'buyer_email',
  'buyer_email_body',
  'buyer_email_date_time',
  'communication_history_summary',
  'current_email_core_request',
  'current_issue_factual_summary',
  'case_background_risk_notes',
  'after_sales_issue_type',
  'current_handling_stage',
  'ai_recommended_handling_plan',
  'seller_reply_draft_reference',
  'seller_internal_action_guide',
  'manual_confirmation_required',
  'ai_confidence_level',
  'reasoning_explanation',
]);

const BATCH_SYSTEM_MESSAGE = [
  'You are running inside a background batch job.',
  'Return exactly one valid JSON object and no surrounding Markdown (no ```json fences).',
  'Do not ask follow-up questions or ask the user to fill any table manually.',
  'The system will create the AIAfterSalesGuide record and refresh download snapshots automatically.',
  'When information is missing, write 不确定 or 需人工核实 according to the existing after-sales rules instead of requesting another message.',
  '',
  'The JSON object MUST use EXACTLY the following 17 snake_case fields, in this order, with no other fields and no nested objects or arrays. Every value must be a plain string.',
  '1. store_name - 店铺名称',
  '2. order_id - 订单编号（必须原样返回 Primary input 中的 order_id）',
  '3. buyer_email - 买家邮箱地址',
  '4. buyer_email_body - 买家邮件正文',
  '5. buyer_email_date_time - 买家邮件日期时间',
  '6. communication_history_summary - 买卖双方历史沟通总结',
  '7. current_email_core_request - 当前来信核心诉求',
  '8. current_issue_factual_summary - 当前问题事实摘要',
  '9. case_background_risk_notes - 案件背景及风险提示',
  '10. after_sales_issue_type - 售后问题类型',
  '11. current_handling_stage - 当前处理阶段',
  '12. ai_recommended_handling_plan - AI建议处理方案',
  '13. seller_reply_draft_reference - 卖家回信正文参考',
  '14. seller_internal_action_guide - 卖家附属行动指南及后续建议',
  '15. manual_confirmation_required - 是否需要人工确认，取值只能是 "是" 或 "否"',
  '16. ai_confidence_level - AI置信度，取值只能是 "高"、"中" 或 "低"',
  '17. reasoning_explanation - 原因解释',
].join('\n');

const TRACKING_EMAIL_EXPORT_COLUMNS = Object.freeze([
  'store_name',
  'order_id',
  'sender_email',
  'recipient_email',
  'email_subject',
  'email_embedded_body',
  'received_time',
  'email_source',
  'message_primary_type',
  'message_summary',
  'message_tags',
]);

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function normalizeTextCandidate(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') return [item.text];
        if (typeof item.content === 'string') return [item.content];
      }
      return [];
    });
  }
  if (value && typeof value === 'object') {
    const content = value.content;
    if (typeof content === 'string') return [content];
  }
  return [];
}

function tryParseJson(text) {
  const trimmed = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw error;
  }
}

function extractGuidePayload(result) {
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  if (messages.length > 40) throw new Error('AI answer produced too many messages');
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    for (const candidate of normalizeTextCandidate(messages[index]?.content)) {
      try {
        return tryParseJson(candidate);
      } catch {
        // try next candidate
      }
    }
  }
  throw new Error('AI employee did not return a valid JSON guide payload');
}

function pickLatestBuyerEmailRecord(records) {
  return records.find((record) => record?.email_source === '买家') || records[0] || null;
}

function buildUserMessage(workOrder, emailRecord) {
  const input = {
    store_name: String(emailRecord?.store_name || ''),
    order_id: String(workOrder.order_id || ''),
    buyer_email: String(workOrder.buyer_email || emailRecord?.customer_email || emailRecord?.sender_email || ''),
    buyer_email_body: String(emailRecord?.email_embedded_body || ''),
    buyer_email_date_time: formatDateTime(emailRecord?.received_time),
  };
  const batchHints = {
    buyer_issue_type: workOrder.buyer_issue_type || '',
    additional_context: workOrder.additional_context || '',
    tone_and_language_requirement: workOrder.tone_and_language_requirement || '',
    reply_preference: workOrder.reply_preference || '',
    email_length: workOrder.email_length || '',
    reply_greeting: workOrder.reply_greeting || '',
    standard_case_template_path: workOrder.standard_case_template_path || '',
    email4final_depth: workOrder.email4final_depth || 3,
    ai_after_sales_guide_depth: workOrder.ai_after_sales_guide_depth || 1,
  };
  return [
    'Please generate one AIAfterSalesGuide JSON record for this work order.',
    'Primary input:',
    JSON.stringify(input, null, 2),
    'Batch hints:',
    JSON.stringify(batchHints, null, 2),
  ].join('\n');
}

function normalizeText(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

// 复刻 connector 的指南校验（createAfterSalesGuide 前置 normalizeGuidePayload）
function normalizeGuidePayload(input) {
  const normalized = {};
  for (const field of GUIDE_FIELDS) {
    const maxLength = field === 'manual_confirmation_required' || field === 'ai_confidence_level' ? 10 : 0;
    normalized[field] = normalizeText(input?.[field], maxLength);
  }
  if (!normalized.order_id) {
    const error = new Error('order_id 不能为空');
    error.code = 'INVALID_AFTER_SALES_GUIDE_ORDER_ID';
    throw error;
  }
  if (!normalized.manual_confirmation_required || !['是', '否'].includes(normalized.manual_confirmation_required)) {
    const error = new Error('manual_confirmation_required 仅允许 是 或 否');
    error.code = 'INVALID_AFTER_SALES_GUIDE_MANUAL_CONFIRMATION';
    throw error;
  }
  if (!normalized.ai_confidence_level || !['高', '中', '低'].includes(normalized.ai_confidence_level)) {
    const error = new Error('ai_confidence_level 仅允许 高、中、低');
    error.code = 'INVALID_AFTER_SALES_GUIDE_CONFIDENCE';
    throw error;
  }
  return normalized;
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(row[c])).join(','));
  return [header, ...body].join('\n');
}

function sanitizeFileNameSegment(value, fallback = 'context') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return sanitized || fallback;
}

function buildEmailHistoryArtifactContent(records) {
  return buildCsv(records, TRACKING_EMAIL_EXPORT_COLUMNS);
}

function buildRealtimeExpressArtifactContent(orderId, result) {
  return [
    `order_id: ${orderId}`,
    `source_table: ${result.tableName || ''}`,
    `record_count: ${result.records.length}`,
    `generated_at: ${new Date().toISOString()}`,
    '',
    'records:',
    JSON.stringify(result.records, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 3) 生产 connector 的只读 HTTP 访问
// ---------------------------------------------------------------------------

async function connectorGet(path, query = {}) {
  const url = new URL(`${CONNECTOR_BASE_URL}/ai${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: CONNECTOR_TOKEN ? { 'x-after-sales-batch-token': CONNECTOR_TOKEN } : {},
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`connector 返回非 JSON (${res.status}) ${url.pathname}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok || data.success === false) {
    throw new Error(`connector 请求失败 (${res.status}) ${url.pathname}: ${data.message || 'unknown'}`);
  }
  return data;
}

async function connectorPost(path, body) {
  const url = `${CONNECTOR_BASE_URL}/ai${path}`;
  const res = await fetch(url, {
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
      throw new Error(`connector 返回非 JSON (${res.status}) ${url.pathname}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok || data.success === false) {
    throw new Error(`connector 请求失败 (${res.status}) ${url.pathname}: ${data.message || 'unknown'}`);
  }
  return data;
}

async function queryTrackingEmailByOrderId(orderId) {
  const data = await connectorGet('/tracking-email', { orderId });
  return data.records || [];
}

async function queryCompleteOrderByOrderId(orderId) {
  const data = await connectorGet('/orders/complete', { orderId });
  return { tableName: data.tableName || null, records: data.records || [] };
}

// ---------------------------------------------------------------------------
// 4) AI 后端：stub（确定性合法 JSON）与 openai（可选，仅验证真实产出）
// ---------------------------------------------------------------------------

function stubInvoke(workOrder, emailRecord) {
  const content = JSON.stringify({
    store_name: emailRecord?.store_name || '',
    order_id: workOrder.order_id || '',
    buyer_email: workOrder.buyer_email || emailRecord?.customer_email || '',
    buyer_email_body: emailRecord?.email_embedded_body || '',
    buyer_email_date_time: formatDateTime(emailRecord?.received_time),
    communication_history_summary: '(stub) 基于该订单历史邮件的总结',
    current_email_core_request: emailRecord?.message_summary || '(stub) 买家诉求',
    current_issue_factual_summary: '(stub) 事实摘要',
    case_background_risk_notes: '(stub) 背景与风险',
    after_sales_issue_type: emailRecord?.message_primary_type || '(stub) 售后问题类型',
    current_handling_stage: '待处理',
    ai_recommended_handling_plan: '(stub) 建议处理方案',
    seller_reply_draft_reference: '(stub) 卖家回信参考',
    seller_internal_action_guide: '(stub) 内部行动指南',
    manual_confirmation_required: '否',
    ai_confidence_level: '高',
    reasoning_explanation: '(stub) 原因解释',
  });
  return { messages: [{ role: 'assistant', content: { type: 'text', content } }] };
}

async function openaiInvoke(workOrder, emailRecord) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY 环境变量');
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';
  const userContent = buildUserMessage(workOrder, emailRecord);

  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: BATCH_SYSTEM_MESSAGE },
      { role: 'user', content: userContent },
    ],
  });

  const data = await new Promise((resolve, reject) => {
    const https = require('https');
    let agent;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxyUrl) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        agent = new HttpsProxyAgent(proxyUrl);
      } catch {
        // 直连
      }
    }
    const req = https.request(
      {
        host: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        ...(agent ? { agent } : {}),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          // 不能逐块 body += chunk：UTF-8 多字节字符可能被 TCP 分片切断，
          // 逐块 toString 会产生 U+FFFD（�）。累积 Buffer 后一次性解码。
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`OpenAI 返回非 JSON (${res.statusCode}): ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });

  if (data.error) throw new Error(`OpenAI 调用失败: ${data.error.message || JSON.stringify(data.error)}`);
  const content = data?.choices?.[0]?.message?.content || '';
  return { messages: [{ role: 'assistant', content: { type: 'text', content } }] };
}

// ---------------------------------------------------------------------------
// 5) SQLite 临时表（镜像三张生产表的核心列）
// ---------------------------------------------------------------------------

function initTempDb(path) {
  const db = new DatabaseSync(path);
  db.exec('DROP TABLE IF EXISTS AfterSalesWorkOrder_test');
  db.exec('DROP TABLE IF EXISTS AIAfterSalesGuide_test');
  db.exec('DROP TABLE IF EXISTS AIAfterSalesGuideContextArtifact_test');
  db.exec(`
    CREATE TABLE AfterSalesWorkOrder_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      buyer_email TEXT,
      email4final_depth INTEGER NOT NULL DEFAULT 3,
      ai_after_sales_guide_depth INTEGER NOT NULL DEFAULT 1,
      buyer_issue_type TEXT,
      additional_context TEXT,
      tone_and_language_requirement TEXT,
      reply_preference TEXT,
      email_length TEXT,
      reply_greeting TEXT NOT NULL,
      standard_case_template_path TEXT,
      has_ai_guide TEXT NOT NULL DEFAULT '否',
      ai_guide_id INTEGER,
      ai_guide_generated_at TEXT,
      processing_status TEXT NOT NULL DEFAULT 'pending',
      processing_error TEXT,
      last_task_id TEXT,
      last_processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE AIAfterSalesGuide_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT, order_id TEXT, buyer_email TEXT, buyer_email_body TEXT,
      buyer_email_date_time TEXT, communication_history_summary TEXT,
      current_email_core_request TEXT, current_issue_factual_summary TEXT,
      case_background_risk_notes TEXT, after_sales_issue_type TEXT,
      current_handling_stage TEXT, ai_recommended_handling_plan TEXT,
      seller_reply_draft_reference TEXT, seller_internal_action_guide TEXT,
      manual_confirmation_required TEXT, ai_confidence_level TEXT,
      reasoning_explanation TEXT,
      created_time TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE AIAfterSalesGuideContextArtifact_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ai_after_sales_guide_id INTEGER NOT NULL,
      artifact_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content_text TEXT NOT NULL,
      created_time TEXT NOT NULL DEFAULT (datetime('now')),
      updated_time TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

// ---------------------------------------------------------------------------
// 6) 主流程（复刻 AfterSalesGuideBatchTask.execute，写入临时表）
// ---------------------------------------------------------------------------

async function runOneOrder(db, orderId, index) {
  const report = { orderId, steps: [], ok: true };
  const mark = (name, ok, detail = '') => {
    report.steps.push({ name, ok, detail });
    if (!ok) report.ok = false;
  };

  const replyGreeting = 'Dear Buyer';
  const baseWorkOrder = {
    order_id: orderId,
    buyer_email: null,
    email4final_depth: 3,
    ai_after_sales_guide_depth: 1,
    buyer_issue_type: null,
    additional_context: '[真机自检测试]',
    tone_and_language_requirement: null,
    reply_preference: null,
    email_length: null,
    reply_greeting: replyGreeting,
    standard_case_template_path: null,
    has_ai_guide: '否',
    processing_status: 'pending',
  };

  // 6.1 构造/创建工单
  let workOrder = baseWorkOrder;
  if (commitMode) {
    const created = await connectorPost('/after-sales/work-orders', { records: [baseWorkOrder] });
    const createdRecord = (created.records || [])[0] || {};
    workOrder = { ...baseWorkOrder, id: Number(createdRecord.id), ...createdRecord };
    mark('创建真实工单', !!workOrder.id, `workOrderId=${workOrder.id}, order_id=${orderId}`);
    if (!workOrder.id) throw new Error('创建工单失败，未返回 id');
  } else {
    workOrder = { ...baseWorkOrder, id: 1000 + index };
    db.prepare(
      `INSERT INTO AfterSalesWorkOrder_test (order_id, buyer_email, email4final_depth, ai_after_sales_guide_depth, reply_greeting, has_ai_guide, processing_status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      workOrder.order_id,
      workOrder.buyer_email,
      workOrder.email4final_depth,
      workOrder.ai_after_sales_guide_depth,
      workOrder.reply_greeting,
      workOrder.has_ai_guide,
      workOrder.processing_status,
    );
    mark('构造临时工单', true, `order_id=${orderId}, reply_greeting=${replyGreeting}`);
  }

  try {
    // 6.2 拉取 Email4Final（只读 GET）
    const trackingRecords = await queryTrackingEmailByOrderId(orderId);
    mark('拉取 Email4Final', trackingRecords.length > 0, `命中 ${trackingRecords.length} 条邮件`);
    if (!trackingRecords.length) throw new Error(`No Email4Final record found for order ${orderId}`);

    // 6.3 挑选最新买家邮件
    const emailRecord = pickLatestBuyerEmailRecord(trackingRecords);
    mark(
      '挑选买家邮件',
      !!emailRecord,
      emailRecord ? `email_source=${emailRecord.email_source}` : '未找到 email_source=买家',
    );
    if (!emailRecord) throw new Error(`No Email4Final record found for order ${orderId}`);

    // 6.4 组装 prompt
    const prompt = buildUserMessage(workOrder, emailRecord);
    mark('组装 prompt', prompt.length > 0, `prompt 长度 ${prompt.length}`);

    // 6.5 AI 调用
    const invokeResult =
      aiMode === 'openai' ? await openaiInvoke(workOrder, emailRecord) : stubInvoke(workOrder, emailRecord);

    // 6.6 解析 AI 输出
    let guidePayload;
    try {
      guidePayload = extractGuidePayload(invokeResult);
      mark('解析 AI JSON', true, '');
    } catch (error) {
      mark('解析 AI JSON', false, error.message);
      throw error;
    }

    // 6.7 指南校验（复刻 connector normalizeGuidePayload）
    let normalized;
    try {
      normalized = normalizeGuidePayload(guidePayload);
      mark(
        '指南字段校验',
        true,
        `manual_confirmation_required=${normalized.manual_confirmation_required}, ai_confidence_level=${normalized.ai_confidence_level}`,
      );
    } catch (error) {
      mark('指南字段校验', false, `${error.code}: ${error.message}`);
      throw error;
    }

    // 6.8 写指南
    let guideId;
    if (commitMode) {
      const guideResp = await connectorPost('/after-sales/guides', normalized);
      guideId = Number(guideResp?.record?.id);
      mark('写 AIAfterSalesGuide(真实)', guideId > 0, `guideId=${guideId}`);
      if (!guideId) throw new Error('Failed to create AIAfterSalesGuide record');
    } else {
      const guideCols = GUIDE_FIELDS.map((f) => `"${f}"`).join(', ');
      const guidePlaceholders = GUIDE_FIELDS.map(() => '?').join(', ');
      const guideValues = GUIDE_FIELDS.map((f) => normalized[f]);
      const guideResult = db
        .prepare(`INSERT INTO AIAfterSalesGuide_test (${guideCols}) VALUES (${guidePlaceholders})`)
        .run(...guideValues);
      guideId = Number(guideResult.lastInsertRowid);
      mark('写 AIAfterSalesGuide', guideId > 0, `guideId=${guideId}`);
    }

    // 6.9 生成上下文快照
    if (commitMode) {
      const snap = await connectorPost(`/after-sales-guide/${guideId}/context-snapshots`, { forceRefresh: true });
      mark(
        '生成上下文快照(真实)',
        !!snap?.success,
        `links=${Object.keys(snap?.links || {}).length}, artifacts=${(snap?.artifacts || []).length}`,
      );
    } else {
      const emailHistoryCsv = buildEmailHistoryArtifactContent(trackingRecords);
      const completeOrder = await queryCompleteOrderByOrderId(orderId);
      const realtimeTxt = buildRealtimeExpressArtifactContent(orderId, completeOrder);
      db.prepare(
        `INSERT INTO AIAfterSalesGuideContextArtifact_test (ai_after_sales_guide_id, artifact_type, file_name, mime_type, content_text) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        guideId,
        'email_history_csv',
        `${sanitizeFileNameSegment(orderId, String(guideId))}-email-history.csv`,
        'text/csv; charset=utf-8',
        emailHistoryCsv,
      );
      db.prepare(
        `INSERT INTO AIAfterSalesGuideContextArtifact_test (ai_after_sales_guide_id, artifact_type, file_name, mime_type, content_text) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        guideId,
        'realtime_express_txt',
        `${sanitizeFileNameSegment(orderId, String(guideId))}-realtime-express.txt`,
        'text/plain; charset=utf-8',
        realtimeTxt,
      );
      mark(
        '生成上下文快照',
        true,
        `email_history_csv=${emailHistoryCsv.length}B, realtime=${realtimeTxt.length}B, complete_table=${
          completeOrder.tableName || 'null'
        }`,
      );
    }

    // 6.10 回写工单状态 succeeded
    if (commitMode) {
      await connectorPost('/after-sales/work-orders/bulk-update', {
        ids: [workOrder.id],
        values: {
          has_ai_guide: '是',
          ai_guide_id: guideId,
          ai_guide_generated_at: new Date().toISOString(),
          processing_status: 'succeeded',
          processing_error: null,
          last_processed_at: new Date().toISOString(),
        },
      });
      mark('回写工单 succeeded(真实)', true, '');
    } else {
      db.prepare(
        `UPDATE AfterSalesWorkOrder_test SET has_ai_guide='是', ai_guide_id=?, ai_guide_generated_at=?, processing_status='succeeded', last_processed_at=? WHERE order_id=?`,
      ).run(guideId, new Date().toISOString(), new Date().toISOString(), orderId);
      mark('回写工单 succeeded', true, '');
    }
  } catch (error) {
    const message = error.message || String(error);
    if (commitMode) {
      try {
        await connectorPost('/after-sales/work-orders/bulk-update', {
          ids: [workOrder.id],
          values: {
            processing_status: 'failed',
            processing_error: message,
            last_processed_at: new Date().toISOString(),
          },
        });
        mark('回写工单 failed(真实)', true, message);
      } catch (e2) {
        mark('回写工单 failed(真实)', false, `${message}（回写也失败：${e2.message}）`);
      }
    } else {
      db.prepare(
        `UPDATE AfterSalesWorkOrder_test SET processing_status='failed', processing_error=?, last_processed_at=? WHERE order_id=?`,
      ).run(message, new Date().toISOString(), orderId);
      mark('回写工单 failed', true, message);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// 7) 校验负向用例（证明校验逻辑能拦截坏产出）
// ---------------------------------------------------------------------------

function runValidationNegatives() {
  const cases = [
    {
      name: '缺少 order_id',
      payload: { store_name: 'x', manual_confirmation_required: '是', ai_confidence_level: '高' },
      expectFail: 'INVALID_AFTER_SALES_GUIDE_ORDER_ID',
    },
    {
      name: 'manual_confirmation_required 用布尔值',
      payload: { order_id: '112-1', manual_confirmation_required: true, ai_confidence_level: '高' },
      expectFail: 'INVALID_AFTER_SALES_GUIDE_MANUAL_CONFIRMATION',
    },
    {
      name: 'ai_confidence_level 用英文',
      payload: { order_id: '112-1', manual_confirmation_required: '是', ai_confidence_level: 'high' },
      expectFail: 'INVALID_AFTER_SALES_GUIDE_CONFIDENCE',
    },
  ];
  const results = [];
  for (const c of cases) {
    try {
      normalizeGuidePayload(c.payload);
      results.push({ name: c.name, caught: false, detail: '未被拦截（预期应拦截）' });
    } catch (error) {
      results.push({ name: c.name, caught: error.code === c.expectFail, detail: `${error.code}` });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 8) 入口
// ---------------------------------------------------------------------------

async function main() {
  if (!orderIds.length) {
    console.error(
      '用法：node scripts/after-sales-batch-selfcheck.js [订单号...] [--ai=stub|openai] [--commit] [--db=/path.sqlite]',
    );
    console.error('  --commit  真机模式：写真实 connector/MySQL（默认只写本地 SQLite 临时表）');
    console.error('  --ai=openai  使用真实模型（--commit 时必须）');
    console.error('示例订单号（真实 Email4Final 买家订单）：');
    console.error('  112-8258279-9010605  113-4466437-9349007  114-0169692-8724233  111-8412999-5301852');
    process.exit(2);
  }

  if (commitMode && aiMode !== 'openai') {
    console.error('--commit 真机模式必须使用 --ai=openai（真实模型）。');
    process.exit(2);
  }

  console.log(`connector=${CONNECTOR_BASE_URL}  ai=${aiMode}  commit=${commitMode}`);
  console.log(`待测订单：${orderIds.join(', ')}`);
  if (commitMode) {
    console.log('⚠️  真机模式：将向生产 connector/MySQL 写入真实工单、AIAfterSalesGuide、快照与状态。\n');
  } else {
    console.log('');
  }

  const db = commitMode ? null : initTempDb(dbPath);

  let allOk = true;
  for (let i = 0; i < orderIds.length; i += 1) {
    const report = await runOneOrder(db, orderIds[i], i);
    if (!report.ok) allOk = false;
    console.log(`\n=== 订单 ${report.orderId} ===`);
    for (const step of report.steps) {
      console.log(`  [${step.ok ? 'OK' : 'FAIL'}] ${step.name}${step.detail ? ' — ' + step.detail : ''}`);
    }
  }

  if (commitMode) {
    console.log('\n=== 真机结果（已写入生产 MySQL） ===');
    for (const oid of orderIds) {
      const list = await connectorGet('/after-sales/work-orders', { keyword: oid, pageSize: 5 });
      for (const w of list.records || []) {
        if (String(w.order_id) === oid) {
          console.log(
            `  order=${w.order_id}  workOrderId=${w.id}  status=${w.processing_status}  has_ai_guide=${
              w.has_ai_guide
            }  ai_guide_id=${w.ai_guide_id}${w.processing_error ? '  error=' + w.processing_error : ''}`,
          );
        }
      }
    }
    console.log(`\n${allOk ? '真机批处理全部通过' : '真机批处理存在失败项'}。`);
    process.exit(allOk ? 0 : 1);
  }

  console.log('\n=== 校验负向用例（指南字段校验应能拦截坏产出） ===');
  for (const r of runValidationNegatives()) {
    console.log(`  [${r.caught ? 'OK' : 'FAIL'}] ${r.name} — ${r.detail}`);
  }

  // 汇总临时表落库结果
  const workOrders = db
    .prepare(
      'SELECT order_id, processing_status, has_ai_guide, ai_guide_id, processing_error FROM AfterSalesWorkOrder_test ORDER BY id',
    )
    .all();
  const guides = db.prepare('SELECT count(*) AS c FROM AIAfterSalesGuide_test').get();
  const artifacts = db
    .prepare('SELECT artifact_type, count(*) AS c FROM AIAfterSalesGuideContextArtifact_test GROUP BY artifact_type')
    .all();

  console.log('\n=== 临时表落库汇总（仅本地 SQLite） ===');
  for (const w of workOrders) {
    console.log(
      `  order=${w.order_id}  status=${w.processing_status}  has_ai_guide=${w.has_ai_guide}  ai_guide_id=${
        w.ai_guide_id
      }${w.processing_error ? '  error=' + w.processing_error : ''}`,
    );
  }
  console.log(`  AIAfterSalesGuide 记录数：${guides.c}`);
  for (const a of artifacts) console.log(`  ContextArtifact[${a.artifact_type}]：${a.c}`);

  console.log(`\n${allOk ? '全部通过' : '存在失败项'}。临时库：${dbPath}（可删除，无副作用）`);
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error('自检脚本异常：', error);
  process.exit(1);
});
