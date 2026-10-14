// 本地 AI 驱动售后指南生成（V2 表）的服务端接口。
//
// 【与相邻两条链路的关系——动手前务必分清】
//   1) actions-local.ts + tasks/after-sales-guide-batch.ts  = 旧版 NocoBase 自实现
//      写 V1 表（AIAfterSalesGuide），17 字段，AI 靠 MCP 自助取数。**本文件不碰它。**
//   2) plugin.ts 的 afterSalesBatch 资源                     = Dify 路径
//      写 V2 表，6 字段，原料由连接器预取。**本文件也不碰它。**
//   3) 本文件 localGuide 资源                                = 新建的"本地驱动"
//      写 V2 表，6 字段，原料同样由连接器预取 —— 与 Dify 路径**同输入同输出**，
//      唯一差别是把"调 Dify 工作流"换成"调 NocoBase 内置 AI 员工 local-guide-writer"。
//
// 用途：Dify 不可用时的兜底。连接器侧对应 routes/ai-gateway/LocalGuideClient.js。
//
// 契约（与 DifyGuideClient 完全一致）：
//   入参 body = {
//     work_order_serial, material_json, knowledge_query, reply_greeting,
//     buyer_issue_type, additional_context, tone_and_language,
//     reply_preference, email_length, current_datetime, employee?
//   }
//   出参 { success: true, fields: {六字段}, raw_text, parse_ok, tokens, run_id }
//
// 鉴权：header `x-local-guide-token` 必须等于环境变量 LOCAL_GUIDE_TOKEN
//       （未配置环境变量时回落到内置默认值，仅监听本机，见 resolveLocalGuideToken）。
//       调用方是连接器（无 NocoBase 登录态），因此该动作在 ACL 上放行为 public，
//       鉴权完全由上面的 token 承担。

import { Context, Next } from '@nocobase/actions';
import { AIEmployee } from '@nocobase/plugin-ai';
import type PluginAIServer from '@nocobase/plugin-ai';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const LOCAL_GUIDE_RESOURCE = 'localGuide';
export const LOCAL_GUIDE_ACTION = 'generate';
export const LOCAL_GUIDE_TOKEN_HEADER = 'x-local-guide-token';

// 内置默认 token：连接器侧 routes/ai-gateway/LocalGuideClient.js 使用同一个值。
// 两边都可用环境变量 LOCAL_GUIDE_TOKEN 覆盖（覆盖后两边必须同时改）。
export const DEFAULT_LOCAL_GUIDE_TOKEN = 'local-guide-8f3c1a6e5d947b20';

const DEFAULT_EMPLOYEE = 'local-guide-writer';
const DEFAULT_ANSWER_TIMEOUT_SECONDS = 300;
const MIN_ANSWER_TIMEOUT_SECONDS = 10;
const MAX_ANSWER_TIMEOUT_SECONDS = 600;

/** 与连接器 GUIDE_FIELDS 严格一致：六字段，缺任一即判定失败，绝不放半成品过去。 */
const GUIDE_FIELDS = [
  'communication_history_summary',
  'current_email_summary',
  'buyer_other_info',
  'seller_reply_draft',
  'seller_action_guide',
  'reasoning_explanation',
] as const;

/** 原料包体积上限：与连接器 MATERIAL_JSON_MAX_CHARS(60000) 留出余量，防止撑爆上下文。 */
const MATERIAL_JSON_MAX_CHARS = 200000;
const MAX_RESULT_MESSAGES = 40;
const MAX_TEXT_CANDIDATE_LENGTH = 32_000;
const MAX_TOTAL_TEXT_LENGTH = 64_000;

/** 系统消息：只讲纪律，业务口径全部由 AI 员工的 about 提示词承担。 */
const SYSTEM_MESSAGE = [
  'You are running inside an automated background job triggered by an external service.',
  'Return exactly one valid JSON object and no surrounding Markdown (no ```json fences).',
  'Do not ask follow-up questions or ask the user to fill any table manually.',
  'The calling system will persist the record and bind it to the work order automatically.',
  'When information is missing, write 暂无相关信息 or 需人工核实 instead of requesting another message.',
].join('\n');

