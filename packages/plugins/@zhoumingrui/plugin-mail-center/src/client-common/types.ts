/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type MailRequest = (action: string, values?: Record<string, unknown>, filterByTk?: number) => Promise<unknown>;

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MailAttachment {
  id: number;
  filename: string;
  contentType?: string;
  size: number;
}

export interface MailAccount {
  id: number;
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
  syncIntervalMinutes: number;
  lastSyncedAt?: string;
  status?: string;
  lastError?: string;
}

export interface MailMessage {
  id: number;
  accountId: number;
  box: string;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  text: string;
  html: string;
  receivedAt?: string;
  sentAt?: string;
  isRead: boolean;
  isTodo: boolean;
  hasAttachments: boolean;
  attachments?: MailAttachment[];
  labels?: Array<{ id: number; name: string; color?: string }>;
  note?: string;
}

export interface MessageListResult {
  rows: MailMessage[];
  count: number;
  page: number;
  pageSize: number;
}

export interface LabelRecord {
  id?: number;
  name: string;
  color?: string;
}

export interface TemplateRecord {
  id?: number;
  name: string;
  subject?: string;
  content?: string;
}

export interface SignatureRecord {
  id?: number;
  accountId: number;
  content?: string;
}

export function dataOf<T>(value: unknown): T {
  if (typeof value === 'object' && value !== null && 'data' in value) {
    return dataOf<T>((value as { data: unknown }).data);
  }
  return value as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
