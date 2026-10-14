/**
 * 售后工单字段名归一化（旧命名 → 工单表列名）
 *
 * ── 为什么会有两套名字 ────────────────────────────────────────
 * 这个插件有**两个**建单入口，各自对接连接器的不同版本接口：
 *
 *   afterSalesBatch:createWorkOrders      → POST /after-sales/work-orders/v2   （列名口径）
 *   afterSalesBatchLocal:createWorkOrders → POST /after-sales/work-orders      （旧命名口径）
 *
 * 而工单页的表单与 Excel 导入用的是**旧命名**（`email4final_depth` 等，
 * 与页面固定调用的 Local 入口配套）。于是同一份表单数据一旦改走远程入口，
 * 下面四个字段就会被 V2 服务**静默丢弃**（实测：返回 200、建单成功、值是默认/null）：
 *
 *   email4final_depth          → table_a_depth          （表 A 获取深度，默认 3）
 *   ai_after_sales_guide_depth → table_b_depth          （表 B 获取深度，默认 1）
 *   tone_and_language_requirement → tone_and_language   （语气和语言要求）
 *   standard_case_template_path   → case_template_path  （标准参考案例模版路径）
 *
 * 其余 7 个字段（order_id / buyer_email / buyer_issue_type / additional_context /
 * reply_preference / email_length / reply_greeting）两套同名，不受影响。
 *
 * ── 这个模块做什么 ────────────────────────────────────────────
 * 在**转发给连接器之前**统一归一化：调用方给哪套名字都能正确落库。
 * 对本来就用列名的调用方是**幂等**的（键已存在时不覆盖），所以可以无脑套。
 *
 * ── 为什么不改客户端 ──────────────────────────────────────────
 * 改客户端要重新构建前端，而这里一处即可覆盖两个入口；
 * 且保留旧命名兼容，历史调用方（含 Excel 导入模板的表头）不用改。
 */

/** 旧命名 → 工单表列名 */
export const WORK_ORDER_FIELD_ALIAS: Record<string, string> = {
  email4final_depth: 'table_a_depth',
  ai_after_sales_guide_depth: 'table_b_depth',
  tone_and_language_requirement: 'tone_and_language',
  standard_case_template_path: 'case_template_path',
};

/**
 * 把一条工单记录的字段名归一化成工单表列名。
 * 幂等：目标键已存在时以**已有的列名值**为准，不被旧命名覆盖。
 */
export function normalizeWorkOrderRecord<T extends Record<string, unknown>>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  const out: Record<string, unknown> = { ...record };
  for (const [legacy, column] of Object.entries(WORK_ORDER_FIELD_ALIAS)) {
    if (out[legacy] === undefined) continue;
    if (out[column] === undefined) {
      out[column] = out[legacy];
    }
    delete out[legacy];
  }
  return out as T;
}

/** 批量版本（createWorkOrders 收的是数组） */
export function normalizeWorkOrderRecords(records: unknown): Record<string, unknown>[] {
  if (!Array.isArray(records)) return [];
  return records.map((r) => normalizeWorkOrderRecord(r as Record<string, unknown>));
}