// ---------------------------------------------------------------------------
// 鉴权与配置
// ---------------------------------------------------------------------------

export function resolveLocalGuideToken(env: NodeJS.ProcessEnv = process.env) {
  const configured = String(env.LOCAL_GUIDE_TOKEN ?? '').trim();
  return configured || DEFAULT_LOCAL_GUIDE_TOKEN;
}

function readHeader(ctx: Context, name: string) {
  const headers = (ctx as any)?.headers || {};
  const raw = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(raw)) {
    return String(raw[0] ?? '');
  }
  if (raw !== undefined && raw !== null) {
    return String(raw);
  }
  const viaGet = typeof (ctx as any).get === 'function' ? (ctx as any).get(name) : undefined;
  return viaGet === undefined || viaGet === null ? '' : String(viaGet);
}

export function assertLocalGuideToken(ctx: Context) {
  const expected = resolveLocalGuideToken();
  const provided = readHeader(ctx, LOCAL_GUIDE_TOKEN_HEADER).trim();
  if (!provided || provided !== expected) {
    // 401 由调用方（连接器）转成 LOCAL_GUIDE_FAILED，错误信息里不泄露期望值。
    ctx.throw(401, 'invalid local guide token');
  }
}

// ---------------------------------------------------------------------------
// 入参归一化
// ---------------------------------------------------------------------------

type LocalGuideInput = {
  workOrderSerial: string;
  materialJson: string;
  knowledgeQuery: string;
  replyGreeting: string;
  buyerIssueType: string;
  additionalContext: string;
  toneAndLanguage: string;
  replyPreference: string;
  emailLength: string;
  currentDatetime: string;
  employee: string;
  answerTimeoutSeconds: number;
};

function textOf(value: unknown) {
  return value === null || value === undefined ? '' : String(value);
}

export function normalizeAnswerTimeoutSeconds(value: unknown, fallback = DEFAULT_ANSWER_TIMEOUT_SECONDS) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_ANSWER_TIMEOUT_SECONDS) {
    return fallback;
  }
  return Math.min(seconds, MAX_ANSWER_TIMEOUT_SECONDS);
}

export function parseLocalGuideInput(values: Record<string, any> = {}): LocalGuideInput {
  const materialJson = textOf(values.material_json ?? values.materialJson);
  if (!materialJson.trim()) {
    throw Object.assign(new Error('material_json is required'), { statusCode: 400 });
  }
  return {
    workOrderSerial: textOf(values.work_order_serial ?? values.workOrderSerial).trim(),
    materialJson,
    knowledgeQuery: textOf(values.knowledge_query ?? values.knowledgeQuery),
    replyGreeting: textOf(values.reply_greeting ?? values.replyGreeting),
    buyerIssueType: textOf(values.buyer_issue_type ?? values.buyerIssueType),
    additionalContext: textOf(values.additional_context ?? values.additionalContext),
    toneAndLanguage: textOf(values.tone_and_language ?? values.toneAndLanguage),
    replyPreference: textOf(values.reply_preference ?? values.replyPreference),
    emailLength: textOf(values.email_length ?? values.emailLength),
    currentDatetime: textOf(values.current_datetime ?? values.currentDatetime),
    employee: textOf(values.employee).trim() || DEFAULT_EMPLOYEE,
    answerTimeoutSeconds: normalizeAnswerTimeoutSeconds(values.answer_timeout_seconds ?? values.answerTimeoutSeconds),
  };
}

/**
 * 用户消息：原料包 + 工单提示。
 *
 * ⚠️ 末尾那句"检索语句"不是装饰，是**必需**的：
 * plugin-ai 的知识库检索（ai-employee.ts buildChatContext）取的是
 * **最后一条 user 消息的整段 content** 当向量检索 query。
 * 原料包本身最长 6 万字符，若把它当 query，检索结果会退化成噪声。
 * 因此把 knowledge_query（连接器 side 用 buildKnowledgeQuery 拼好的短语句）
 * 放在消息**最后**，让检索 query 与 Dify 路径的口径一致。
 */
