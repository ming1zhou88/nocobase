/**
 * 连接器 AI 网关客户端（阶段二 V2 接口）
 *
 * 契约来源：连接器仓库 routes/ai-gateway.js（阶段二接口段）
 *  - 售后工单：/after-sales/work-orders/v2（建单/列表/更新/删除/触发前检查）
 *  - 批次：/after-sales/guide-batches（创建/查询/后台执行/重试）
 *  - 指南记录：/after-sales/guides/:guideSerial（查询、人工回填审核、核查文件下载）
 *
 * 编排（批次进度四项、失败重试、单事务落库）全部在连接器侧完成，NocoBase 只做展示与人工操作。
 * 历史说明：旧版客户端指向 /after-sales/work-orders（数字主键 + 旧表 + AI 员工问答式生成），阶段二已全部切到 V2。
 */
const DEFAULT_CONNECTOR_BASE_URL = 'http://127.0.0.1:3000';

type RequestOptions = {
  method?: 'GET' | 'POST';
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

export type WorkOrderRecord = {
  id: number;
  work_order_serial: string;
  order_id: string | null;
  buyer_email: string | null;
  table_a_depth: number;
  table_b_depth: number;
  buyer_issue_type: string | null;
  additional_context: string | null;
  tone_and_language: string | null;
  reply_preference: string | null;
  email_length: string | null;
  reply_greeting: string;
  case_template_path: string | null;
  created_at: string;
  has_guide: '是' | '否';
  guide_serial: string | null;
  guide_generated_at: string | null;
  updated_at: string;
};

export type GuideRecord = {
  id: number;
  guide_serial: string;
  work_order_serial: string | null;
  store_name: string | null;
  order_id: string | null;
  buyer_email: string | null;
  buyer_email_body: string | null;
  buyer_email_time: string | null;
  mail_record_id: number | null;
  communication_history_summary: string | null;
  current_email_summary: string | null;
  buyer_other_info: string | null;
  seller_reply_draft: string | null;
  seller_action_guide: string | null;
  reasoning_explanation: string | null;
  created_time: string;
  actual_seller_reply_body: string | null;
  seller_reply_time: string | null;
  review_status: '已审核' | null;
  email_history_csv_url: string | null;
  realtime_express_txt_url: string | null;
  updated_at: string;
};

export type GuideBatchRecord = {
  id: number;
  batch_serial: string;
  triggered_by: string | null;
  total_count: number;
  done_count: number;
  pending_count: number;
  failed_count: number;
  skipped_count: number;
  status: 'running' | 'all_done' | 'part_failed';
  failure_detail: { work_order_serial: string; reason: string; code?: string | null }[] | null;
  started_at: string;
  finished_at: string | null;
};

export class ConnectorClientError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ConnectorClientError';
    this.status = status;
  }
}

export class ConnectorClient {
  private readonly baseUrl: string;

  private readonly token: string;

  constructor() {
    this.baseUrl = (process.env.AFTER_SALES_CONNECTOR_BASE_URL || DEFAULT_CONNECTOR_BASE_URL).replace(/\/$/, '');
    this.token = process.env.AFTER_SALES_BATCH_TOKEN || '';
  }

