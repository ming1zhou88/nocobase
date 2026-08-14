import { AIEmployee } from '@nocobase/plugin-ai';
import PluginAIServer from '@nocobase/plugin-ai';
import { CancelError, TaskType } from '@nocobase/plugin-async-task-manager';
import type { Model } from '@nocobase/database';
import { connectorClient } from '../services/connector-client';

export const AFTER_SALES_GUIDE_BATCH_TASK_TYPE = 'after-sales:guide-batch';

const DEFAULT_ANSWER_TIMEOUT_SECONDS = 60;
const MIN_ANSWER_TIMEOUT_SECONDS = 10;
const MAX_ANSWER_TIMEOUT_SECONDS = 300;
const MAX_RESULT_MESSAGES = 40;
const MAX_TEXT_CANDIDATE_LENGTH = 24_000;
const MAX_TOTAL_TEXT_LENGTH = 48_000;

type BatchTaskParams = {
  ids: number[];
  employeeUsername: string;
  userId?: number;
  currentRoles?: unknown[];
  answerTimeoutSeconds?: number;
};

type WorkOrderRecord = Record<string, any>;

const BATCH_SYSTEM_MESSAGE = [
  'You are running inside a background batch job.',
  'Return exactly one valid JSON object and no surrounding Markdown.',
  'Do not ask follow-up questions or ask the user to fill any table manually.',
  'The system will create the AIAfterSalesGuide record and refresh download snapshots automatically.',
  'When information is missing, write 不确定 or 需人工核实 according to the existing after-sales rules instead of requesting another message.',
].join('\n');

function formatDateTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeTextCandidate(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') {
        return [item];
      }
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') {
          return [item.text];
        }
        if (typeof item.content === 'string') {
          return [item.content];
        }
      }
      return [];
    });
  }
  if (value && typeof value === 'object') {
    const content = (value as Record<string, unknown>).content;
    if (typeof content === 'string') {
      return [content];
    }
  }
  return [];
}

async function invokeWithTimeout<T>(
  aiEmployee: AIEmployee,
  input: Parameters<AIEmployee['invoke']>[0],
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return (await aiEmployee.invoke({
      ...input,
      signal: controller.signal,
    })) as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`AI answer exceeded ${Math.floor(timeoutMs / 1000)} seconds and was stopped`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAnswerTimeoutSeconds(value: unknown) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_ANSWER_TIMEOUT_SECONDS) {
    return DEFAULT_ANSWER_TIMEOUT_SECONDS;
  }
  return Math.min(seconds, MAX_ANSWER_TIMEOUT_SECONDS);
}

function tryParseJson(text: string) {
  const trimmed = text
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
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw error;
  }
}

function extractGuidePayload(result: any) {
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  if (messages.length > MAX_RESULT_MESSAGES) {
    throw new Error(`AI answer produced too many messages (${messages.length}) and was stopped`);
  }

  let totalTextLength = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const candidates = normalizeTextCandidate(message?.content);
    for (const candidate of candidates) {
      totalTextLength += candidate.length;
      if (candidate.length > MAX_TEXT_CANDIDATE_LENGTH) {
        throw new Error('AI answer was too long and was stopped');
      }
      if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) {
        throw new Error('AI answer exceeded the total text limit and was stopped');
      }
      try {
        return tryParseJson(candidate);
      } catch {
        continue;
      }
    }
  }
  throw new Error('AI employee did not return a valid JSON guide payload');
}

function pickLatestBuyerEmailRecord(records: WorkOrderRecord[]) {
  return records.find((record) => record?.email_source === '买家') || records[0] || null;
}

