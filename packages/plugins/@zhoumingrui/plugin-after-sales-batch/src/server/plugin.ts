import { Context, Next } from '@nocobase/actions';
import { installTrackingExceptionAssign } from './tracking-exception-assign';
import { installDailyAfterSalesAssign } from './daily-after-sales-assign';
import { installAssignmentFieldGuard } from './assignment-field-guard';
import { normalizeWorkOrderRecord, normalizeWorkOrderRecords } from './work-order-field-alias';
import { DAILY_AFTER_SALES_ACTIONS, DAILY_AFTER_SALES_RESOURCE } from './actions-daily-after-sales';
import { Plugin } from '@nocobase/server';
import type { AsyncTasksManager } from '@nocobase/plugin-async-task-manager';
import { connectorClient } from './services/connector-client';
import { AfterSalesGuideBatchTask, LOCAL_ACTIONS } from './actions-local';
import { LOCAL_GUIDE_ACTIONS, LOCAL_GUIDE_RESOURCE } from './actions-local-guide';

/**
 * 售后处理指南：三条并行的生成路径。
 *
 * 【Dify 路径】资源 afterSalesBatch（本文件）
 *   链路：建单/导入 → 勾选 → 触发前检查 → 创建批次并后台执行（连接器调 Dify）
 *        → 轮询批次进度 → 查看指南 → 人工审核 + 回填实际回信 → 下载核查文件
 *   指南口径：20 字段（见《阶段二实现规格-20261011》）。
 *
 * 【本地生成路径·旧版】资源 afterSalesBatchLocal（见 actions-local.ts）
 *   由 NocoBase 内置 AI 员工逐单生成 17 字段指南，AI 靠 MCP 自助取数，不经过 Dify。
 *   写 V1 表。**完整保留，勿动**（初期用于与上面两条做对比测试）。
 *
 * 【本地生成路径·新建】资源 localGuide（见 actions-local-guide.ts）
 *   连接器预取同一份原料包 → 交给 NocoBase 内置 AI 员工 local-guide-writer → 返回 6 字段。
 *   与 Dify 路径**同输入同输出**（写同一张 V2 表），唯一差别是不经过 Dify。
 *   用途：Dify 不可用时的兜底。调用方是连接器，靠 header token 鉴权，故 ACL 为 public。
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
  // 本入口走连接器 V2 接口（只认工单表列名），而页面表单/Excel 导入用的是旧命名
  // （email4final_depth 等，与 Local 入口配套）—— 不归一化就会**静默丢弃**四个字段。
  // 详见 work-order-field-alias.ts
  ctx.body = await connectorClient.createWorkOrders(normalizeWorkOrderRecords(records));
  await next();
}

async function updateWorkOrders(ctx: Context, next: Next) {
  const serials = readWorkOrderSerials(ctx);
  const values = normalizeWorkOrderRecord(readValues(ctx).values || {});
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
 * values.provider: 'dify' | 'local'  —— 生成方式（缺省 dify，连接器侧再兜一次环境变量）
 */
