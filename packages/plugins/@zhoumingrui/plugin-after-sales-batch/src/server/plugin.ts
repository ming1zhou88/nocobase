import { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import type { AsyncTasksManager } from '@nocobase/plugin-async-task-manager';
import { connectorClient } from './services/connector-client';
import { AfterSalesGuideBatchTask, AFTER_SALES_GUIDE_BATCH_TASK_TYPE } from './tasks/after-sales-guide-batch';

const DEFAULT_ANSWER_TIMEOUT_SECONDS = 180;
const MIN_ANSWER_TIMEOUT_SECONDS = 10;
const MAX_ANSWER_TIMEOUT_SECONDS = 300;
// 批处理工作台默认选中的 AI 员工；列表加载后优先排在第一位。
const DEFAULT_AFTER_SALES_EMPLOYEE_USERNAME = '88xntp2sr1j';

type EmployeeLike = {
  username?: unknown;
  nickname?: unknown;
  position?: unknown;
  profile?: unknown;
  enabled?: unknown;
  deprecated?: unknown;
  toJSON?: () => EmployeeLike;
  get?: (key: string) => unknown;
};

function readField(record: EmployeeLike | null | undefined, key: string): unknown {
  if (!record) {
    return undefined;
  }
  const plain = typeof record.toJSON === 'function' ? record.toJSON() : record;
  const fromPlain = (plain as Record<string, unknown>)[key];
  if (fromPlain !== undefined) {
    return fromPlain;
  }
  if (typeof record.get === 'function') {
    return record.get(key);
  }
  return undefined;
}

function normalizeAnswerTimeoutSeconds(value: unknown) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_ANSWER_TIMEOUT_SECONDS) {
    return DEFAULT_ANSWER_TIMEOUT_SECONDS;
  }
  return Math.min(seconds, MAX_ANSWER_TIMEOUT_SECONDS);
}

async function listWorkOrders(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listWorkOrders(ctx.action.params.values || {});
  await next();
}

async function listReplyGreetings(ctx: Context, next: Next) {
  ctx.body = await connectorClient.listReplyGreetings();
  await next();
}

async function createWorkOrders(ctx: Context, next: Next) {
  const records = Array.isArray(ctx.action.params.values?.records) ? ctx.action.params.values.records : [];
  ctx.body = await connectorClient.createWorkOrders(records);
  await next();
}

async function deleteWorkOrders(ctx: Context, next: Next) {
  ctx.body = await connectorClient.deleteWorkOrders(ctx.action.params.values?.ids || []);
  await next();
}

async function updateWorkOrders(ctx: Context, next: Next) {
  ctx.body = await connectorClient.updateWorkOrders(
    ctx.action.params.values?.ids || [],
    ctx.action.params.values?.values || {},
  );
  await next();
}

async function listEmployees(ctx: Context, next: Next) {
  const merged: EmployeeLike[] = [];

  try {
    const aiPlugin = ctx.app.pm.get('ai') as {
      aiEmployeesManager?: {
        listEmployees?: () => Promise<EmployeeLike[]>;
      };
    };
    const managerRecords = await aiPlugin?.aiEmployeesManager?.listEmployees?.();
    if (Array.isArray(managerRecords)) {
      merged.push(...managerRecords);
    }
  } catch (error) {
    ctx.logger?.warn?.('Failed to list AI employees from manager, fallback to repository.');
  }

  const repository = ctx.db.getRepository('aiEmployees');
  const dbRecords = (await repository.find({
    filter: {
      enabled: true,
      deprecated: false,
    },
    sort: ['sort', 'username'],
  })) as EmployeeLike[];
  merged.push(...dbRecords);

  const recordMap = new Map<string, { username: string; nickname: string }>();
  for (const item of merged) {
    const username = String(readField(item, 'username') || '').trim();
    if (!username || recordMap.has(username)) {
      continue;
    }
    if (readField(item, 'enabled') === false || readField(item, 'deprecated') === true) {
      continue;
    }
    const profile = readField(item, 'profile');
    const profileName =
      profile && typeof profile === 'object' ? String((profile as Record<string, unknown>).name || '') : '';
    const nickname = String(
      readField(item, 'nickname') || readField(item, 'position') || profileName || username,
    ).trim();
    recordMap.set(username, {
      username,
      nickname: nickname || username,
    });
  }

  const records = [...recordMap.values()].sort((a, b) => a.nickname.localeCompare(b.nickname));

  // 默认员工置顶，保证批处理工作台默认选中它。
  const defaultIndex = records.findIndex((record) => record.username === DEFAULT_AFTER_SALES_EMPLOYEE_USERNAME);
  if (defaultIndex > 0) {
    const [defaultEmployee] = records.splice(defaultIndex, 1);
    records.unshift(defaultEmployee);
  }

  ctx.body = {
    success: true,
    records,
  };
  await next();
}

