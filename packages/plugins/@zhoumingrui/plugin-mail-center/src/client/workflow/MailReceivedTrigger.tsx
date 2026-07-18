/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React from 'react';
import { Select } from 'antd';
import { useAPIClient, useRequest } from '@nocobase/client';
import { Trigger } from '@nocobase/plugin-workflow/client';
import type { MailAccount } from '../../client-common/types';
import { dataOf } from '../../client-common/types';
import { NAMESPACE } from '../locale';

function expr(key: string) {
  return `{{t(${JSON.stringify(key)}, { ns: ${JSON.stringify(NAMESPACE)} })}}`;
}

function MailAccountSelect(props: { value?: number[]; onChange?: (value: number[]) => void }) {
  const api = useAPIClient();
  const { data, loading } = useRequest(() => api.request({ url: 'mailCenter:accountsList', method: 'post' }));
  const accounts = dataOf<MailAccount[]>(data) || [];
  return (
    <Select
      mode="multiple"
      allowClear
      loading={loading}
      value={props.value}
      onChange={props.onChange}
      options={accounts.map((account) => ({ value: account.id, label: `${account.name} <${account.email}>` }))}
    />
  );
}

const variable = (label: string, value: string, type = 'string') => ({ label: expr(label), value, type });

export default class MailReceivedWorkflowTrigger extends Trigger {
  title = expr('Incoming email');
  description = expr('Triggered after a new email is synchronized and stored successfully.');
  fieldset = {
    accountIds: {
      type: 'array',
      title: expr('Mailboxes'),
      description: expr('Leave empty to listen to all mailboxes available to the current user.'),
      'x-decorator': 'FormItem',
      'x-component': 'MailAccountSelect',
    },
    matchMode: {
      type: 'string',
      title: expr('Condition mode'),
      default: 'all',
      enum: [
        { label: expr('Match all conditions'), value: 'all' },
        { label: expr('Match any condition'), value: 'any' },
      ],
      'x-decorator': 'FormItem',
      'x-component': 'Radio.Group',
    },
    fromContains: {
      type: 'string',
      title: expr('Sender contains'),
      'x-decorator': 'FormItem',
      'x-component': 'Input',
    },
    recipientContains: {
      type: 'string',
      title: expr('Recipient contains'),
      'x-decorator': 'FormItem',
      'x-component': 'Input',
    },
    subjectContains: {
      type: 'string',
      title: expr('Subject contains'),
      'x-decorator': 'FormItem',
      'x-component': 'Input',
    },
    bodyContains: {
      type: 'string',
      title: expr('Body contains'),
      'x-decorator': 'FormItem',
      'x-component': 'Input',
    },
    hasAttachments: {
      type: 'boolean',
      title: expr('Attachment requirement'),
      enum: [
        { label: expr('Any'), value: null },
        { label: expr('Has attachments'), value: true },
        { label: expr('No attachments'), value: false },
      ],
      'x-decorator': 'FormItem',
      'x-component': 'Select',
    },
    attachmentTypes: {
      type: 'array',
      title: expr('Attachment types'),
      description: expr('Enter MIME fragments or filename extensions, such as pdf or image/.'),
      'x-decorator': 'FormItem',
      'x-component': 'Select',
      'x-component-props': { mode: 'tags' },
    },
    includeSpam: {
      type: 'boolean',
      title: expr('Include spam'),
      default: false,
      'x-decorator': 'FormItem',
      'x-component': 'Switch',
    },
  };
  components = { MailAccountSelect };
  useVariables = () => [
    {
      label: expr('Email'),
      value: 'mail',
      children: [
        variable('Mail record ID', 'id', 'number'),
        variable('Mailbox ID', 'accountId', 'number'),
        variable('Message-ID', 'messageId'),
        variable('Thread ID', 'threadId'),
        variable('Sender', 'from', 'array'),
        variable('Recipients', 'to', 'array'),
        variable('Cc', 'cc', 'array'),
        variable('Subject', 'subject'),
        variable('Plain text body', 'text'),
        variable('HTML body', 'html'),
        variable('Received at', 'receivedAt', 'date'),
        variable('Has attachments', 'hasAttachments', 'boolean'),
        variable('Attachments', 'attachments', 'array'),
      ],
    },
  ];
}
