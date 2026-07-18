/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MailAddress, MailReceivedTriggerConfig, ReceivedMailContext } from '../types';

function normalized(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() || '';
}

function addressText(addresses: MailAddress[]): string {
  return addresses
    .map((item) => `${item.name || ''} ${item.address}`)
    .join(' ')
    .toLocaleLowerCase();
}

export function matchesMailTrigger(config: MailReceivedTriggerConfig, mail: ReceivedMailContext): boolean {
  if (mail.mailbox === 'spam' && !config.includeSpam) {
    return false;
  }

  if (config.accountIds?.length && !config.accountIds.some((id) => String(id) === String(mail.accountId))) {
    return false;
  }

  const conditions: boolean[] = [];
  const fromContains = normalized(config.fromContains);
  const recipientContains = normalized(config.recipientContains);
  const subjectContains = normalized(config.subjectContains);
  const bodyContains = normalized(config.bodyContains);

  if (fromContains) {
    conditions.push(addressText(mail.from).includes(fromContains));
  }
  if (recipientContains) {
    conditions.push(addressText([...mail.to, ...mail.cc]).includes(recipientContains));
  }
  if (subjectContains) {
    conditions.push(mail.subject.toLocaleLowerCase().includes(subjectContains));
  }
  if (bodyContains) {
    conditions.push(`${mail.text} ${mail.html}`.toLocaleLowerCase().includes(bodyContains));
  }
  if (typeof config.hasAttachments === 'boolean') {
    conditions.push(mail.hasAttachments === config.hasAttachments);
  }
  if (config.attachmentTypes?.length) {
    const expectedTypes = config.attachmentTypes.map(normalized);
    conditions.push(
      mail.attachments.some((attachment) => {
        const contentType = normalized(attachment.contentType);
        const filename = normalized(attachment.filename);
        return expectedTypes.some((type) => contentType.includes(type) || filename.endsWith(`.${type}`));
      }),
    );
  }

  if (!conditions.length) {
    return true;
  }
  return config.matchMode === 'any' ? conditions.some(Boolean) : conditions.every(Boolean);
}