async function startGuideBatch(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const serials = readWorkOrderSerials(ctx);
  const decisions = values.decisions && typeof values.decisions === 'object' ? values.decisions : {};
  const provider = values.provider === 'local' ? 'local' : values.provider === 'dify' ? 'dify' : undefined;
  const created = await connectorClient.createGuideBatch({
    work_order_serials: serials,
    triggered_by: values.triggered_by || ctx.auth?.user?.nickname || ctx.auth?.user?.username || null,
    default_action: values.default_action || 'generate',
    decisions,
    provider,
  });

  const batch = created.batch;
  // provider 只传 undefined 时连接器会沿用批次落库的引擎，所以这里不必重复传值。
  const run = await connectorClient.runGuideBatch(batch.batch_serial, values.concurrency, provider);
  ctx.body = {
    success: true,
    batch: run.batch || batch,
    accepted: run.accepted,
    reason: run.reason || null,
    missing_serials: created.missing_serials || [],
    provider: (run.batch || batch)?.provider || provider || null,
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

// ---------------------------------------------------------------------------
// 快递通知邮件发送（发起方在工作台页面上：筛 7E2 → 关联 7E1 → 勾选 → 触发 Dify 逐封）
// ---------------------------------------------------------------------------

/** 今日可发快递邮件清单（含 7E1 收件人/正文与发件邮箱） */
async function listEmailNotifySendable(ctx: Context, next: Next) {
  const values = readValues(ctx);
  ctx.body = await connectorClient.listEmailNotifySendable({
    date: values.date,
    basis: values.basis,
    limit: values.limit,
    dry_run: values.dry_run,
  });
  await next();
}

async function listEmailSenderMailboxes(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listEmailSenderMailboxes();
  await next();
}

/** 创建发送任务（勾选后的订单清单） */
async function createEmailNotifyJob(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const orderIds = Array.isArray(values.order_ids) ? values.order_ids : [];
  if (!orderIds.length) {
    ctx.throw(400, 'order_ids is required');
  }
  ctx.body = await connectorClient.createEmailNotifyJob({
    order_ids: orderIds,
    date: values.date,
    basis: values.basis,
    dry_run: values.dry_run,
    write_back: values.write_back,
    triggered_by: values.triggered_by || ctx.auth?.user?.nickname || ctx.auth?.user?.username || null,
  });
  await next();
}

/** 触发 Dify 逐封发送 */
async function runEmailNotifyJobViaDify(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const jobSerial = String(values.job_serial || '').trim();
  if (!jobSerial) {
    ctx.throw(400, 'job_serial is required');
  }
  ctx.body = await connectorClient.runEmailNotifyJobViaDify(jobSerial, {
    dry_run: values.dry_run,
    write_back: values.write_back,
  });
  await next();
}

async function getEmailNotifyJob(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const jobSerial = String(values.job_serial || '').trim();
  if (!jobSerial) {
    ctx.throw(400, 'job_serial is required');
  }
  ctx.body = await connectorClient.getEmailNotifyJob(jobSerial);
  await next();
}

async function listEmailNotifyJobs(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listEmailNotifyJobs(Number(readValues(ctx).limit) || 5);
  await next();
}

async function retryEmailNotifyJob(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const jobSerial = String(values.job_serial || '').trim();
  if (!jobSerial) {
    ctx.throw(400, 'job_serial is required');
  }
  ctx.body = await connectorClient.retryEmailNotifyJob(jobSerial, { dry_run: values.dry_run });
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
  listEmailNotifySendable,
  listEmailSenderMailboxes,
  createEmailNotifyJob,
  runEmailNotifyJobViaDify,
  getEmailNotifyJob,
  listEmailNotifyJobs,
  retryEmailNotifyJob,
};

export class PluginAfterSalesBatchServer extends Plugin {
  private taskRegistered = false;

  afterAdd() {
    this.app.on('afterLoad', () => this.registerTaskType());
  }

  /**
   * 注册本地生成路径的异步任务类型。
   * 只有本地路径依赖 AsyncTaskManager，注册失败不影响 Dify 路径。
   */
  private registerTaskType() {
    if (this.taskRegistered) {
      return;
    }
    try {
      const taskManager = this.app.container.get('AsyncTaskManager') as AsyncTasksManager;
      taskManager.registerTaskType(AfterSalesGuideBatchTask);
      this.taskRegistered = true;
    } catch (error) {
      this.log.warn('AsyncTaskManager is not available, skip local after-sales batch task registration.');
    }
  }

  async load() {
    this.registerTaskType();

    // ---- 7D4 快递异常：指派的服务端拦截 ----
    // 页面上的「售后处理人」内联编辑只会写 handler_name 一列，handler_id 保持 NULL，
    // 导致行级隔离（scope 依赖 handler_id）静默失效。这里把它转交连接器做事务补齐，
    // 对页面完全透明（主管照旧在下拉里选人）。
    // 必须放在 load() 里：数据源只在第一次被使用时合并 dataSourceManager 的中间件。
    installTrackingExceptionAssign(this.app, this.log as any);

    // ---- 每日售后订单表：指派的**同类**服务端拦截 ----
    // 工作台的「售后负责人」列也是内联可编辑的，原生 CRUD 同样只写 owner_name，
    // 而专员的隔离 scope 用 owner_id —— 不拦就会出现"主管指派了、专员看不到"（HTTP 200、不报错）。
    installDailyAfterSalesAssign(this.app, this.log as any);

    // ---- 指派类字段的写守卫 ----
    // 行级 scope 只限制"改哪几行"，不限制"改哪几列" —— 专员本可把自己那行的 owner_id
    // 改成别人（推单）。ACL 的 fields 不管写（只影响客户端渲染），所以在这里 403。
    installAssignmentFieldGuard(this.app, this.log as any);

    // ---- Dify 路径（新版）----
    this.app.resourceManager.define({
      name: 'afterSalesBatch',
      actions: ACTIONS,
    });
    this.app.acl.allow('afterSalesBatch', Object.keys(ACTIONS), 'loggedIn');
    this.app.acl.registerSnippet({
      name: `pm.${this.name}`,
      actions: ['afterSalesBatch:*'],
    });

    // ---- 本地生成路径（原版，Dify 不可用时兜底）----
    this.app.resourceManager.define({
      name: 'afterSalesBatchLocal',
      actions: LOCAL_ACTIONS,
    });
    this.app.acl.allow('afterSalesBatchLocal', Object.keys(LOCAL_ACTIONS), 'loggedIn');
    this.app.acl.registerSnippet({
      name: `pm.${this.name}.local`,
      actions: ['afterSalesBatchLocal:*'],
    });

    // ---- 本地 AI 驱动生成（新建，写 V2 表；调用方是连接器，无 NocoBase 登录态）----
    // 鉴权由动作内部的 x-local-guide-token 承担（见 actions-local-guide.ts），
    // 因此 ACL 必须放行为 public。
    this.app.resourceManager.define({
      name: LOCAL_GUIDE_RESOURCE,
      actions: LOCAL_GUIDE_ACTIONS,
    });
    this.app.acl.allow(LOCAL_GUIDE_RESOURCE, Object.keys(LOCAL_GUIDE_ACTIONS), 'public');
    this.app.acl.registerSnippet({
      name: `pm.${this.name}.localGuide`,
      actions: [`${LOCAL_GUIDE_RESOURCE}:*`],
    });

    // ---- 每日售后订单工作台的动作（建单等），同样只做转发 ----
    this.app.resourceManager.define({
      name: DAILY_AFTER_SALES_RESOURCE,
      actions: DAILY_AFTER_SALES_ACTIONS,
    });
    this.app.acl.allow(DAILY_AFTER_SALES_RESOURCE, Object.keys(DAILY_AFTER_SALES_ACTIONS), 'loggedIn');
    this.app.acl.registerSnippet({
      name: `pm.${this.name}.dailyAfterSales`,
      actions: [`${DAILY_AFTER_SALES_RESOURCE}:*`],
    });
  }
}

export default PluginAfterSalesBatchServer;
