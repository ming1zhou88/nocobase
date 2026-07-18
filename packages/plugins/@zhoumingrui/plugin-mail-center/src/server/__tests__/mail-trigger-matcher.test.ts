/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { ReceivedMailContext } from '../types';
import { matchesMailTrigger } from '../workflow/mail-trigger-matcher';

const mail: ReceivedMailContext = {
  id: 1,
  accountId: 7,
  ownerId: 2,
  mailbox: 'inbox',
  messageId: '<message@example.com>',
  threadId: '<thread@example.com>',
  from: [{ name: 'Customer', address: 'customer@example.com' }],
  to: [{ address: 'support@example.com' }],
  cc: [],
  replyTo: [],
  subject: 'Urgent contract review',
  text: 'Please review the attached contract.',
  html: '',
  receivedAt: '2026-07-17T00:00:00.000Z',
  isRead: false,
  hasAttachments: true,
  attachments: [{ id: 3, filename: 'contract.pdf', contentType: 'application/pdf', size: 1024 }],
};

describe('incoming mail workflow matcher', () => {
  it('matches all configured conditions', () => {
    expect(
      matchesMailTrigger(
        {
          accountIds: [7],
          matchMode: 'all',
          fromContains: '@example.com',
          subjectContains: 'contract',
          hasAttachments: true,
          attachmentTypes: ['pdf'],
        },
        mail,
      ),
    ).toBe(true);
  });

  it('supports any-condition matching', () => {
    expect(
      matchesMailTrigger({ matchMode: 'any', subjectContains: 'not present', bodyContains: 'attached contract' }, mail),
    ).toBe(true);
  });

  it('excludes spam unless explicitly enabled', () => {
    expect(matchesMailTrigger({}, { ...mail, mailbox: 'spam' })).toBe(false);
    expect(matchesMailTrigger({ includeSpam: true }, { ...mail, mailbox: 'spam' })).toBe(true);
  });

  it('rejects a non-matching mailbox account', () => {
    expect(matchesMailTrigger({ accountIds: [8] }, mail)).toBe(false);
  });
});
