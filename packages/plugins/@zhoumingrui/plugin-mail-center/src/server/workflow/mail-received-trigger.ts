/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Trigger, type WorkflowModel } from '@nocobase/plugin-workflow';
import type WorkflowPlugin from '@nocobase/plugin-workflow';
import type { MailReceivedTriggerConfig, ReceivedMailContext } from '../types';
import { matchesMailTrigger } from './mail-trigger-matcher';

const TRIGGER_TYPE = 'mail-received';

export class MailReceivedTrigger extends Trigger {
  static TYPE = TRIGGER_TYPE;

  schedule(mail: ReceivedMailContext) {
    const run = () => {
      this.dispatch(mail).catch((error: unknown) => {
        this.workflow.app.logger.error('[Mail center] failed to dispatch incoming-mail workflows', { error });
      });
    };
    setTimeout(run, 0);
  }

  private async dispatch(mail: ReceivedMailContext) {
    const workflows = Array.from(this.workflow.enabledCache.values())
      .filter((workflow) => workflow.type === TRIGGER_TYPE)
      .sort((left, right) => left.id - right.id);
    const matched = workflows.filter((workflow) =>
      matchesMailTrigger((workflow.config || {}) as MailReceivedTriggerConfig, mail),
    );

    if (!matched.length) {
      await this.updateStatus(mail.id, 'skipped');
      return;
    }

    const errors: string[] = [];
    for (const workflow of matched) {
      try {
        await this.triggerWorkflow(workflow, mail);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${workflow.key}: ${message}`);
        this.workflow.app.logger.error('[Mail center] incoming-mail workflow failed', {
          error,
          workflowId: workflow.id,
          workflowKey: workflow.key,
          mailMessageId: mail.id,
        });
      }
    }

    await this.updateStatus(mail.id, errors.length ? 'failed' : 'triggered', errors.join('\n'));
  }

  private async triggerWorkflow(workflow: WorkflowModel, mail: ReceivedMailContext) {
    await this.workflow.trigger(workflow, { mail });
  }

  private async updateStatus(messageId: number, status: string, workflowError?: string) {
    await this.workflow.app.db.getRepository('mailMessages').update({
      filterByTk: messageId,
      values: { workflowStatus: status, workflowError: workflowError || null },
    });
  }
}

export default MailReceivedTrigger;
