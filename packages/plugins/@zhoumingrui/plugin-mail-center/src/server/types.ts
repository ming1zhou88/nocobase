/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MailAccountData {
  id: number;
  ownerId: number;
  name: string;
  email: string;
  senderName?: string;
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  syncIntervalMinutes: number;
  lastUid: number;
  uidValidity?: string;
  lastSyncedAt?: string | Date;
}

export interface OutgoingAttachment {
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface OutgoingMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
}

export interface StoredAttachmentContext {
  id: number;
  filename: string;
  contentType?: string;
  size: number;
}

export interface ReceivedMailContext {
  id: number;
  accountId: number;
  ownerId: number;
  mailbox: string;
  messageId?: string;
  threadId?: string;
  inReplyTo?: string;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  subject: string;
  text: string;
  html: string;
  receivedAt: string;
  isRead: boolean;
  hasAttachments: boolean;
  attachments: StoredAttachmentContext[];
}

export interface MailReceivedTriggerConfig {
  accountIds?: Array<number | string>;
  matchMode?: 'all' | 'any';
  fromContains?: string;
  recipientContains?: string;
  subjectContains?: string;
  bodyContains?: string;
  hasAttachments?: boolean;
  attachmentTypes?: string[];
  includeSpam?: boolean;
}
