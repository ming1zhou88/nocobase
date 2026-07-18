/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';
import type { MailAccountData, OutgoingMessage } from '../types';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class SmtpService {
  private createTransport(account: MailAccountData): Transporter {
    return nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: {
        user: account.username,
        pass: account.password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async verify(account: MailAccountData) {
    const transport = this.createTransport(account);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  async send(account: MailAccountData, message: OutgoingMessage): Promise<SentMessageInfo> {
    const attachments = (message.attachments || []).map((attachment) => {
      const content = Buffer.from(attachment.contentBase64, 'base64');
      if (content.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Attachment ${attachment.filename} exceeds 10 MB`);
      }
      return {
        filename: attachment.filename,
        contentType: attachment.contentType,
        content,
      };
    });
    const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.content.length, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('Total attachment size exceeds 25 MB');
    }

    const transport = this.createTransport(account);
    try {
      return await transport.sendMail({
        from: { name: account.senderName || account.name, address: account.email },
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        inReplyTo: message.inReplyTo,
        references: message.references,
        attachments,
      });
    } finally {
      transport.close();
    }
  }
}