export function buildUserMessage(input: LocalGuideInput) {
  const hints = {
    work_order_serial: input.workOrderSerial || null,
    reply_greeting: input.replyGreeting || null,
    buyer_issue_type: input.buyerIssueType || null,
    additional_context: input.additionalContext || null,
    tone_and_language_requirement: input.toneAndLanguage || null,
    reply_preference: input.replyPreference || null,
    email_length: input.emailLength || null,
    current_datetime: input.currentDatetime || null,
  };
  return [
    '请为下面这一个售后工单生成一条售后处理指南 JSON 记录（严格按你的角色提示词中的 6 字段格式）。',
    '',
    '【工单与回复偏好】',
    JSON.stringify(hints, null, 2),
    '',
    '【原料包】（已由上游系统一次性取好，包含工单/邮件历史表A/历史指南表B/订单物流/核查信息；' +
      '它只作为事实依据，不要拿它当知识库检索词）',
    input.materialJson,
    '',
    '【知识库检索语句】以上事实依据请结合下面这句检索到的知识库内容来判断与作答：',
    input.knowledgeQuery || '(本次没有提供检索语句，请按工单问题类型自行归纳)',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 模型输出 → 六字段
// ---------------------------------------------------------------------------

function normalizeTextCandidate(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeTextCandidate(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return [record.text];
    }
    if (typeof record.content === 'string') {
      return [record.content];
    }
    if (record.content) {
      return normalizeTextCandidate(record.content);
    }
  }
  return [];
}

/** 剥掉 ```json 围栏，再退化到"第一个 { 到最后一个 }"的抢救式解析。 */
export function parseJsonLoose(text: string) {
  const trimmed = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw error;
  }
}

/**
 * 提取模型输出的 JSON 对象。
 *
 * 两条来源，按可靠性排序：
 *   1) `aiMessages` 表（推荐）：AIEmployee 的 conversationMiddleware 会把 AI 回复以
 *      `{type:'text', content:<纯文本>}` 落库，取最后一条最省事、也最不怕返回结构变化；
 *   2) invoke 返回值 `result.messages`：倒序扫描逐条尝试解析（老版批量任务的做法）。
 */
export async function extractGuidePayload(
  result: any,
  options: { db?: any; sessionId?: string; employeeUsername?: string } = {},
) {
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  if (messages.length > MAX_RESULT_MESSAGES) {
    throw new Error(`AI answer produced too many messages (${messages.length})`);
  }

  const candidates: string[] = [];
  if (options.db && options.sessionId && options.employeeUsername) {
    try {
      const persisted = await options.db.getRepository('aiMessages').findOne({
        filter: { sessionId: options.sessionId, role: options.employeeUsername },
        sort: ['-messageId'],
      });
      const record = persisted && typeof persisted.toJSON === 'function' ? persisted.toJSON() : persisted;
      candidates.push(...normalizeTextCandidate(record?.content));
    } catch (error) {
      // 查库失败不影响主流程，退回扫描 invoke 结果。
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    candidates.push(...normalizeTextCandidate(messages[index]?.content));
  }

  let totalTextLength = 0;
  for (const candidate of candidates) {
    totalTextLength += candidate.length;
    if (candidate.length > MAX_TEXT_CANDIDATE_LENGTH) {
      throw new Error('AI answer was too long and was rejected');
    }
    if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) {
      throw new Error('AI answer exceeded the total text limit and was rejected');
    }
    try {
      return { payload: parseJsonLoose(candidate), rawText: candidate };
    } catch {
      continue;
    }
  }
  throw new Error('AI employee did not return a valid JSON guide payload');
}

/** 收敛为六字段字符串；缺任一即抛错（与连接器 GUIDE_FIELDS 校验口径一致）。 */
export function pickGuideFields(payload: any) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const fields: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of GUIDE_FIELDS) {
    const value = source[field];
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (!text) {
      missing.push(field);
      fields[field] = '';
      continue;
    }
    fields[field] = text;
  }
  return { fields, missing };
}