function buildUserMessage(workOrder: WorkOrderRecord, emailRecord: WorkOrderRecord) {
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

async function buildRoles(app: any, userId?: number): Promise<string[]> {
  if (!userId) {
    return [];
  }
  const rows = await app.db.getRepository('rolesUsers').find({ filter: { userId } });
  return Array.from(
    new Set(
      rows
        .map((row: any) => row.roleName)
        .filter((role: unknown): role is string => typeof role === 'string' && role.length > 0),
    ),
  );
}

function createTaskContext(app: any, sessionId: string, userId?: number, currentRoles: unknown[] = []) {
  const normalizedRoles = currentRoles.filter((role): role is string => typeof role === 'string' && role.length > 0);
  return {
    app,
    db: app.db,
    log: app.log,
    logger: app.log,
    state: { currentRoles: normalizedRoles },
    auth: { user: { id: userId || 0 } },
    action: { params: { values: { sessionId } } },
    getCurrentLocale: () => 'zh-CN',
    get: () => undefined,
    t: (key: string) => key,
  } as any;
}

export class AfterSalesGuideBatchTask extends TaskType {
  static type = AFTER_SALES_GUIDE_BATCH_TASK_TYPE;

  async execute() {
    const params = (this.record.params || {}) as BatchTaskParams;
    const ids = Array.isArray(params.ids) ? params.ids.filter((id) => Number.isInteger(id) && id > 0) : [];
    if (!ids.length) {
      throw new Error('No work orders selected for after-sales batch processing');
    }

    const configuredRoles = Array.isArray(params.currentRoles)
      ? params.currentRoles.filter((role): role is string => typeof role === 'string' && role.length > 0)
      : [];
    const currentRoles = (
      configuredRoles.length ? configuredRoles : await buildRoles(this.app, params.userId)
    ) as string[];
    const answerTimeoutSeconds = normalizeAnswerTimeoutSeconds(params.answerTimeoutSeconds);
    const answerTimeoutMs = answerTimeoutSeconds * 1000;
    const aiPlugin = this.app.pm.get('ai') as PluginAIServer;
    if (!aiPlugin?.aiEmployeesManager || !aiPlugin?.aiConversationsManager) {
      throw new Error('AI plugin is not available');
    }

    const employee = await aiPlugin.aiEmployeesManager.getEmployee(params.employeeUsername);
    if (!employee) {
      throw new Error(`AI employee "${params.employeeUsername}" not found`);
    }

    const { records } = await connectorClient.getWorkOrdersByIds(ids);
    const total = ids.length;
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    this.reportProgress({ total, current: 0 });

    for (const id of ids) {
      if (this.isCanceled) {
        throw new CancelError();
      }

      const workOrder = records.find((item) => Number(item.id) === id);
      if (!workOrder) {
        failed += 1;
        completed += 1;
        this.reportProgress({ total, current: completed });
        continue;
      }

      if (workOrder.has_ai_guide === '是') {
        skipped += 1;
        await connectorClient.updateWorkOrders([id], {
          processing_status: 'skipped',
          processing_error: null,
          last_task_id: String(this.record.id),
          last_processed_at: new Date().toISOString(),
        });
        completed += 1;
        this.reportProgress({ total, current: completed });
        continue;
      }

      await connectorClient.updateWorkOrders([id], {
        processing_status: 'processing',
        processing_error: null,
        last_task_id: String(this.record.id),
        last_processed_at: new Date().toISOString(),
      });

      try {
        const trackingEmail = await connectorClient.getTrackingEmail(String(workOrder.order_id || ''));
        const emailRecord = pickLatestBuyerEmailRecord(trackingEmail.records || []);
        if (!emailRecord) {
          throw new Error(`No Email4Final record found for order ${workOrder.order_id}`);
        }

        const conversation = await aiPlugin.aiConversationsManager.create({
          userId: params.userId ? String(params.userId) : undefined,
          aiEmployee: { username: params.employeeUsername },
          title: String(workOrder.order_id || '').slice(0, 30),
          from: 'main-agent',
          options: {
            systemMessage: BATCH_SYSTEM_MESSAGE,
          },
          category: 'task',
        });

        const taskContext = createTaskContext(this.app, conversation.sessionId, params.userId, currentRoles);
        const aiEmployee = new AIEmployee({
          ctx: taskContext,
          employee: employee as Model,
          sessionId: conversation.sessionId,
          systemMessage: BATCH_SYSTEM_MESSAGE,
        });

        const result = await invokeWithTimeout<any>(
          aiEmployee,
          {
            userMessages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  content: buildUserMessage(workOrder, emailRecord),
                },
              },
            ],
          },
          answerTimeoutMs,
        );

        const guidePayload = extractGuidePayload(result);
        const guideCreateResponse = await connectorClient.createAfterSalesGuide(guidePayload);
        const guideRecord = guideCreateResponse.record;
        const guideId = Number(guideRecord?.id);
        if (!Number.isInteger(guideId) || guideId <= 0) {
          throw new Error('Failed to create AIAfterSalesGuide record');
        }

        await connectorClient.refreshAfterSalesGuideDownloads(guideId);
        await connectorClient.updateWorkOrders([id], {
          has_ai_guide: '是',
          ai_guide_id: guideId,
          ai_guide_generated_at: new Date().toISOString(),
          processing_status: 'succeeded',
          processing_error: null,
          last_task_id: String(this.record.id),
          last_processed_at: new Date().toISOString(),
        });
      } catch (error) {
        failed += 1;
        await connectorClient.updateWorkOrders([id], {
          processing_status: 'failed',
          processing_error: error instanceof Error ? error.message : String(error),
          last_task_id: String(this.record.id),
          last_processed_at: new Date().toISOString(),
        });
      }

      completed += 1;
      this.reportProgress({ total, current: completed });
    }

    return {
      total,
      completed,
      failed,
      skipped,
      answerTimeoutSeconds,
    };
  }
}
