/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import React from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Space, Switch, Table, Typography } from 'antd';
import { useRequest } from 'ahooks';
import { useFlowContext } from '@nocobase/flow-engine';
import { useT } from '../locale';

type VectorDatabaseForm = {
  key: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  enabled: boolean;
};

type ConnectionResult = { connected?: boolean; extensionVersion?: string; error?: string; data?: ConnectionResult };

export default function VectorDatabasePage() {
  const context = useFlowContext();
  const t = useT();
  const [form] = Form.useForm<VectorDatabaseForm>();
  const {
    data: listData,
    loading: listLoading,
    refresh: refreshList,
  } = useRequest(() =>
    context.api.request({ url: 'aiKnowledgeVectorDatabases:list', method: 'get', params: { pageSize: 100 } }),
  );
  const {
    run: testConnection,
    data,
    loading,
  } = useRequest(
    (values: VectorDatabaseForm) =>
      context.api.request({ url: 'aiKnowledgeVector:checkConnection', method: 'post', data: { values } }),
    { manual: true },
  );
  const { run: save, loading: saving } = useRequest(
    async () => {
      const values = await form.validateFields();
      const { password: _password, ...metadata } = values;
      return context.api.request({
        url: 'aiKnowledgeVectorDatabases:create',
        method: 'post',
        data: { ...metadata, provider: 'pgvector' },
      });
    },
    {
      manual: true,
      onSuccess() {
        context.message.success(t('Vector database saved'));
        form.resetFields();
        refreshList();
      },
    },
  );

  const responseData = data?.data as ConnectionResult | undefined;
  const result = responseData?.data ?? responseData;
  const rows = listData?.data?.data ?? [];

  return (
    <Card title={t('Vector database')}>
      <Typography.Paragraph type="secondary">
        {t('Configure the PostgreSQL database where pgvector stores knowledge base embeddings.')}
      </Typography.Paragraph>
      {result ? (
        <Alert
          showIcon
          type={result.connected ? 'success' : 'error'}
          message={
            result.connected
              ? t('Connection succeeded. pgvector version: {{version}}', { version: result.extensionVersion })
              : t('Connection failed: {{error}}', { error: result.error })
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<VectorDatabaseForm>
        form={form}
        layout="vertical"
        initialValues={{ host: '127.0.0.1', port: 5432, database: 'nocobase_kb', username: 'nocobase', enabled: true }}
        style={{ maxWidth: 640 }}
      >
        <Form.Item name="key" label={t('Key')} rules={[{ required: true, message: t('Key is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="name" label={t('Name')} rules={[{ required: true, message: t('Name is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="host" label={t('Host')} rules={[{ required: true, message: t('Host is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="port" label={t('Port')} rules={[{ required: true, message: t('Port is required') }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="database"
          label={t('Database')}
          rules={[{ required: true, message: t('Database is required') }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="username"
          label={t('Username')}
          rules={[{ required: true, message: t('Username is required') }]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('Password')}
          rules={[{ required: true, message: t('Password is required') }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="enabled" label={t('Enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={async () => testConnection(await form.validateFields())} loading={loading}>
            {t('Test connection')}
          </Button>
          <Button onClick={save} loading={saving} disabled={!result?.connected}>
            {t('Save')}
          </Button>
        </Space>
      </Form>
      <Table
        loading={listLoading}
        dataSource={rows}
        rowKey="id"
        pagination={false}
        style={{ marginTop: 32 }}
        columns={[
          { title: t('Key'), dataIndex: 'key' },
          { title: t('Name'), dataIndex: 'name' },
          { title: t('Host'), dataIndex: 'host' },
          { title: t('Database'), dataIndex: 'database' },
          { title: t('Enabled'), dataIndex: 'enabled', render: (enabled: boolean) => (enabled ? t('Yes') : t('No')) },
        ]}
      />
    </Card>
  );
}