// ---------------------------------------------------------------------------
// AI 员工调用
// ---------------------------------------------------------------------------

/**
 * 构造 AIEmployee 需要的最小 ctx。
 *
 * ⚠️ 三条硬约束，动这段代码前务必读完（均有实证，见第 1 条）：
 *
 * 1) **绝不能把真实 koa ctx 传进来，也不能 `{...ctx}` 展开。**
 *    原因一：浏览器发出的请求带 `X-Timezone: Asia/Shanghai`（IANA 名），plugin-ai 的
 *      parseVariables 会无条件求值全部日期变量 → core/utils `utc2unit` →
 *      `moment.utcOffset(offsetFromString('Asia/Shanghai'))`；而 offsetFromString 只认
 *      ±HH:MM，返回 null，`utcOffset(null)` 当 getter 用返回**数字**，
 *      于是 `m.startOf is not a function` —— 经 HTTP 的 AI 调用 100% 崩在这。
 *      屏蔽办法就是 `get: () => undefined`（老版批量任务正是靠这个才跑通的）。
 *    原因二：展开会丢掉 koa 原型的 `get/throw/t` 等方法。
 *
 * 2) `state.currentRoles` 不能是空数组：plugin-ai 共享工具里空角色会落到
 *    `__NO_ACCESSIBLE_AI_EMPLOYEE__` 兜底分支。这里给 `['root']`
 *    （本插件自身 ACL 已放行 public，角色只影响 AI 工具的可见性）。
 *
 * 3) `auth.user.id` 必须能被数据库接受（aiConversations.userId 是 bigint）。
 *    外部服务调用没有 NocoBase 登录态，这里用 0；会话因此不归属任何用户，
 *    加上分类是 'task'，不会出现在任何人的聊天列表里（这是刻意的）。
 *
 * 参考实现：tasks/after-sales-guide-batch.ts 的 createTaskContext（后台任务版）。
 */
export function createLocalGuideContext(app: any, sessionId: string) {
  return {
    app,
    db: app.db,
    log: app.log,
    logger: app.log,
    state: { currentRoles: ['root'] },
    auth: { user: { id: 0 } },
    action: { params: { values: { sessionId } } },
    // ★ 屏蔽 x-timezone（见上面第 1 条），缺了它整个调用必炸。
    get: () => undefined,
    getCurrentLocale: () => 'zh-CN',
    t: (key: string) => key,
  } as any;
}

/**
 * 员工侧配置体检：只警告不阻断。
 *
 * - `systemPromptMode`：'raw' 会整段丢弃 systemMessage、'none' 连 about 都丢，
 *   两者都会让"只输出一个 JSON"的约束失效。
 * - `enableTools !== false`：工具全开时前端型工具（formFiller）可能触发
 *   human-in-the-loop 中断，结果里只有 __interrupt__ 而没有最终文本。
 */
function warnIfEmployeeMisconfigured(ctx: Context, employee: any) {
  const chatSettings =
    (() => {
      try {
        return typeof employee?.get === 'function' ? employee.get('chatSettings') : employee?.chatSettings;
      } catch {
        return null;
      }
    })() || {};
  const mode = String(chatSettings.systemPromptMode || 'default');
  if (mode === 'raw' || mode === 'none') {
    ctx.log.warn(
      `[local-guide] AI 员工 systemPromptMode=${mode}，systemMessage（JSON 输出约束）会被丢弃，请改回 default`,
    );
  }
  if (chatSettings.enableTools !== false) {
    ctx.log.warn('[local-guide] AI 员工未显式关闭工具（chatSettings.enableTools !== false），存在工具中断风险');
  }
}

