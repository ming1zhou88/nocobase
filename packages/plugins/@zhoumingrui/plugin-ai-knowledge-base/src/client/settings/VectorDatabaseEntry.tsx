/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import React, { useState } from 'react';
import { Alert, App, Button, Card, Form, Input, InputNumber, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { useAPIClient, useRequest } from '@nocobase/client';
import { useT } from '../locale';

type VectorDatabaseForm = {
  key: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  enabled: boolean;
};

type VectorDatabase = Omit<VectorDatabaseForm, 'password'> & { id: string };
type ConnectionResult = { connected?: boolean; extensionVersion?: string; error?: string; data?: ConnectionResult };

const recordsOf = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'object' || value === null) return [];
  return recordsOf<T>((value as { data?: unknown }).data);
};

const connectionResultOf = (value: unknown): ConnectionResult => {
  if (typeof value !== 'object' || value === null) return {};
  const result = value as ConnectionResult;
  return result.data ?? result;
};

const errorMessageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const VectorDatabaseEntry = () => {
  const api = useAPIClient();
  const t = useT();
  const { message } = App.useApp();
  const [form] = Form.useForm<VectorDatabaseForm>();
  const [connectionResult, setConnectionResult] = useState<ConnectionResult>();
  const [formConnectionVerified, setFormConnectionVerified] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingRecordId, setTestingRecordId] = useState<string>();
  const [deletingRecordId, setDeletingRecordId] = useState<string>();
  const {
    data,
    refresh,
    loading: listLoading,
  } = useRequest(() => api.resource('aiKnowledgeVectorDatabases').list({ pageSize: 100 }));
  const records = recordsOf<VectorDatabase>(data);

  const showConnectionResult = (value: unknown, verifiesCurrentForm = false) => {
    const result = connectionResultOf(value);
    setConnectionResult(result);
    if (verifiesCurrentForm) {
      setFormConnectionVerified(Boolean(result.connected));
    }
    if (result.connected) {
      message.success(
        t('Connection succeeded. pgvector version: {{version}}', { version: result.extensionVersion ?? '-' }),
      );
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const values = await form.validateFields();
      const response = await api.request({
        url: 'aiKnowledgeVector:checkConnection',
        method: 'post',
        data: { values },
      });
      showConnectionResult(response.data, true);
    } catch (error) {
      setFormConnectionVerified(false);
      if (error instanceof Error) {
        setConnectionResult({ connected: false, error: error.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const { password: _password, ...metadata } = values;
      await api.resource('aiKnowledgeVectorDatabases').create({ values: { ...metadata, provider: 'pgvector' } });
      message.success(t('Vector database saved'));
      form.resetFields();
      setConnectionResult(undefined);
      setFormConnectionVerified(false);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleTestSavedConnection = async (id: string) => {
    setTestingRecordId(id);
    try {
      const response = await api.request({
        url: `aiKnowledgeVector:testSavedConnection/${id}`,
        method: 'post',
      });
      showConnectionResult(response.data);
    } catch (error) {
      const errorMessage = errorMessageOf(error);
      setConnectionResult({ connected: false, error: errorMessage });
      message.error(t('Connection failed: {{error}}', { error: errorMessage }));
    } finally {
      setTestingRecordId(undefined);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingRecordId(id);
    try {
      await api.resource('aiKnowledgeVectorDatabases').destroy({ filterByTk: id });
      message.success(t('Vector database deleted'));
      refresh();
    } finally {
      setDeletingRecordId(undefined);
    }
  };

  return (
    <Card title={t('Vector database')}>
      <Typography.Paragraph type="secondary">
        {t('Configure the PostgreSQL database where pgvector stores knowledge base embeddings.')}
      </Typography.Paragraph>
      {connectionResult ? (
        <Alert
          showIcon
          type={connectionResult.connected ? 'success' : 'error'}
          message={
            connectionResult.connected
              ? t('Connection succeeded. pgvector version: {{version}}', {
                  version: connectionResult.extensionVersion ?? '-',
                })
              : t('Connection failed: {{error}}', { error: connectionResult.error ?? t('Unknown error') })
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<VectorDatabaseForm>
        form={form}
        layout="vertical"
        style={{ maxWidth: 640 }}
        initialValues={{ host: '127.0.0.1', port: 5432, database: 'nocobase_kb', username: 'nocobase', enabled: true }}
        onValuesChange={() => setFormConnectionVerified(false)}
      >
        <Form.Item
          label={t('Key')}
          name="key"
          rules={[{ required: true, message: t('Key is required') }]}
          extra={t('Used as a stable programmatic identifier. Avoid changing it after creation.')}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label={t('Name')} name="name" rules={[{ required: true, message: t('Name is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label={t('Host')} name="host" rules={[{ required: true, message: t('Host is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label={t('Port')} name="port" rules={[{ required: true, message: t('Port is required') }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label={t('Database')}
          name="database"
          rules={[{ required: true, message: t('Database is required') }]}
          extra={t('The database must have the pgvector extension enabled.')}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          label={t('Username')}
          name="username"
          rules={[{ required: true, message: t('Username is required') }]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          label={t('Password')}
          name="password"
          rules={[{ required: true, message: t('Password is required') }]}
          extra={t(
            'Used only for this connection test. Saved connections read the password from the server environment.',
          )}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item label={t('Enabled')} name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={handleTestConnection} loading={testing}>
            {t('Test connection')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!formConnectionVerified}>
            {t('Save')}
          </Button>
        </Space>
      </Form>
      <Table<VectorDatabase>
        loading={listLoading}
        style={{ marginTop: 32 }}
        dataSource={records}
        rowKey="id"
        pagination={false}
        columns={[
          { title: t('Key'), dataIndex: 'key' },
          { title: t('Name'), dataIndex: 'name' },
          { title: t('Host'), dataIndex: 'host' },
          { title: t('Database'), dataIndex: 'database' },
          { title: t('Enabled'), dataIndex: 'enabled', render: (enabled: boolean) => (enabled ? t('Yes') : t('No')) },
          {
            title: t('Actions'),
            render: (_, record) => (
              <Space>
                <Button
                  size="small"
                  loading={testingRecordId === record.id}
                  onClick={() => handleTestSavedConnection(record.id)}
                >
                  {t('Test connection')}
                </Button>
                <Popconfirm
                  title={t('Delete this vector database connection?')}
                  onConfirm={() => handleDelete(record.id)}
                >
                  <Button danger size="small" loading={deletingRecordId === record.id}>
                    {t('Delete')}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
};
