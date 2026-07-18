/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Layout,
  Menu,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  type MenuProps,
  type TableColumnsType,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  InboxOutlined,
  MailOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { ComposeModal } from './ComposeModal';
import { SettingsDrawer } from './SettingsDrawer';
import type { MailAccount, MailAddress, MailMessage, MailRequest, MessageListResult, Translate } from './types';
import { dataOf, errorMessage } from './types';

interface MailCenterProps {
  request: MailRequest;
  t: Translate;
}

const BOXES = ['inbox', 'outbox', 'draft', 'trash', 'spam', 'archive', 'scheduled'] as const;

function addressText(addresses: MailAddress[] | undefined): string {
  return (addresses || []).map((item) => (item.name ? `${item.name} <${item.address}>` : item.address)).join(', ');
}

export function MailCenter({ request, t }: MailCenterProps) {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [box, setBox] = useState<string>('inbox');
  const [accountId, setAccountId] = useState<number>();
  const [readFilter, setReadFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detail, setDetail] = useState<MailMessage>();
  const [availableLabels, setAvailableLabels] = useState<Array<{ id: number; name: string; color?: string }>>([]);
  const [detailNote, setDetailNote] = useState('');
  const [detailTodo, setDetailTodo] = useState(false);
  const [detailLabelIds, setDetailLabelIds] = useState<number[]>([]);

  const loadAccounts = useCallback(async () => {
    const response = await request('accountsList');
    setAccounts(dataOf<MailAccount[]>(response) || []);
  }, [request]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const response = await request('messagesList', {
        page,
        pageSize,
        box,
        accountId,
        isRead: readFilter === 'all' ? undefined : readFilter === 'read',
        search,
      });
      const result = dataOf<MessageListResult>(response);
      setMessages(result?.rows || []);
      setTotal(result?.count || 0);
      setSelectedIds([]);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [accountId, box, message, page, pageSize, readFilter, request, search]);

  useEffect(() => {
    loadAccounts().catch((error) => message.error(errorMessage(error)));
  }, [loadAccounts, message]);

  useEffect(() => {
    loadMessages().catch((error) => message.error(errorMessage(error)));
  }, [loadMessages, message]);

  const updateRead = async (isRead: boolean) => {
    if (!selectedIds.length) return;
    await request('markRead', { ids: selectedIds.map(Number), isRead });
    await loadMessages();
  };

  const moveSelected = async (targetBox: string) => {
    if (!selectedIds.length) return;
    await request('move', { ids: selectedIds.map(Number), box: targetBox });
    await loadMessages();
  };

  const openDetail = async (record: MailMessage) => {
    setDetail(record);
    setDetailNote(record.note || '');
    setDetailTodo(record.isTodo);
    setDetailLabelIds(record.labels?.map((label) => label.id) || []);
    try {
      const labels = await request('settingsList', { type: 'labels' });
      setAvailableLabels(dataOf<Array<{ id: number; name: string; color?: string }>>(labels) || []);
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  const saveDetailMetadata = async () => {
    if (!detail) return;
    try {
      await request('updateMessageMetadata', {
        id: detail.id,
        note: detailNote,
        isTodo: detailTodo,
        labelIds: detailLabelIds,
      });
      message.success(t('Saved successfully'));
      await loadMessages();
    } catch (error) {
      message.error(errorMessage(error));
    }
  };

  const menuItems: MenuProps['items'] = useMemo(
    () =>
      BOXES.map((key) => ({
        key,
        icon:
          key === 'inbox' ? (
            <InboxOutlined />
          ) : key === 'outbox' ? (
            <SendOutlined />
          ) : key === 'trash' ? (
            <DeleteOutlined />
          ) : (
            <MailOutlined />
          ),
        label: t(key.charAt(0).toUpperCase() + key.slice(1)),
      })),
    [t],
  );

  const columns: TableColumnsType<MailMessage> = [
    {
      title: '',
      dataIndex: 'isRead',
      width: 46,
      render: (isRead: boolean) => (isRead ? <EyeOutlined aria-label={t('Read')} /> : <Badge status="processing" />),
    },
    {
      title: t('Subject'),
      dataIndex: 'subject',
      ellipsis: true,
      render: (subject: string, record) => (
        <Button
          type="link"
          style={{ padding: 0, fontWeight: record.isRead ? 400 : 600 }}
          onClick={() => openDetail(record)}
        >
          {subject || t('(No subject)')}
        </Button>
      ),
    },
    { title: t('From'), dataIndex: 'from', ellipsis: true, render: addressText },
    { title: t('To'), dataIndex: 'to', ellipsis: true, render: addressText },
    {
      title: t('Labels'),
      dataIndex: 'labels',
      width: 160,
      render: (labels: MailMessage['labels']) =>
        labels?.map((label) => (
          <Tag key={label.id} color={label.color}>
            {label.name}
          </Tag>
        )),
    },
    {
      title: t('Date'),
      dataIndex: box === 'outbox' ? 'sentAt' : 'receivedAt',
      width: 180,
      render: (value?: string) => (value ? new Date(value).toLocaleString() : '-'),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <MailOutlined />
          {t('Email')}
        </Space>
      }
      extra={
        <Space>
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} aria-label={t('Settings')} />
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => setComposeOpen(true)}
            disabled={!accounts.length}
          >
            {t('Write email')}
          </Button>
        </Space>
      }
      styles={{ body: { padding: 0 } }}
    >
      <Layout style={{ minHeight: 620, background: 'transparent' }}>
        <Layout.Sider width={180} theme="light" style={{ borderRight: '1px solid rgba(5, 5, 5, 0.06)' }}>
          <Menu
            selectedKeys={[box]}
            items={menuItems}
            onSelect={({ key }) => {
              setBox(key);
              setPage(1);
            }}
          />
        </Layout.Sider>
        <Layout.Content style={{ padding: 16, minWidth: 0 }}>
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search
              allowClear
              placeholder={t('Search subject or content')}
              style={{ width: 260 }}
              onSearch={(value) => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Select
              allowClear
              placeholder={t('All mailboxes')}
              style={{ width: 210 }}
              value={accountId}
              onChange={(value) => {
                setAccountId(value);
                setPage(1);
              }}
              options={accounts.map((account) => ({ value: account.id, label: account.email }))}
            />
            <Select
              value={readFilter}
              style={{ width: 140 }}
              onChange={(value) => {
                setReadFilter(value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: t('All') },
                { value: 'read', label: t('Read') },
                { value: 'unread', label: t('Unread') },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={loadMessages}>
              {t('Refresh')}
            </Button>
            <Button icon={<EyeOutlined />} disabled={!selectedIds.length} onClick={() => updateRead(true)}>
              {t('Mark as read')}
            </Button>
            <Button icon={<EyeInvisibleOutlined />} disabled={!selectedIds.length} onClick={() => updateRead(false)}>
              {t('Mark as unread')}
            </Button>
            <Select
              placeholder={t('Move to')}
              disabled={!selectedIds.length}
              style={{ width: 150 }}
              onSelect={moveSelected}
              options={BOXES.filter((item) => item !== box).map((item) => ({
                value: item,
                label: t(item.charAt(0).toUpperCase() + item.slice(1)),
              }))}
            />
          </Space>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={messages}
            loading={loading}
            rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
            scroll={{ x: 1000 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              },
            }}
          />
        </Layout.Content>
      </Layout>
      <ComposeModal
        open={composeOpen}
        accounts={accounts}
        request={request}
        t={t}
        onClose={() => setComposeOpen(false)}
        onSent={loadMessages}
      />
      <SettingsDrawer
        open={settingsOpen}
        accounts={accounts}
        request={request}
        t={t}
        onClose={() => setSettingsOpen(false)}
        onAccountsChanged={loadAccounts}
      />
      <Drawer
        width="min(760px, 92vw)"
        open={Boolean(detail)}
        onClose={() => setDetail(undefined)}
        title={detail?.subject || t('(No subject)')}
      >
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('From')}>{addressText(detail.from)}</Descriptions.Item>
              <Descriptions.Item label={t('To')}>{addressText(detail.to)}</Descriptions.Item>
              <Descriptions.Item label={t('Cc')}>{addressText(detail.cc)}</Descriptions.Item>
              <Descriptions.Item label={t('Date')}>
                {detail.receivedAt ? new Date(detail.receivedAt).toLocaleString() : '-'}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{detail.text}</Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <Typography.Text>{t('Todo')}</Typography.Text>
                <Switch checked={detailTodo} onChange={setDetailTodo} />
              </Space>
              <Select
                mode="multiple"
                value={detailLabelIds}
                onChange={setDetailLabelIds}
                placeholder={t('Labels')}
                options={availableLabels.map((label) => ({ value: label.id, label: label.name }))}
              />
              <Input.TextArea
                value={detailNote}
                onChange={(event) => setDetailNote(event.target.value)}
                rows={3}
                placeholder={t('Note')}
              />
              <Button type="primary" onClick={saveDetailMetadata}>
                {t('Save')}
              </Button>
            </Space>
            {detail.attachments?.map((attachment) => (
              <Button key={attachment.id} href={`/api/mailCenter:attachmentDownload/${attachment.id}`} target="_blank">
                {attachment.filename} ({Math.ceil(attachment.size / 1024)} KB)
              </Button>
            ))}
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
