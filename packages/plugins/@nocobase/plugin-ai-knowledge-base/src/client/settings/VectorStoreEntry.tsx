/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useState } from 'react';
import { Alert, App, Button, Card, Form, Input, InputNumber, Select, Space, Switch, Table, Typography } from 'antd';
import { useAPIClient, useRequest } from '@nocobase/client';
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

type VectorDatabase = { id: string; key: string; name: string; enabled: boolean };
type LlmService = { name: string; title?: string; provider?: string; enabled: boolean };
type VectorStore = VectorStoreForm & { id: string; initializedAt?: string };

const recordsOf = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'object' || value === null) return [];
  return recordsOf<T>((value as { data?: unknown }).data);
};

export const VectorStoreEntry = () => {
  const api = useAPIClient();
  const t = useT();
  const { message } = App.useApp();
  const [form] = Form.useForm<VectorStoreForm>();
  const [saving, setSaving] = useState(false);
  const [initializingStoreId, setInitializingStoreId] = useState<string>();
  const { data: databasesData, loading: databasesLoading } = useRequest(() =>
    api.resource('aiKnowledgeVectorDatabases').list({ pageSize: 100, filter: { enabled: true } }),
  );
  const { data: servicesData, loading: servicesLoading } = useRequest(() =>
    api.resource('llmServices').list({ pageSize: 100, filter: { enabled: true } }),
  );
  const {
    data,
    refresh,
    loading: storesLoading,
  } = useRequest(() => api.resource('aiKnowledgeVectorStores').list({ pageSize: 100 }));
  const databases = recordsOf<VectorDatabase>(databasesData);
  const services = recordsOf<LlmService>(servicesData);
  const stores = recordsOf<VectorStore>(data);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      await api.resource('aiKnowledgeVectorStores').create({ values });
      message.success(t('Vector store saved'));
      form.resetFields();
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleInitialize = async (id: string) => {
    setInitializingStoreId(id);
    try {
      const response = await api.request({
        url: `aiKnowledgeVector:initializeVectorStore/${id}`,
        method: 'post',
      });
      const result = response.data?.data ?? response.data;
      message.success(t('Vector index initialized: {{table}}', { table: result.table }));
      refresh();
    } finally {
      setInitializingStoreId(undefined);
    }
  };

  return (
    <Card title={t('Vector store')}>
      <Typography.Paragraph type="secondary">
        {t(
          'A vector store binds a pgvector database to an embedding model. The dimensions must match the selected embedding model.',
        )}
      </Typography.Paragraph>
      {!databasesLoading && databases.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t('Create and save a vector database before creating a vector store.')}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<VectorStoreForm>
        form={form}
        layout="vertical"
        style={{ maxWidth: 640 }}
        initialValues={{ embeddingModel: 'text-embedding-3-small', dimensions: 1536, enabled: true }}
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
        <Form.Item
          label={t('Vector database')}
          name="vectorDatabaseId"
          rules={[{ required: true, message: t('Vector database is required') }]}
        >
          <Select
            loading={databasesLoading}
            options={databases.map((database) => ({
              value: database.id,
              label: `${database.name} (${database.key})`,
            }))}
          />
        </Form.Item>
        <Form.Item
          label={t('Embedding provider')}
          name="llmServiceName"
          rules={[{ required: true, message: t('Embedding provider is required') }]}
          extra={t('Uses an enabled LLM service configured in AI Employees.')}
        >
          <Select
            loading={servicesLoading}
            options={services.map((service) => ({
              value: service.name,
              label: `${service.title ?? service.name}${service.provider ? ` (${service.provider})` : ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          label={t('Embedding model')}
          name="embeddingModel"
          rules={[{ required: true, message: t('Embedding model is required') }]}
          extra={t(
            'The model and dimensions must match. OpenAI text-embedding-3-small uses 1536 dimensions by default.',
          )}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          label={t('Dimensions')}
          name="dimensions"
          rules={[{ required: true, message: t('Dimensions are required') }]}
        >
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label={t('Enabled')} name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={handleSave} loading={saving} disabled={databases.length === 0}>
            {t('Save')}
          </Button>
        </Space>
      </Form>
      <Table<VectorStore>
        loading={storesLoading}
        style={{ marginTop: 32 }}
        dataSource={stores}
        rowKey="id"
        pagination={false}
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
            render: (_, record) => (
              <Button
                size="small"
                loading={initializingStoreId === record.id}
                onClick={() => handleInitialize(record.id)}
              >
                {t('Initialize index')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
};
