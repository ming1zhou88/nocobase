import type { Context, Next } from '@nocobase/actions';
import { connectorClient } from './services/connector-client';

/**
 * 二次回复：NocoBase 只做薄转发，业务在连接器。
 *
 * 资源：secondReply
 * 动作：checkReady / refresh / generate / send
 */

function readActionId(ctx: Context) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const raw = ctx.action.params?.filterByTk ?? values.e3Id ?? values.e3_id ?? values.id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) ctx.throw(400, 'e3Id is required');
  return id;
}

export async function checkSecondReplyReadyAction(ctx: Context, next: Next) {
  ctx.body = await connectorClient.checkSecondReplyReady(readActionId(ctx));
  await next();
}

export async function refreshSecondReplyAction(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const dailyRowId = Number(values.daily_row_id ?? values.dailyRowId);
  if (!Number.isInteger(dailyRowId) || dailyRowId <= 0) ctx.throw(400, 'daily_row_id is required');
  ctx.body = await connectorClient.refreshSecondReply(dailyRowId);
  await next();
}

export async function generateSecondReplyAction(ctx: Context, next: Next) {
  ctx.body = await connectorClient.generateSecondReply(readActionId(ctx));
  await next();
}

export async function sendSecondReplyAction(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const dryRun = Boolean(values.dry_run ?? values.dryRun);
  ctx.body = await connectorClient.sendSecondReply(readActionId(ctx), dryRun);
  await next();
}

export const SECOND_REPLY_RESOURCE = 'secondReply';
export const SECOND_REPLY_ACTIONS = {
  checkReady: checkSecondReplyReadyAction,
  refresh: refreshSecondReplyAction,
  generate: generateSecondReplyAction,
  send: sendSecondReplyAction,
};