  private buildUrl(path: string, query?: Record<string, unknown>) {
    const url = new URL(`${this.baseUrl}/ai${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(this.buildUrl(path, options.query), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'x-after-sales-batch-token': this.token } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let data: any = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        const summary = text.length > 200 ? `${text.slice(0, 200)}...` : text;
        throw new ConnectorClientError(
          `Connector returned non-JSON response (${response.status}) for /ai${path}: ${summary}`,
          response.status,
        );
      }
    }
    if (!response.ok || data?.success === false) {
      throw new ConnectorClientError(data?.message || `Connector request failed: ${response.status}`, response.status);
    }
    return data as T;
  }

  // -------------------------------------------------------------------------
  // 售后工单（V2）
  // -------------------------------------------------------------------------

  listWorkOrders(params: Record<string, unknown>) {
    return this.request<{
      success: true;
      total: number;
      page: number;
      pageSize: number;
      records: WorkOrderRecord[];
    }>('/after-sales/work-orders/v2', { query: params });
  }

  listReplyGreetings() {
    return this.request<{
      success: true;
      count: number;
      records: { id: number; greeting: string; sort_order: number }[];
    }>('/after-sales/reply-greetings');
  }

  /**
   * 7D4 快递异常指派（服务端唯一入口）。
   *
   * 页面上的「售后处理人」内联编辑会被 tracking-exception-assign.ts 的中间件拦截并转发到这里，
   * 由连接器在同一事务内补齐 handler_id、推进状态、留痕、回写负责人表。
   * 依据：doc/nocobase/检查-7D4快递异常实现现状-v1.md
   */
  assignTrackingException(payload: {
    rowIds?: number[];
    orderIds?: string[];
    owner: { id: number; name: string; account?: string | null };
    operator?: { id?: number; name?: string };
    source?: string;
  }) {
    return this.request<{ success: true; updated: number; orderIds: string[] }>('/tracking-exception/assign', {
      method: 'POST',
      body: payload,
    });
  }

  /**
   * 每日售后订单指派（服务端唯一入口）。
   *
   * 工作台上「售后负责人」列的内联编辑会被 daily-after-sales-assign.ts 的中间件
   * 拦截并转发到这里，由连接器在同一事务内补齐 owner_id / assign_status / 留痕，
   * 并回写负责人表（供邮件链路的自动派单共用）。
   *
   * 不这么做就会"指派了但对方看不到"：原生 CRUD 只写 owner_name，
   * 而专员的行级隔离 scope 用的是 owner_id。
   */
  assignDailyAfterSalesOrder(payload: {
    rowIds?: number[];
    identityKeys?: string[];
    owner: { id: number; name: string; account?: string | null };
    operator?: { id?: number; name?: string };
    source?: string;
  }) {
    return this.request<{ success: true; updated: number; identityKeys: string[] }>(
      '/after-sales/daily-orders/assign',
      { method: 'POST', body: payload },
    );
  }

  /**
   * 从「每日售后订单表」的一行发起售后工单。
   *
   * 连接器会：自动带出订单号/邮箱/问题类型 → 建单 → 回写 work_order_serial（防重复发起）。
   * 已发起过时返回 created=false 与既有工单。
   */
  createDailyAfterSalesWorkOrder(payload: {
    daily_order_id: number;
    overrides?: Record<string, unknown>;
    force?: boolean;
  }) {
    return this.request<{ success: true; created: boolean; workOrder: Record<string, unknown>; dailyOrderId: number }>(
      '/after-sales/daily-orders/create-work-order',
      { method: 'POST', body: payload },
    );
  }

  createWorkOrders(records: Record<string, unknown>[]) {
    return this.request<{ success: true; count: number; records: WorkOrderRecord[] }>('/after-sales/work-orders/v2', {
      method: 'POST',
      body: { records },
    });
  }

  updateWorkOrders(workOrderSerials: string[], values: Record<string, unknown>) {
    return this.request<{ success: true; count: number; records: WorkOrderRecord[] }>(
      '/after-sales/work-orders/v2/bulk-update',
      { method: 'POST', body: { work_order_serials: workOrderSerials, values } },
    );
  }

  deleteWorkOrders(workOrderSerials: string[]) {
    return this.request<{ success: true; deletedCount: number; unboundCount: number }>(
      '/after-sales/work-orders/v2/bulk-delete',
      { method: 'POST', body: { work_order_serials: workOrderSerials } },
    );
  }

  /** 触发前检查：哪些工单已有指南（页面据此提示"去除 / 重新生成"） */
  inspectWorkOrders(workOrderSerials: string[]) {
    return this.request<{
      success: true;
      count: number;
      missing_serials: string[];
      records: {
        work_order_serial: string;
        has_guide: boolean;
        guide_serial: string | null;
        review_status: string | null;
        suggested_action: 'generate' | 'skip_or_regenerate';
        work_order: WorkOrderRecord | null;
      }[];
    }>('/after-sales/work-orders/v2/inspect', {
      method: 'POST',
      body: { work_order_serials: workOrderSerials },
    });
  }

  // -------------------------------------------------------------------------
  // 指南与批次（编排在连接器侧）
  // -------------------------------------------------------------------------

  createGuideBatch(values: Record<string, unknown>) {
    return this.request<{
      success: true;
      batch: GuideBatchRecord;
      missing_serials: string[];
      result: unknown;
    }>('/after-sales/guide-batches', { method: 'POST', body: { ...values, start: false } });
  }

  /**
   * 后台执行批次：立即返回，进度看批次表（页面轮询 getGuideBatch）。
   * provider 一般不用传：批次创建时已落库，连接器会沿用；仅在需要覆盖时才传。
   */
  runGuideBatch(batchSerial: string, concurrency?: number, provider?: string) {
    return this.request<{ success: true; accepted: boolean; reason: string | null; batch: GuideBatchRecord }>(
      `/after-sales/guide-batches/${encodeURIComponent(batchSerial)}/run`,
      { method: 'POST', body: { concurrency, provider } },
    );
  }

  /** 最近批次（页面刷新后回显进度四项） */
  listGuideBatches(limit = 5) {
    return this.request<{ success: true; count: number; records: GuideBatchRecord[] }>('/after-sales/guide-batches', {
      query: { limit },
    });
  }

  getGuideBatch(batchSerial: string) {
    return this.request<{ success: true; batch: GuideBatchRecord }>(
      `/after-sales/guide-batches/${encodeURIComponent(batchSerial)}`,
    );
  }

  retryGuideBatch(batchSerial: string, concurrency?: number) {
    return this.request<{
      success: true;
      batch: GuideBatchRecord;
      result: { retried: number; results: { work_order_serial: string; status: string }[] };
    }>(`/after-sales/guide-batches/${encodeURIComponent(batchSerial)}/retry`, {
      method: 'POST',
      body: { concurrency },
    });
  }

  getGuide(guideSerial: string) {
    return this.request<{ success: true; guide: GuideRecord }>(
      `/after-sales/guides/${encodeURIComponent(guideSerial)}`,
    );
  }

  /** 人工回填 / 审核（只写 ⑮⑯⑱ 与显式传入的人工修正字段） */
  updateGuide(guideSerial: string, values: Record<string, unknown>) {
    return this.request<{ success: true; guide: GuideRecord }>(
      `/after-sales/guides/${encodeURIComponent(guideSerial)}/manual`,
      { method: 'POST', body: values },
    );
  }

  /** 解绑（"重新生成"前把旧记录摘掉，旧记录此后不参与参考） */
  unbindGuides(workOrderSerials: string[]) {
    return this.request<{
      success: true;
      count: number;
      records: { work_order_serial: string; unboundGuideSerial: string | null }[];
    }>('/after-sales/guides/unbind', { method: 'POST', body: { work_order_serials: workOrderSerials } });
  }

  /** 核查文件下载地址（⑲邮件历史 CSV / ⑳实时快递详情 TXT） */
  buildArtifactUrl(guideSerial: string, artifactType: 'email_history_csv' | 'realtime_express_txt') {
    return `${this.baseUrl}/ai/after-sales/guides/${encodeURIComponent(guideSerial)}/artifacts/${artifactType}`;
  }

  // -------------------------------------------------------------------------
  // 快递通知邮件发送（7E2 今日可发 → 7E1 正文 → Dify 逐封 → 连接器回写）
  // -------------------------------------------------------------------------

  /** 今日可发清单（美西当天；dry_run=1 时不校验发件授权码，便于先看清单） */
  listEmailNotifySendable(params: Record<string, unknown>) {
    return this.request<{
      success: true;
      window: { date: string; basis: string; start: string; end: string; note: string };
      count: number;
      sendable_count: number;
      blocked_count: number;
      records: Record<string, unknown>[];
    }>('/email-notify/sendable', { query: params });
  }

  /** 店铺 → 发件邮箱映射 */
  listEmailSenderMailboxes() {
    return this.request<{ success: true; count: number; records: Record<string, unknown>[] }>(
      '/email-notify/mailboxes',
    );
  }

  createEmailNotifyJob(values: Record<string, unknown>) {
    return this.request<{
      success: true;
      job_serial: string;
      runnable_count: number;
      skipped_count: number;
      window: Record<string, unknown>;
    }>('/email-notify/jobs', { method: 'POST', body: values });
  }

  /** 通过 Dify 工作流执行（Dify 逐封回调连接器 send-one，回写由连接器完成） */
  runEmailNotifyJobViaDify(jobSerial: string, values: Record<string, unknown> = {}) {
    return this.request<{
      success: true;
      job_serial: string;
      summary: string;
      sent: number;
      failed: number;
      skipped: number;
      details: Record<string, unknown>[];
      elapsed_ms: number;
      job: Record<string, unknown>;
    }>(`/email-notify/jobs/${encodeURIComponent(jobSerial)}/run-via-dify`, { method: 'POST', body: values });
  }

  getEmailNotifyJob(jobSerial: string) {
    return this.request<{ success: true; job: Record<string, unknown>; items: Record<string, unknown>[] }>(
      `/email-notify/jobs/${encodeURIComponent(jobSerial)}`,
    );
  }

  listEmailNotifyJobs(limit = 5) {
    return this.request<{ success: true; count: number; records: Record<string, unknown>[] }>('/email-notify/jobs', {
      query: { limit },
    });
  }

  retryEmailNotifyJob(jobSerial: string, values: Record<string, unknown> = {}) {
    return this.request<{
      success: true;
      retried: number;
      results: Record<string, unknown>[];
      job: Record<string, unknown>;
    }>(`/email-notify/jobs/${encodeURIComponent(jobSerial)}/retry`, { method: 'POST', body: values });
  }

  describe() {
    return { baseUrl: this.baseUrl, hasToken: Boolean(this.token) };
  }
}

export const connectorClient = new ConnectorClient();
