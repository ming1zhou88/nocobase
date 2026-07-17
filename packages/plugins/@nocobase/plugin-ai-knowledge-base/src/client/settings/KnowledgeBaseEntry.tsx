/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useState } from 'react';
import {
  Alert,
  App,
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
import { useAPIClient, useRequest } from '@nocobase/client';
import { useT } from '../locale';

type KnowledgeBaseForm = {
  key: string;
  name: string;
  description?: string;
  vectorStoreId: string;
  topK: number;
  enabled: boolean;
};

type KnowledgeBase = KnowledgeBaseForm & { id: string };
type VectorStore = { id: string; key: string; name: string; initializedAt?: string };
type SearchForm = { knowledgeBaseId: string; query: string; topK?: number };
type FileForm = { knowledgeBaseId: string };
type SearchResult = { content: string; score: number; title: string; chunkIndex: number };
type Document = {
  id: string;
  title: string;
  status: string;
  chunkCount: number;
  error?: string;
  knowledgeBase?: { name: string };
};

const recordsOf = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'object' || value === null) return [];
  return recordsOf<T>((value as { data?: unknown }).data);
};

export const KnowledgeBaseEntry = () => {
  const api = useAPIClient();
  const t = useT();
  const { message } = App.useApp();
  const [baseForm] = Form.useForm<KnowledgeBaseForm>();
  const [searchForm] = Form.useForm<SearchForm>();
  const [fileForm] = Form.useForm<FileForm>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string>();
  const { data: vectorStoresResponse, loading: storesLoading } = useRequest(() =>
    api.resource('aiKnowledgeVectorStores').list({ pageSize: 100, filter: { enabled: true } }),
  );
  const {
    data: knowledgeBasesResponse,
    refresh: refreshKnowledgeBases,
    loading: basesLoading,
  } = useRequest(() => api.resource('aiKnowledgeBases').list({ pageSize: 100 }));
  const {
    data: documentsResponse,
    refresh: refreshDocuments,
    loading: documentsLoading,
  } = useRequest(() =>
    api.resource('aiKnowledgeDocuments').list({ pageSize: 100, sort: '-createdAt', appends: ['knowledgeBase'] }),
  );
  const vectorStores = recordsOf<VectorStore>(vectorStoresResponse).filter((store) => store.initializedAt);
  const knowledgeBases = recordsOf<KnowledgeBase>(knowledgeBasesResponse);
  const documents = recordsOf<Document>(documentsResponse);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await baseForm.validateFields();
      await api.resource('aiKnowledgeBases').create({ values });
      message.success(t('Knowledge base saved'));
      baseForm.resetFields();
      refreshKnowledgeBases();
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    try {
      const values = await searchForm.validateFields();
      const response = await api.request({ url: 'aiKnowledgeVector:search', method: 'post', data: values });
      setSearchResults(recordsOf<SearchResult>(response.data));
    } finally {
      setSearching(false);
    }
  };

  const ingestFiles: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    try {
      const values = await fileForm.validateFields();
      const rawFile = file as File;
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(t('Unable to read file.')));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(rawFile);
      });
      await api.request({
        url: 'aiKnowledgeVector:ingestFile',
        method: 'post',
        data: { ...values, filename: rawFile.name, mimeType: rawFile.type, contentBase64 },
      });
      onSuccess?.({});
      message.success(t('Document indexed'));
      refreshDocuments();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const handleDeleteDocument = async (id: string) => {
    setDeletingDocumentId(id);
    try {
      await api.request({ url: `aiKnowledgeVector:deleteDocument/${id}`, method: 'post' });
      message.success(t('Document deleted'));
      refreshDocuments();
    } finally {
      setDeletingDocumentId(undefined);
    }
  };

  return (
    <Card title={t('Knowledge base')}>
      <Typography.Paragraph type="secondary">
        {t('A knowledge base groups documents that AI employees can retrieve.')}
      </Typography.Paragraph>
      {!storesLoading && vectorStores.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t('Initialize a vector store before creating a knowledge base.')}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<KnowledgeBaseForm>
        form={baseForm}
        layout="vertical"
        initialValues={{ topK: 5, enabled: true }}
        style={{ maxWidth: 640 }}
      >
        <Form.Item
          name="key"
          label={t('Key')}
          rules={[{ required: true, message: t('Key is required') }]}
          extra={t('A stable identifier used by AI employees and integrations. Avoid changing it after creation.')}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="name"
          label={t('Name')}
          rules={[{ required: true, message: t('Name is required') }]}
          extra={t('A display name shown when selecting the knowledge base.')}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="description"
          label={t('Description')}
          extra={t('Explain the knowledge base scope so administrators know what it contains.')}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item
          name="vectorStoreId"
          label={t('Vector store')}
          rules={[{ required: true, message: t('Vector store is required') }]}
          extra={t('Only initialized vector stores can be selected.')}
        >
          <Select
            loading={storesLoading}
            options={vectorStores.map((store) => ({
              value: store.id,
              label: `${store.name} (${store.key})`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="topK"
          label={t('Top K')}
          rules={[{ required: true, message: t('Top K is required') }]}
          extra={t('Maximum number of relevant chunks returned for each retrieval.')}
        >
          <InputNumber min={1} max={50} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="enabled"
          label={t('Enabled')}
          valuePropName="checked"
          extra={t('Disabled knowledge bases cannot be selected by AI employees.')}
        >
          <Switch />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={handleSave} loading={saving} disabled={vectorStores.length === 0}>
            {t('Save')}
          </Button>
        </Space>
      </Form>
      <Table<KnowledgeBase>
        loading={basesLoading}
        dataSource={knowledgeBases}
        rowKey="id"
        pagination={false}
        style={{ marginTop: 32 }}
        columns={[
          { title: t('Key'), dataIndex: 'key' },
          { title: t('Name'), dataIndex: 'name' },
          { title: t('Description'), dataIndex: 'description' },
          { title: t('Top K'), dataIndex: 'topK' },
          { title: t('Enabled'), dataIndex: 'enabled', render: (enabled: boolean) => (enabled ? t('Yes') : t('No')) },
        ]}
      />
      <Card title={t('Test retrieval')} style={{ marginTop: 32 }}>
        <Typography.Paragraph type="secondary">
          {t('Ask a question and verify the most relevant indexed chunks before enabling AI Employee retrieval.')}
        </Typography.Paragraph>
        <Form<SearchForm> form={searchForm} layout="vertical" initialValues={{ topK: 5 }} style={{ maxWidth: 760 }}>
          <Form.Item
            name="knowledgeBaseId"
            label={t('Knowledge base')}
            rules={[{ required: true, message: t('Knowledge base is required') }]}
          >
            <Select
              options={knowledgeBases
                .filter((base) => base.enabled)
                .map((base) => ({ value: base.id, label: `${base.name} (${base.key})` }))}
            />
          </Form.Item>
          <Form.Item
            name="query"
            label={t('Question')}
            rules={[{ required: true, message: t('Question is required') }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="topK" label={t('Top K')}>
            <InputNumber min={1} max={50} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" onClick={handleSearch} loading={searching}>
            {t('Search')}
          </Button>
        </Form>
        <Table<SearchResult>
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
        <Form<FileForm> form={fileForm} layout="vertical" style={{ maxWidth: 760 }}>
          <Form.Item
            name="knowledgeBaseId"
            label={t('Knowledge base')}
            rules={[{ required: true, message: t('Knowledge base is required') }]}
          >
            <Select
              options={knowledgeBases
                .filter((base) => base.enabled)
                .map((base) => ({ value: base.id, label: `${base.name} (${base.key})` }))}
            />
          </Form.Item>
          <Form.Item
            label={t('Files')}
            extra={t('Select one or more supported files to index them into the knowledge base.')}
          >
            <Upload
              multiple
              accept=".txt,.md,.csv,.pdf,.docx,.xls,.xlsx,.pptx"
              customRequest={ingestFiles}
              fileList={fileList}
              onChange={({ fileList: nextFiles }) => setFileList(nextFiles)}
            >
              <Button>{t('Choose files')}</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Card>
      <Table<Document>
        loading={documentsLoading}
        dataSource={documents}
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
            render: (_, record) => (
              <Popconfirm
                title={t('Delete this document and all of its indexed chunks?')}
                onConfirm={() => handleDeleteDocument(record.id)}
              >
                <Button danger size="small" loading={deletingDocumentId === record.id}>
                  {t('Delete')}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Card>
  );
};
