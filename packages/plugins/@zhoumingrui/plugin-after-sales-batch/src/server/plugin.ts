import { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import { connectorClient } from './services/connector-client';

/**
 * 售后批处理（阶段二）：NocoBase 只做"工作台 + 人工操作"，编排全部在连接器侧。
 *
 * 链路：建单/导入 → 勾选 → 触发前检查（已有指南则选"去除 / 重新生成"）→ 创建批次并后台执行
 *      → 轮询批次进度四项 → 查看指南（6 个 AI 字段）→ 人工审核 + 回填实际回信 → 下载核查文件
 *
 * 与旧版的差异：旧版由 NocoBase 侧 AsyncTask + AI 员工逐单生成 17 字段指南；阶段二改为
 * 连接器调 Dify 生成 20 字段指南（字段口径见《阶段二实现规格-20261011》），故移除任务类型与 AI 员工选择。
 */

const WORK_ORDER_SERIAL_PATTERN = /^[A-Za-z0-9._:-]{1,40}$/;

function readValues(ctx: Context) {
  return ctx.action.params.values || {};
}

/** 统一取"工单序列号数组"入参（兼容 serials/workOrderSerials 命名） */
function readWorkOrderSerials(ctx: Context) {
  const values = readValues(ctx);
  const source = values.work_order_serials || values.workOrderSerials || values.serials || [];
  const list = Array.isArray(source) ? source : [source];
  const serials = list
    .map((value: unknown) => String(value ?? '').trim())
    .filter((value: string) => WORK_ORDER_SERIAL_PATTERN.test(value));
  if (!serials.length) {
    ctx.throw(400, 'work_order_serials is required');
  }
  return [...new Set(serials)];
}

function readGuideSerial(ctx: Context) {
  const values = readValues(ctx);
  const guideSerial = String(values.guide_serial || values.guideSerial || '').trim();
  if (!guideSerial) {
    ctx.throw(400, 'guide_serial is required');
  }
  return guideSerial;
}

function readBatchSerial(ctx: Context) {
  const values = readValues(ctx);
  const batchSerial = String(values.batch_serial || values.batchSerial || '').trim();
  if (!batchSerial) {
    ctx.throw(400, 'batch_serial is required');
  }
  return batchSerial;
}

// ---------------------------------------------------------------------------
// 售后工单（V2）
// ---------------------------------------------------------------------------

async function listWorkOrders(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listWorkOrders(readValues(ctx));
  await next();
}

async function listReplyGreetings(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listReplyGreetings();
  await next();
}

async function createWorkOrders(ctx: Context, next: Next) {
  const records = readValues(ctx).records;
  if (!Array.isArray(records) || !records.length) {
    ctx.throw(400, 'records is required');
  }
  ctx.body = await connectorClient.createWorkOrders(records);
  await next();
}

async function updateWorkOrders(ctx: Context, next: Next) {
  const serials = readWorkOrderSerials(ctx);
  const values = readValues(ctx).values || {};
  ctx.body = await connectorClient.updateWorkOrders(serials, values);
  await next();
}

async function deleteWorkOrders(ctx: Context, next: Next) {
  ctx.body = await connectorClient.deleteWorkOrders(readWorkOrderSerials(ctx));
  await next();
}

/** 触发前检查：返回每个工单是否已有指南（页面据此提示去除/重新生成） */
async function inspectWorkOrders(ctx: Context, next: Next) {
  ctx.body = await connectorClient.inspectWorkOrders(readWorkOrderSerials(ctx));
  await next();
}

// ---------------------------------------------------------------------------
// 批次（编排在连接器侧）
// ---------------------------------------------------------------------------

/**
 * 创建批次并后台执行。
 * values.decisions: { [work_order_serial]: 'skip' | 'regenerate' | 'generate' }
 * values.default_action: 'generate' | 'skip' | 'regenerate'
 */
async function startGuideBatch(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const serials = readWorkOrderSerials(ctx);
  const decisions = values.decisions && typeof values.decisions === 'object' ? values.decisions : {};
  const created = await connectorClient.createGuideBatch({
    work_order_serials: serials,
    triggered_by: values.triggered_by || ctx.auth?.user?.nickname || ctx.auth?.user?.username || null,
    default_action: values.default_action || 'generate',
    decisions,
  });

  const batch = created.batch;
  const run = await connectorClient.runGuideBatch(batch.batch_serial, values.concurrency);
  ctx.body = {
    success: true,
    batch: run.batch || batch,
    accepted: run.accepted,
    reason: run.reason || null,
    missing_serials: created.missing_serials || [],
  };
  await next();
}

/** 最近批次列表（页面初始化时回显最近一次进度） */
async function listGuideBatches(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listGuideBatches(Number(readValues(ctx).limit) || 5);
  await next();
}

async function getGuideBatch(ctx: Context, next: Next) {
  ctx.body = await connectorClient.getGuideBatch(readBatchSerial(ctx));
  await next();
}

async function retryGuideBatch(ctx: Context, next: Next) {
  ctx.body = await connectorClient.retryGuideBatch(readBatchSerial(ctx), readValues(ctx).concurrency);
  await next();
}

/** 解绑（"去除"已有指南；旧记录保留但不参与后续参考） */
async function unbindGuides(ctx: Context, next: Next) {
  ctx.body = await connectorClient.unbindGuides(readWorkOrderSerials(ctx));
  await next();
}

// ---------------------------------------------------------------------------
// 指南记录（人工操作）
// ---------------------------------------------------------------------------

async function getGuide(ctx: Context, next: Next) {
  ctx.body = await connectorClient.getGuide(readGuideSerial(ctx));
  await next();
}

/** 人工回填/审核：values = { review_status?, actual_seller_reply_body?, seller_reply_time?, <6 个 AI 字段>? } */
async function updateGuide(ctx: Context, next: Next) {
  const values = readValues(ctx).values || {};
  if (!values || !Object.keys(values).length) {
    ctx.throw(400, 'values is required');
  }
  ctx.body = await connectorClient.updateGuide(readGuideSerial(ctx), values);
  await next();
}

/** 核查文件下载地址（⑲CSV / ⑳TXT），页面直接打开链接 */
async function getGuideArtifactUrls(ctx: Context, next: Next) {
  const guideSerial = readGuideSerial(ctx);
  ctx.body = {
    success: true,
    guide_serial: guideSerial,
    links: {
      email_history_csv: connectorClient.buildArtifactUrl(guideSerial, 'email_history_csv'),
      realtime_express_txt: connectorClient.buildArtifactUrl(guideSerial, 'realtime_express_txt'),
    },
  };
  await next();
}

const ACTIONS = {
  listWorkOrders,
  listReplyGreetings,
  createWorkOrders,
  updateWorkOrders,
  deleteWorkOrders,
  inspectWorkOrders,
  startGuideBatch,
  listGuideBatches,
  getGuideBatch,
  retryGuideBatch,
  unbindGuides,
  getGuide,
  updateGuide,
  getGuideArtifactUrls,
};

export class PluginAfterSalesBatchServer extends Plugin {
  async load() {
    this.app.resourceManager.define({
      name: 'afterSalesBatch',
      actions: ACTIONS,
    });

    this.app.acl.allow('afterSalesBatch', Object.keys(ACTIONS), 'loggedIn');
    this.app.acl.registerSnippet({
      name: `pm.${this.name}`,
      actions: ['afterSalesBatch:*'],
    });
  }
}

export default PluginAfterSalesBatchServer;
