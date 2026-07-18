/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  type TableColumnsType,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import type { LabelRecord, MailAccount, MailRequest, SignatureRecord, TemplateRecord, Translate } from './types';
import { dataOf, errorMessage } from './types';

interface SettingsDrawerProps {
  open: boolean;
  accounts: MailAccount[];
  request: MailRequest;
  t: Translate;
  onClose: () => void;
  onAccountsChanged: () => Promise<void>;
}

type AccountForm = Omit<MailAccount, 'id'> & { id?: number; password?: string };

function AccountSettings(props: Omit<SettingsDrawerProps, 'open' | 'onClose'>) {
  const { accounts, onAccountsChanged, request, t } = props;
  const { message } = App.useApp();
  const [form] = Form.useForm<AccountForm>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busyId, setBusyId] = useState<number>();

  const openEditor = (record?: MailAccount) => {
    form.resetFields();
    form.setFieldsValue(
      record || {
        enabled: true,
        imapPort: 993,
        imapSecure: true,
        smtpPort: 465,
        smtpSecure: true,
        syncIntervalMinutes: 5,
      },
    );
    setOpen(true);
  };

  const testCurrent = async () => {
    setTesting(true);
    try {
      const values = await form.validateFields();
      await request('accountCheck', values as unknown as Record<string, unknown>);
      message.success(t('Connection succeeded'));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      await request('accountSave', values as unknown as Record<string, unknown>);
      message.success(t('Mailbox saved'));
      setOpen(false);
      await onAccountsChanged();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const runSavedAction = async (action: 'accountTest' | 'accountSync' | 'accountDelete', id: number) => {
    setBusyId(id);
    try {
      await request(action, undefined, id);
      message.success(
        t(
          action === 'accountDelete'
            ? 'Mailbox deleted'
            : action === 'accountSync'
              ? 'Sync completed'
              : 'Connection succeeded',
        ),
      );
      await onAccountsChanged();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setBusyId(undefined);
    }
  };

  const columns: TableColumnsType<MailAccount> = [
    { title: t('Mailbox'), dataIndex: 'name' },
    { title: t('Email'), dataIndex: 'email' },
    {
      title: t('Status'),
      dataIndex: 'status',
      render: (status: string) => (
        <Tag color={status === 'ready' ? 'success' : status === 'error' ? 'error' : 'default'}>
          {status || 'pending'}
        </Tag>
      ),
    },
    {
      title: t('Last synced at'),
      dataIndex: 'lastSyncedAt',
      render: (value?: string) => (value ? new Date(value).toLocaleString() : '-'),
    },
    {
      title: t('Actions'),
      key: 'actions',
      render: (_, record) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(record)}>
            {t('Edit')}
          </Button>
          <Button size="small" onClick={() => runSavedAction('accountTest', record.id)} loading={busyId === record.id}>
            {t('Test connection')}
          </Button>
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={() => runSavedAction('accountSync', record.id)}
            loading={busyId === record.id}
          >
            {t('Resync')}
          </Button>
          <Popconfirm title={t('Delete this mailbox?')} onConfirm={() => runSavedAction('accountDelete', record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              {t('Delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()} style={{ marginBottom: 16 }}>
        {t('Link email')}
      </Button>
      <Table rowKey="id" columns={columns} dataSource={accounts} pagination={false} scroll={{ x: 900 }} />
      <Modal
        width={720}
        open={open}
        title={t('Mailbox')}
        onCancel={() => setOpen(false)}
        destroyOnClose
        footer={
          <Space>
            <Button onClick={testCurrent} loading={testing}>
              {t('Test connection')}
            </Button>
            <Button type="primary" onClick={save} loading={saving}>
              {t('Save')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t('Mailbox name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t('Email')} rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="senderName" label={t('Sender name')}>
            <Input />
          </Form.Item>
          <Form.Item name="username" label={t('Username')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t('Password')} tooltip={t('Leave blank to keep the saved password')}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Space align="start" wrap>
            <Form.Item name="imapHost" label={t('IMAP host')} rules={[{ required: true }]}>
              <Input style={{ width: 260 }} />
            </Form.Item>
            <Form.Item name="imapPort" label={t('IMAP port')} rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} />
            </Form.Item>
            <Form.Item name="imapSecure" label={t('IMAP TLS')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="smtpHost" label={t('SMTP host')} rules={[{ required: true }]}>
              <Input style={{ width: 260 }} />
            </Form.Item>
            <Form.Item name="smtpPort" label={t('SMTP port')} rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} />
            </Form.Item>
            <Form.Item name="smtpSecure" label={t('SMTP TLS')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="syncIntervalMinutes" label={t('Sync interval (minutes)')}>
            <InputNumber min={1} max={1440} />
          </Form.Item>
          <Form.Item name="enabled" label={t('Enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

type SettingRecord = LabelRecord | TemplateRecord | SignatureRecord;

interface SimpleSettingsProps {
  type: 'labels' | 'templates' | 'signatures';
  accounts: MailAccount[];
  request: MailRequest;
  t: Translate;
}

function SimpleSettings({ accounts, request, t, type }: SimpleSettingsProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Record<string, unknown>>();
  const [records, setRecords] = useState<SettingRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request('settingsList', { type });
      setRecords(dataOf<SettingRecord[]>(result) || []);
    } finally {
      setLoading(false);
    }
  }, [request, type]);

  useEffect(() => {
    load().catch((error) => message.error(errorMessage(error)));
  }, [load, message]);

  const edit = (record?: SettingRecord) => {
    form.resetFields();
    if (record) form.setFieldsValue(record as unknown as Record<string, unknown>);
    setOpen(true);
  };

  const save = async () => {
    try {
      const record = await form.validateFields();
      await request('settingsSave', { type, record });
      message.success(t('Saved successfully'));
      setOpen(false);
      await load();
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  const destroy = async (id: number) => {
    await request('settingsDelete', { type, id });
    await load();
  };

  const columns: TableColumnsType<SettingRecord> = [
    type === 'signatures'
      ? {
          title: t('Mailbox'),
          dataIndex: 'accountId',
          render: (accountId: number) => accounts.find((account) => account.id === accountId)?.email || accountId,
        }
      : { title: t(type === 'labels' ? 'Label' : 'Name'), dataIndex: 'name' },
    ...(type === 'labels' ? [{ title: t('Color'), dataIndex: 'color' }] : []),
    ...(type === 'templates' ? [{ title: t('Subject'), dataIndex: 'subject' }] : []),
    {
      title: t('Actions'),
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => edit(record)}>
            {t('Edit')}
          </Button>
          <Popconfirm title={t('Delete this record?')} onConfirm={() => record.id && destroy(record.id)}>
            <Button size="small" danger>
              {t('Delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()} style={{ marginBottom: 16 }}>
        {t('Add new')}
      </Button>
      <Table
        rowKey={(record) => String(record.id)}
        columns={columns}
        dataSource={records}
        loading={loading}
        pagination={false}
      />
      <Modal
        open={open}
        title={t(type === 'labels' ? 'Label' : type === 'templates' ? 'Template' : 'Signature')}
        onCancel={() => setOpen(false)}
        onOk={save}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          {type === 'signatures' ? (
            <Form.Item name="accountId" label={t('Mailbox')} rules={[{ required: true }]}>
              <Select options={accounts.map((account) => ({ value: account.id, label: account.email }))} />
            </Form.Item>
          ) : (
            <Form.Item name="name" label={t(type === 'labels' ? 'Label' : 'Name')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          )}
          {type === 'labels' && (
            <Form.Item name="color" label={t('Color')}>
              <Input placeholder="blue" />
            </Form.Item>
          )}
          {type === 'templates' && (
            <Form.Item name="subject" label={t('Subject')}>
              <Input />
            </Form.Item>
          )}
          {type !== 'labels' && (
            <Form.Item name="content" label={t('Content')}>
              <Input.TextArea rows={8} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { accounts, onAccountsChanged, onClose, open, request, t } = props;
  return (
    <Drawer width="min(1100px, 92vw)" open={open} onClose={onClose} title={t('Email settings')} destroyOnClose>
      <Tabs
        items={[
          {
            key: 'mailboxes',
            label: t('Mailbox'),
            children: (
              <AccountSettings accounts={accounts} request={request} t={t} onAccountsChanged={onAccountsChanged} />
            ),
          },
          {
            key: 'labels',
            label: t('Labels'),
            children: <SimpleSettings type="labels" accounts={accounts} request={request} t={t} />,
          },
          {
            key: 'templates',
            label: t('Manage templates'),
            children: <SimpleSettings type="templates" accounts={accounts} request={request} t={t} />,
          },
          {
            key: 'signatures',
            label: t('Signature'),
            children: <SimpleSettings type="signatures" accounts={accounts} request={request} t={t} />,
          },
        ]}
      />
    </Drawer>
  );
}
