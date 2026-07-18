/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { useEffect, useState } from 'react';
import { App, Button, DatePicker, Form, Input, Modal, Select, Space, Upload, type UploadFile } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import type { MailAccount, MailRequest, Translate } from './types';
import { errorMessage } from './types';

interface ComposeFormValues {
  accountId: number;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  content?: string;
  scheduledAt?: { toISOString: () => string };
}

interface ComposeModalProps {
  open: boolean;
  accounts: MailAccount[];
  request: MailRequest;
  t: Translate;
  onClose: () => void;
  onSent: () => Promise<void>;
}

function splitAddresses(value?: string): string[] {
  return (value || '')
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

export function ComposeModal(props: ComposeModalProps) {
  const { accounts, onClose, onSent, open, request, t } = props;
  const { message } = App.useApp();
  const [form] = Form.useForm<ComposeFormValues>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState<'send' | 'bulk' | 'draft' | 'schedule'>();

  useEffect(() => {
    if (open && accounts.length && !form.getFieldValue('accountId')) {
      form.setFieldValue('accountId', accounts[0].id);
    }
  }, [accounts, form, open]);

  const buildMessage = async (values: ComposeFormValues) => {
    const attachments = await Promise.all(
      files.map(async (upload) => {
        if (!upload.originFileObj) {
          throw new Error(t('Attachment file is unavailable'));
        }
        return {
          filename: upload.name,
          contentType: upload.type,
          contentBase64: await fileToBase64(upload.originFileObj),
        };
      }),
    );
    return {
      to: splitAddresses(values.to),
      cc: splitAddresses(values.cc),
      bcc: splitAddresses(values.bcc),
      subject: values.subject,
      text: values.content || '',
      html: '',
      attachments,
    };
  };

  const finish = async (mode: 'send' | 'bulk' | 'draft' | 'schedule') => {
    setSubmitting(mode);
    try {
      const values = await form.validateFields();
      const outgoing = await buildMessage(values);
      if (mode === 'bulk') {
        const recipients = outgoing.to;
        await request('bulkSend', {
          accountId: values.accountId,
          recipients,
          message: { ...outgoing, to: undefined },
        });
        message.success(t('Bulk sending completed'));
      } else if (mode === 'schedule') {
        if (!values.scheduledAt) {
          throw new Error(t('Scheduled time is required'));
        }
        await request('schedule', {
          accountId: values.accountId,
          message: outgoing,
          scheduledAt: values.scheduledAt.toISOString(),
        });
        message.success(t('Email scheduled'));
      } else {
        await request(mode === 'draft' ? 'saveDraft' : 'send', {
          accountId: values.accountId,
          message: outgoing,
        });
        message.success(t(mode === 'draft' ? 'Draft saved' : 'Email sent'));
      }
      form.resetFields();
      setFiles([]);
      onClose();
      await onSent();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSubmitting(undefined);
    }
  };

  return (
    <Modal
      width={760}
      open={open}
      title={t('Write email')}
      onCancel={onClose}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={() => finish('draft')} loading={submitting === 'draft'}>
            {t('Save draft')}
          </Button>
          <Button onClick={() => finish('bulk')} loading={submitting === 'bulk'}>
            {t('Bulk send')}
          </Button>
          <Button onClick={() => finish('schedule')} loading={submitting === 'schedule'}>
            {t('Schedule')}
          </Button>
          <Button type="primary" onClick={() => finish('send')} loading={submitting === 'send'}>
            {t('Send')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="accountId" label={t('From')} rules={[{ required: true }]}>
          <Select
            options={accounts
              .filter((account) => account.enabled)
              .map((account) => ({
                value: account.id,
                label: `${account.name} <${account.email}>`,
              }))}
          />
        </Form.Item>
        <Form.Item name="to" label={t('To')} rules={[{ required: true, message: t('Recipient is required') }]}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} placeholder={t('Separate addresses with commas')} />
        </Form.Item>
        <Form.Item name="cc" label={t('Cc')}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} />
        </Form.Item>
        <Form.Item name="bcc" label={t('Bcc')}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} />
        </Form.Item>
        <Form.Item name="subject" label={t('Subject')} rules={[{ required: true, message: t('Subject is required') }]}>
          <Input />
        </Form.Item>
        <Form.Item name="content" label={t('Content')}>
          <Input.TextArea rows={10} />
        </Form.Item>
        <Form.Item name="scheduledAt" label={t('Scheduled time')}>
          <DatePicker showTime />
        </Form.Item>
        <Form.Item label={t('Attachments')}>
          <Upload multiple fileList={files} beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList)}>
            <Button icon={<PaperClipOutlined />}>{t('Upload')}</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