async function getSettings(ctx: Context, next: Next) {
  ctx.body = {
    success: true,
    answerTimeoutSeconds: DEFAULT_ANSWER_TIMEOUT_SECONDS,
    minAnswerTimeoutSeconds: MIN_ANSWER_TIMEOUT_SECONDS,
    maxAnswerTimeoutSeconds: MAX_ANSWER_TIMEOUT_SECONDS,
  };
  await next();
}

async function startBatch(ctx: Context, next: Next) {
  const ids = Array.isArray(ctx.action.params.values?.ids) ? ctx.action.params.values.ids : [];
  const employeeUsername = String(ctx.action.params.values?.employeeUsername || '').trim();
  if (!ids.length) {
    ctx.throw(400, 'Please select at least one work order');
  }
  if (!employeeUsername) {
    ctx.throw(400, 'Please select an AI employee');
  }

  const taskManager = ctx.app.container.get('AsyncTaskManager') as AsyncTasksManager;
  if (!taskManager) {
    ctx.throw(500, 'AsyncTaskManager is not available');
  }

  const currentUserId = ctx.auth?.user?.id || ctx.state?.currentUser?.id;
  const answerTimeoutSeconds = normalizeAnswerTimeoutSeconds(ctx.action.params.values?.answerTimeoutSeconds);
  const currentRoles = Array.isArray(ctx.state?.currentRoles)
    ? ctx.state.currentRoles
    : ctx.state?.currentRoles
      ? [ctx.state.currentRoles]
      : [];

  const task = await taskManager.createTask(
    {
      origin: 'afterSalesBatch',
      type: AFTER_SALES_GUIDE_BATCH_TASK_TYPE,
      title: `After-sales batch - ${ids.length}`,
      params: {
        ids,
        employeeUsername,
        userId: currentUserId,
        currentRoles,
        answerTimeoutSeconds,
      },
      createdById: currentUserId,
      cancelable: true,
    },
    {
      useQueue: true,
      context: ctx,
    },
  );

  ctx.body = task.toJSON();
  await next();
}

async function getTask(ctx: Context, next: Next) {
  // asyncTasks 的主键是 UUID 字符串，前端把 startBatch 返回的 task id 原样回传。
  const taskId = String(ctx.action.params.values?.taskId ?? '').trim();
  if (!taskId) {
    ctx.throw(400, 'taskId is required');
  }
  const task = await ctx.db.getRepository('asyncTasks').findOne({
    filter: {
      id: taskId,
    },
  });
  if (!task) {
    ctx.throw(404, 'task not found');
  }
  ctx.body = task.toJSON();
  await next();
}

async function getGuide(ctx: Context, next: Next) {
  const guideId = Number(ctx.action.params.values?.guideId);
  if (!Number.isInteger(guideId) || guideId <= 0) {
    ctx.throw(400, 'guideId is required');
  }
  ctx.body = await connectorClient.getAfterSalesGuide(guideId);
  await next();
}

async function saveGuideActualReply(ctx: Context, next: Next) {
  const guideId = Number(ctx.action.params.values?.guideId);
  if (!Number.isInteger(guideId) || guideId <= 0) {
    ctx.throw(400, 'guideId is required');
  }
  const actualReplyBody = String(ctx.action.params.values?.actualReplyBody ?? '').trim();
  ctx.body = await connectorClient.updateAfterSalesGuideActualReply(guideId, actualReplyBody);
  await next();
}

export class PluginAfterSalesBatchServer extends Plugin {
  private taskRegistered = false;

  afterAdd() {
    this.app.on('afterLoad', () => this.registerTaskType());
  }

  private registerTaskType() {
    if (this.taskRegistered) {
      return;
    }
    try {
      const taskManager = this.app.container.get('AsyncTaskManager') as AsyncTasksManager;
      taskManager.registerTaskType(AfterSalesGuideBatchTask);
      this.taskRegistered = true;
    } catch (error) {
      this.log.warn('AsyncTaskManager is not available, skip after-sales batch task registration.');
    }
  }

  async load() {
    this.registerTaskType();

    this.app.resourceManager.define({
      name: 'afterSalesBatch',
      actions: {
        listWorkOrders,
        listReplyGreetings,
        createWorkOrders,
        deleteWorkOrders,
        updateWorkOrders,
        listEmployees,
        getSettings,
        startBatch,
        getTask,
        getGuide,
        saveGuideActualReply,
      },
    });

    this.app.acl.allow(
      'afterSalesBatch',
      [
        'listWorkOrders',
        'listReplyGreetings',
        'createWorkOrders',
        'deleteWorkOrders',
        'updateWorkOrders',
        'listEmployees',
        'getSettings',
        'startBatch',
        'getTask',
        'getGuide',
        'saveGuideActualReply',
      ],
      'loggedIn',
    );
    this.app.acl.registerSnippet({
      name: `pm.${this.name}`,
      actions: ['afterSalesBatch:*'],
    });
  }
}

export default PluginAfterSalesBatchServer;