async function invokeWithTimeout(aiEmployee: AIEmployee, input: any, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await aiEmployee.invoke({ ...input, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`AI answer exceeded ${Math.floor(timeoutMs / 1000)} seconds and was stopped`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------

async function generate(ctx: Context, next: Next) {
  assertLocalGuideToken(ctx);
  const input = parseLocalGuideInput(ctx.action.params.values || {});

  if (input.materialJson.length > MATERIAL_JSON_MAX_CHARS) {
    ctx.throw(413, `material_json too large: ${input.materialJson.length} > ${MATERIAL_JSON_MAX_CHARS}`);
  }

  const aiPlugin = ctx.app.pm.get('ai') as PluginAIServer;
  if (!aiPlugin?.aiEmployeesManager || !aiPlugin?.aiConversationsManager) {
    ctx.throw(503, 'AI plugin is not available');
  }

  const employee = await aiPlugin.aiEmployeesManager.getEmployee(input.employee);
  if (!employee) {
    ctx.throw(404, `AI employee "${input.employee}" not found`);
  }

  warnIfEmployeeMisconfigured(ctx, employee);

  const startedAt = Date.now();
  const conversation = await aiPlugin.aiConversationsManager.create({
    // 外部服务调用没有 NocoBase 用户；会话不归属任何用户，配合 category='task' 不进聊天列表。
    userId: undefined,
    aiEmployee: { username: input.employee },
    title: `local-guide:${input.workOrderSerial || 'unknown'}`.slice(0, 30),
    from: 'main-agent',
    options: { systemMessage: SYSTEM_MESSAGE },
    category: 'task',
  });

  const sessionId = conversation?.sessionId || (conversation as any)?.get?.('sessionId');
  if (!sessionId) {
    ctx.throw(500, 'failed to create AI conversation');
  }

  // 关键：必须像普通对话一样先解析员工绑定的模型，否则 AIEmployee 内部 model 为空，
  // 调 getLLMService({}) 会直接抛 "LLM service not configured"。
  const resolvedModel = await aiPlugin.aiEmployeesManager.resolveModel(employee);
  const aiEmployee = new AIEmployee({
    // ★ 注意：传的是 app，不是 koa ctx —— 原因见 createLocalGuideContext 的注释（x-timezone 崩溃）
    ctx: createLocalGuideContext(ctx.app, String(sessionId)),
    employee: employee as any,
    sessionId: String(sessionId),
    systemMessage: SYSTEM_MESSAGE,
    model: resolvedModel,
  });

  const result = await invokeWithTimeout(
    aiEmployee,
    {
      userMessages: [{ role: 'user', content: { type: 'text', content: buildUserMessage(input) } }],
    },
    input.answerTimeoutSeconds * 1000,
  );

  // 工具中断（human-in-the-loop）时没有最终文本，直接给出可诊断的错误而不是"解析不出 JSON"。
  const interrupts = (result as any)?.__interrupt__;
  if (Array.isArray(interrupts) && interrupts.length) {
    ctx.throw(
      409,
      'AI employee requested a tool/human interaction; local guide generation expects a single-shot JSON answer',
    );
  }

  const { payload, rawText } = await extractGuidePayload(result, {
    db: ctx.db,
    sessionId: String(sessionId),
    employeeUsername: input.employee,
  });
  const { fields, missing } = pickGuideFields(payload);
  if (missing.length) {
    ctx.throw(422, `AI employee output is missing required fields: ${missing.join(', ')}`);
  }

  const usage = (result as any)?.usage || {};
  const tokens = usage.total_tokens ?? usage.totalTokens ?? (result as any)?.total_tokens ?? null;

  ctx.log.info('[local-guide] 生成成功', {
    work_order_serial: input.workOrderSerial || null,
    employee: input.employee,
    session_id: sessionId,
    elapsed_ms: Date.now() - startedAt,
  });

  ctx.body = {
    success: true,
    fields,
    raw_text: String(rawText || '').slice(0, 20000),
    parse_ok: true,
    tokens: tokens === null || tokens === undefined ? null : Number(tokens),
    run_id: String(sessionId),
    employee: input.employee,
    elapsed_ms: Date.now() - startedAt,
  };
  await next();
}

export const LOCAL_GUIDE_ACTIONS = {
  generate,
};

export default LOCAL_GUIDE_ACTIONS;
