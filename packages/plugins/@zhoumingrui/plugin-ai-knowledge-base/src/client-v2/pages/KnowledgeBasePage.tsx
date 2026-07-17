/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import React from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { useRequest } from 'ahooks';
import { useFlowContext } from '@nocobase/flow-engine';
import { useT } from '../locale';

type KnowledgeBaseForm = {
  key: string;
  name: string;
  description?: string;
  vectorStoreId: string;
  topK: number;
  enabled: boolean;
};
type SearchForm = { knowledgeBaseId: string; query: string; topK?: number };
type FileForm = { knowledgeBaseId: string };

export default function KnowledgeBasePage() {
  const ctx = useFlowContext();
  const t = useT();
  const [form] = Form.useForm<KnowledgeBaseForm>();
  const [searchForm] = Form.useForm<SearchForm>();
  const [fileForm] = Form.useForm<FileForm>();
  const [fileList, setFileList] = React.useState<UploadFile[]>([]);
  const [searchResults, setSearchResults] = React.useState<
    Array<{ content: string; score: number; title: string; chunkIndex: number }>
  >([]);
  const { data: storesData, loading: storesLoading } = useRequest(() =>
    ctx.api.request({
      url: 'aiKnowledgeVectorStores:list',
      method: 'get',
      params: { pageSize: 100, filter: { enabled: true } },
    }),
  );
  const {
    data: basesData,
    loading: basesLoading,
    refresh,
  } = useRequest(() => ctx.api.request({ url: 'aiKnowledgeBases:list', method: 'get', params: { pageSize: 100 } }));
  const { run: save, loading: saving } = useRequest(
    async () =>
      ctx.api.request({
        url: 'aiKnowledgeBases:create',
        method: 'post',
        data: await form.validateFields(),
      }),
    {
      manual: true,
      onSuccess: () => {
        ctx.message.success(t('Knowledge base saved'));
        form.resetFields();
        refresh();
      },
    },
  );
  const stores = (storesData?.data?.data ?? []).filter((store: { initializedAt?: string }) => store.initializedAt);
  const bases = basesData?.data?.data ?? [];
  const {
    data: documentsData,
    loading: documentsLoading,
    refresh: refreshDocuments,
  } = useRequest(() =>
    ctx.api.request({
      url: 'aiKnowledgeDocuments:list',
      method: 'get',
      params: { pageSize: 100, sort: '-createdAt', appends: ['knowledgeBase'] },
    }),
  );
  const { run: search, loading: searching } = useRequest(
    async () =>
      ctx.api.request({ url: 'aiKnowledgeVector:search', method: 'post', data: await searchForm.validateFields() }),
    {
      manual: true,
      onSuccess: (response) => {
        const payload: unknown = response.data.data;
        const records = Array.isArray(payload)
          ? payload
          : typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload as { data?: unknown }).data
            : [];
        setSearchResults(Array.isArray(records) ? records : []);
      },
    },
  );
  const ingestFiles: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    try {
      const values = await fileForm.validateFields();
      const rawFile = file as File;
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Unable to read file.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(rawFile);
      });
      await ctx.api.request({
        url: 'aiKnowledgeVector:ingestFile',
        method: 'post',
        data: { ...values, filename: rawFile.name, mimeType: rawFile.type, contentBase64 },
      });
      onSuccess?.({});
      refreshDocuments();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  return (
    <Card title={t('Knowledge base')}>
      <Typography.Paragraph type="secondary">
        {t('A knowledge base groups documents that AI employees can retrieve.')}
      </Typography.Paragraph>
      {!storesLoading && stores.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t('Initialize a vector store before creating a knowledge base.')}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form form={form} layout="vertical" initialValues={{ topK: 5, enabled: true }} style={{ maxWidth: 640 }}>
        <Form.Item name="key" label={t('Key')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="name" label={t('Name')} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label={t('Description')}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="vectorStoreId" label={t('Vector store')} rules={[{ required: true }]}>
          <Select
            options={stores.map((s: { id: string; name: string; key: string }) => ({
              value: s.id,
              label: `${s.name} (${s.key})`,
            }))}
          />
        </Form.Item>
        <Form.Item name="topK" label={t('Top K')} rules={[{ required: true }]}>
          <InputNumber min={1} max={50} />
        </Form.Item>
        <Form.Item name="enabled" label={t('Enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={save} loading={saving} disabled={!stores.length}>
            {t('Save')}
          </Button>
        </Space>
      </Form>
      <Table
        loading={basesLoading}
        dataSource={bases}
        rowKey="id"
        pagination={false}
        style={{ marginTop: 32 }}
        columns={[
          { title: t('Key'), dataIndex: 'key' },
          { title: t('Name'), dataIndex: 'name' },
          { title: t('Top K'), dataIndex: 'topK' },
          { title: t('Enabled'), dataIndex: 'enabled', render: (v: boolean) => (v ? t('Yes') : t('No')) },
        ]}
      />
      <Card title={t('Test retrieval')} style={{ marginTop: 32 }}>
        <Typography.Paragraph type="secondary">
          {t('Ask a question and verify the most relevant indexed chunks before enabling AI Employee retrieval.')}
        </Typography.Paragraph>
        <Form form={searchForm} layout="vertical" initialValues={{ topK: 5 }} style={{ maxWidth: 760 }}>
          <Form.Item name="knowledgeBaseId" label={t('Knowledge base')} rules={[{ required: true }]}>
            <Select
              options={bases
                .filter((base: { enabled: boolean }) => base.enabled)
                .map((base: { id: string; name: string; key: string }) => ({
                  value: base.id,
                  label: `${base.name} (${base.key})`,
                }))}
            />
          </Form.Item>
          <Form.Item name="query" label={t('Question')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="topK" label={t('Top K')}>
            <InputNumber min={1} max={50} />
          </Form.Item>
          <Button type="primary" onClick={search} loading={searching}>
            {t('Search')}
          </Button>
        </Form>
        <Table
          dataSource={searchResults}
          rowKey={(record) => `${record.title}-${record.chunkIndex}-${record.score}`}
          pagination={false}
          style={{ marginTop: 16 }}
          columns={[
            { title: t('Score'), dataIndex: 'score', render: (score: number) => score.toFixed(4) },
            { title: t('Document title'), dataIndex: 'title' },
            { title: t('Chunks'), dataIndex: 'chunkIndex' },
            { title: t('Content'), dataIndex: 'content' },
          ]}
        />
      </Card>
      <Card title={t('Import files')} style={{ marginTop: 32 }}>
        <Typography.Paragraph type="secondary">
          {t('Supported formats: TXT, Markdown, CSV, PDF, DOCX, XLS/XLSX, and PPTX.')}
        </Typography.Paragraph>
        <Form form={fileForm} layout="vertical" style={{ maxWidth: 760 }}>
          <Form.Item name="knowledgeBaseId" label={t('Knowledge base')} rules={[{ required: true }]}>
            <Select
              options={bases
                .filter((base: { enabled: boolean }) => base.enabled)
                .map((base: { id: string; name: string; key: string }) => ({
                  value: base.id,
                  label: `${base.name} (${base.key})`,
                }))}
            />
          </Form.Item>
          <Upload
            multiple
            accept=".txt,.md,.csv,.pdf,.docx,.xls,.xlsx,.pptx"
            customRequest={ingestFiles}
            fileList={fileList}
            onChange={({ fileList: nextFiles }) => setFileList(nextFiles)}
          >
            <Button>{t('Choose files')}</Button>
          </Upload>
        </Form>
      </Card>
      <Table
        loading={documentsLoading}
        dataSource={documentsData?.data?.data ?? []}
        rowKey="id"
        pagination={false}
        style={{ marginTop: 16 }}
        columns={[
          { title: t('Document title'), dataIndex: 'title' },
          { title: t('Knowledge base'), dataIndex: ['knowledgeBase', 'name'] },
          { title: t('Status'), dataIndex: 'status' },
          { title: t('Chunks'), dataIndex: 'chunkCount' },
          { title: t('Error'), dataIndex: 'error' },
          {
            title: t('Actions'),
            render: (_, record: unknown) => {
              const document = record as { id: string };
              return (
                <Popconfirm
                  title={t('Delete this document and all of its indexed chunks?')}
                  onConfirm={async () => {
                    await ctx.api.request({ url: `aiKnowledgeVector:deleteDocument/${document.id}`, method: 'post' });
                    refreshDocuments();
                  }}
                >
                  <Button danger size="small">
                    {t('Delete')}
                  </Button>
                </Popconfirm>
              );
            },
          },
        ]}
      />
    </Card>
  );
}
