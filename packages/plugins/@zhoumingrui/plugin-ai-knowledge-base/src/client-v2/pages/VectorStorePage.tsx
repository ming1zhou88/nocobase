/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import React from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Switch, Table, Typography } from 'antd';
import { useRequest } from 'ahooks';
import { useFlowContext } from '@nocobase/flow-engine';
import { useT } from '../locale';

type VectorStoreForm = {
  key: string;
  name: string;
  vectorDatabaseId: string;
  llmServiceName: string;
  embeddingModel: string;
  dimensions: number;
  enabled: boolean;
};

export default function VectorStorePage() {
  const context = useFlowContext();
  const t = useT();
  const [form] = Form.useForm<VectorStoreForm>();
  const { data: databaseData, loading: databasesLoading } = useRequest(() =>
    context.api.request({
      url: 'aiKnowledgeVectorDatabases:list',
      method: 'get',
      params: { pageSize: 100, filter: { enabled: true } },
    }),
  );
  const {
    data: storeData,
    loading: storesLoading,
    refresh,
  } = useRequest(() =>
    context.api.request({ url: 'aiKnowledgeVectorStores:list', method: 'get', params: { pageSize: 100 } }),
  );
  const { data: llmServiceData, loading: llmServicesLoading } = useRequest(() =>
    context.api.request({
      url: 'llmServices:list',
      method: 'get',
      params: { pageSize: 100, filter: { enabled: true } },
    }),
  );
  const { run: save, loading: saving } = useRequest(
    async () => {
      const values = await form.validateFields();
      return context.api.request({ url: 'aiKnowledgeVectorStores:create', method: 'post', data: values });
    },
    {
      manual: true,
      onSuccess() {
        context.message.success(t('Vector store saved'));
        form.resetFields();
        refresh();
      },
    },
  );
  const { run: initializeStore, loading: initializing } = useRequest(
    (id: string) => context.api.request({ url: `aiKnowledgeVector:initializeVectorStore/${id}`, method: 'post' }),
    {
      manual: true,
      onSuccess(response) {
        const result = response.data?.data ?? response.data;
        context.message.success(t('Vector index initialized: {{table}}', { table: result.table }));
        refresh();
      },
    },
  );
  const databases = databaseData?.data?.data ?? [];
  const stores = storeData?.data?.data ?? [];
  const llmServices = llmServiceData?.data?.data ?? [];

  return (
    <Card title={t('Vector store')}>
      <Typography.Paragraph type="secondary">
        {t(
          'A vector store binds a pgvector database to an embedding model. The dimensions must match the selected embedding model.',
        )}
      </Typography.Paragraph>
      {databases.length === 0 && !databasesLoading ? (
        <Alert
          type="warning"
          showIcon
          message={t('Create and save a vector database before creating a vector store.')}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<VectorStoreForm> form={form} layout="vertical" initialValues={{ enabled: true }} style={{ maxWidth: 640 }}>
        <Form.Item name="key" label={t('Key')} rules={[{ required: true, message: t('Key is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="name" label={t('Name')} rules={[{ required: true, message: t('Name is required') }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="vectorDatabaseId"
          label={t('Vector database')}
          rules={[{ required: true, message: t('Vector database is required') }]}
        >
          <Select
            loading={databasesLoading}
            options={databases.map((item: { id: string; name: string; key: string }) => ({
              value: item.id,
              label: `${item.name} (${item.key})`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="llmServiceName"
          label={t('Embedding provider')}
          rules={[{ required: true, message: t('Embedding provider is required') }]}
        >
          <Select
            loading={llmServicesLoading}
            options={llmServices.map((item: { name: string; title?: string; provider: string }) => ({
              value: item.name,
              label: `${item.title ?? item.name} (${item.provider})`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="embeddingModel"
          label={t('Embedding model')}
          rules={[{ required: true, message: t('Embedding model is required') }]}
        >
          <Input placeholder="text-embedding-3-small" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="dimensions"
          label={t('Dimensions')}
          rules={[{ required: true, message: t('Dimensions are required') }]}
        >
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="enabled" label={t('Enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={save} loading={saving} disabled={databases.length === 0}>
            {t('Save')}
          </Button>
        </Space>
      </Form>
      <Table
        loading={storesLoading}
        dataSource={stores}
        rowKey="id"
        pagination={false}
        style={{ marginTop: 32 }}
        columns={[
          { title: t('Key'), dataIndex: 'key' },
          { title: t('Name'), dataIndex: 'name' },
          { title: t('Embedding provider'), dataIndex: 'llmServiceName' },
          { title: t('Embedding model'), dataIndex: 'embeddingModel' },
          { title: t('Dimensions'), dataIndex: 'dimensions' },
          {
            title: t('Index status'),
            dataIndex: 'initializedAt',
            render: (value?: string) => (value ? t('Ready') : t('Not initialized')),
          },
          { title: t('Enabled'), dataIndex: 'enabled', render: (enabled: boolean) => (enabled ? t('Yes') : t('No')) },
          {
            title: t('Actions'),
            render: (_value: unknown, record: { id: string }) => (
              <Button size="small" loading={initializing} onClick={() => initializeStore(record.id)}>
                {t('Initialize index')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
