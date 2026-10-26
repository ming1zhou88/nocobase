import {
  CheckCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  MailOutlined,
  ReloadOutlined,
  RedoOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  DatePicker,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useT } from '../locale';

const NOTIFY_ROUTE = '/express-mail/notify';
const POLL_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// 日期控件：统一按"美西太平洋日期"计算（不是浏览器本地日期）
// ---------------------------------------------------------------------------
const LA_TIME_ZONE = 'America/Los_Angeles';
const LA_WEEKDAYS: Record<string, string> = {
  Sun: '周日',
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
};

/** 美西当天（可偏移天数）的 YYYY-MM-DD */
function laDateString(offsetDays = 0) {
  const base = new Intl.DateTimeFormat('en-CA', {
    timeZone: LA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (!offsetDays) {
    return base;
  }
  const [year, month, day] = base.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** 美西某日期的星期文案 + MM-DD（用于快捷项与当前日期提示） */
function laDateLabel(dateStr: string) {
  if (!dateStr) {
    return '';
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const week = new Intl.DateTimeFormat('en-US', { timeZone: LA_TIME_ZONE, weekday: 'short' }).format(
    new Date(Date.UTC(year, month - 1, day, 20, 0, 0)),
  );
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${LA_WEEKDAYS[week] || ''}`.trim();
}

const JOB_STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: 'Pending' },
  running: { color: 'processing', label: 'Processing' },
  all_done: { color: 'success', label: 'All done' },
  part_failed: { color: 'error', label: 'Part failed' },
};

export default function EmailNotifyPage() {
  const ctx = useFlowContext();
  const t = useT();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(laDateString(0));
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [windowInfo, setWindowInfo] = useState<Record<string, any> | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeTab, setActiveTab] = useState('all');
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [customDateDraft, setCustomDateDraft] = useState('');
  const [rowSending, setRowSending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 演练模式：不真发（授权码未配置时也能先跑通整条链路）；"演练时也回写"仅用于本地验证
  const [dryRun, setDryRun] = useState(true);
  const [dryRunWriteBack, setDryRunWriteBack] = useState(false);

  const [jobSerial, setJobSerial] = useState<string | null>(null);
  const [jobRecord, setJobRecord] = useState<Record<string, any> | null>(null);
  const [jobItems, setJobItems] = useState<Record<string, any>[]>([]);
  const [lastResult, setLastResult] = useState<Record<string, any> | null>(null);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<Record<string, any> | null>(null);
  const [detailBody, setDetailBody] = useState('');
  const [detailBodyLoading, setDetailBodyLoading] = useState(false);
  const [detailBodyError, setDetailBodyError] = useState('');
  const [mailboxVisible, setMailboxVisible] = useState(false);
  const [mailboxes, setMailboxes] = useState<Record<string, any>[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchSearching, setBatchSearching] = useState(false);
  const [batchMeta, setBatchMeta] = useState<{ requested: number; missing: string[] } | null>(null);

  async function request(action: string, values?: Record<string, unknown>) {
    const response = await ctx.api.request({
      url: `afterSalesBatch:${action}`,
      method: 'post',
      data: values || {},
    });
    return response?.data?.data ?? response?.data ?? {};
  }

  async function loadSendable(nextDate = date, silent = false, orderIds: string[] = [], allDates = false) {
    if (!silent) {
      setLoading(true);
    }
    try {
      const response = await request('listEmailNotifySendable', {
        date: nextDate,
        limit: 500,
        dry_run: dryRun ? 1 : '',
        include_sent: 1,
        order_ids: orderIds,
        all_dates: allDates ? 1 : '',
      });
      setRecords(response.records || []);
      setWindowInfo(response.window || null);
      setDate(response.window?.date || nextDate);
      setSelectedRowKeys([]);
      setBatchMeta(
        orderIds.length
          ? {
              requested: orderIds.length,
              missing: Array.isArray(response.missing_order_ids) ? response.missing_order_ids : [],
            }
          : null,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function handleBatchSearch() {
    const ids = [
      ...new Set(
        batchInput
          .split(/[\s,，]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].slice(0, 200);
    if (!ids.length) {
      message.warning('请先输入平台订单编号');
      return;
    }
    setBatchSearching(true);
    try {
      await loadSendable(date, false, ids, true);
      setBatchOpen(false);
    } finally {
      setBatchSearching(false);
    }
  }

  async function copySelectedOrderIds() {
    const ids = selectedRowKeys.map((value) => String(value)).filter(Boolean);
    if (!ids.length) {
      message.warning('请先勾选订单');
      return;
    }
    await navigator.clipboard.writeText(ids.join('\n'));
    message.success(`已复制 ${ids.length} 个平台订单编号`);
  }

  async function loadJob(currentJobSerial: string, silent = true) {
    const response = await request('getEmailNotifyJob', { job_serial: currentJobSerial });
    setJobRecord(response.job || null);
    setJobItems(response.items || []);
    return response.job as Record<string, any> | null;
  }

  async function loadMailboxes() {
    try {
      const response = await request('listEmailSenderMailboxes');
      setMailboxes(response.records || []);
      setMailboxVisible(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadSendable('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!jobSerial) {
      return;
    }
    void loadJob(jobSerial);
    const timer = window.setInterval(async () => {
      const latest = await loadJob(jobSerial);
      if (latest && latest.status !== 'running' && latest.status !== 'pending') {
        window.clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobSerial]);

  // 快捷项高亮：当前日期落在"今天/昨天/前天"哪一档（美西口径）
  const quickDateKey = useMemo(() => {
    for (const offset of [0, -1, -2]) {
      if (date === laDateString(offset)) {
        return String(offset);
      }
    }
    return '';
  }, [date]);

  const sendableRecords = useMemo(() => records.filter((record) => record.sendable), [records]);
  const sentRecords = useMemo(() => records.filter((record) => Number(record.email_sent)), [records]);
  const blockedRecords = useMemo(
    () => records.filter((record) => !record.sendable && !Number(record.email_sent)),
    [records],
  );
  const displayRecords = useMemo(() => {
    if (activeTab === 'pending') return sendableRecords;
    if (activeTab === 'blocked') return blockedRecords;
    if (activeTab === 'sent') return sentRecords;
    return records;
  }, [activeTab, records, sendableRecords, blockedRecords, sentRecords]);
  const senderSummary = useMemo(() => {
    const status = new Map<string, boolean>();
    for (const record of records) {
      const email = String(record.sender_email || '').trim();
      if (!email) continue;
      status.set(email, Boolean(record.sender_configured));
    }
    const missing = [...status.entries()].filter(([, configured]) => !configured).map(([email]) => email);
    return { total: status.size, missing };
  }, [records]);
  const jobProgress = useMemo(() => {
    const total = Number(jobRecord?.total_count || 0);
    const done = Number(jobRecord?.done_count || 0);
    const failed = Number(jobRecord?.failed_count || 0);
    const pending = Number(jobRecord?.pending_count || 0);
    return { total, done, failed, pending, percent: total ? Number((((done + failed) / total) * 100).toFixed(2)) : 0 };
  }, [jobRecord]);

  /** 单行/批量共用的发送流程：建任务 → 调 Dify 逐封 → 刷新清单 */
  async function sendOrders(orderIds: string[], rowOrderId?: string) {
    if (!orderIds.length) {
      message.warning(t('Please select at least one order'));
      return;
    }
    modal.confirm({
      title: t('Trigger sending'),
      content: t('Will send {{count}} notification emails. Continue?', { count: orderIds.length }),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      onOk: async () => {
        setSending(true);
        if (rowOrderId) setRowSending(rowOrderId);
        try {
          const job = await request('createEmailNotifyJob', {
            order_ids: orderIds,
            date,
            dry_run: dryRun ? 1 : '',
            write_back: dryRun ? (dryRunWriteBack ? 1 : 0) : 1,
          });
          setJobSerial(String(job.job_serial));
          const result = await request('runEmailNotifyJobViaDify', {
            job_serial: job.job_serial,
            dry_run: dryRun ? 1 : '',
            write_back: dryRun ? (dryRunWriteBack ? 1 : 0) : 1,
          });
          setLastResult(result);
          message.success(String(result.summary || t('Sent')));
          await loadJob(String(job.job_serial), false);
          await loadSendable(date, true);
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        } finally {
          setSending(false);
          if (rowOrderId) setRowSending(null);
        }
      },
    });
  }

  async function handleSend() {
    await sendOrders(selectedRowKeys.map((value) => String(value)));
  }

  async function handleSendOne(record: Record<string, any>) {
    if (!record.sendable) {
      message.warning(String(record.reason || t('Not sendable')));
      return;
    }
    await sendOrders([String(record.order_id)], String(record.order_id));
  }

  async function handleRetryFailed() {
    if (!jobSerial) {
      message.warning(t('No job yet'));
      return;
    }
    setSending(true);
    try {
      const result = await request('retryEmailNotifyJob', { job_serial: jobSerial });
      message.success(`${t('Retry')}: ${result.retried}`);
      await loadJob(jobSerial, false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  async function openDetail(record: Record<string, any>) {
    setDetailRecord(record);
    setDetailVisible(true);
    setDetailBody('');
    setDetailBodyError('');
    setDetailBodyLoading(true);
    try {
      const response = await request('getEmailNotifyBody', { order_id: record.order_id });
      setDetailBody(String(response?.body || ''));
    } catch (error) {
      setDetailBodyError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailBodyLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex', padding: 24 }}>
      <Space align="center">
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          {t('Express notification emails')}
        </Typography.Title>
        <Tooltip title={t('Copy route path')}>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={async () => {
              await navigator.clipboard.writeText(NOTIFY_ROUTE);
              message.success(`${t('Copied')}: ${NOTIFY_ROUTE}`);
            }}
          />
        </Tooltip>
      </Space>
      <Typography.Paragraph type="secondary">
        {t('Filter 7E2 by US Pacific day, join 7E1 for the email body, then send one by one through Dify.')}{' '}
        {t('Route path')}: {NOTIFY_ROUTE}
      </Typography.Paragraph>

      {dryRun ? (
        <Alert type="warning" showIcon message={t('Dry run banner')} description={t('Dry run banner detail')} />
      ) : null}

      <Card
        title={t('Sendable today')}
        extra={
          <Space wrap>
            <Select
              value={quickDateKey || 'custom'}
              style={{ width: 260 }}
              options={[
                { label: `${t('Today')} · ${laDateLabel(laDateString(0))}`, value: '0' },
                { label: `${t('Yesterday')} · ${laDateLabel(laDateString(-1))}`, value: '-1' },
                { label: `${t('Day before yesterday')} · ${laDateLabel(laDateString(-2))}`, value: '-2' },
                { label: t('Other date...'), value: 'custom' },
              ]}
              onChange={(value) => {
                if (value === 'custom') {
                  setCustomDateDraft(date || laDateString(0));
                  setCustomDateOpen(true);
                  return;
                }
                const nextDate = laDateString(Number(value));
                setDate(nextDate);
                void loadSendable(nextDate);
              }}
            />
            <Typography.Text type="secondary">
              {t('US Pacific')} · {laDateLabel(date) || '-'}
            </Typography.Text>
            <Tooltip title={t('Refresh')}>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSendable(date)} />
            </Tooltip>
            <Button type="text" icon={<MailOutlined />} onClick={() => void loadMailboxes()}>
              {t('Sender mailboxes')}
            </Button>
            <Tag color={senderSummary.missing.length ? 'warning' : 'success'}>
              {senderSummary.missing.length
                ? t('Sender mailboxes incomplete', { count: senderSummary.missing.length })
                : t('Sender mailboxes all configured')}
            </Tag>
            <Tooltip title={t('Dry run hint')}>
              <Space size={4}>
                <Typography.Text>{t('Dry run')}</Typography.Text>
                <Switch
                  size="small"
                  checked={dryRun}
                  onChange={(value) => {
                    setDryRun(value);
                    void loadSendable(date);
                  }}
                />
              </Space>
            </Tooltip>
            <Button icon={<SearchOutlined />} onClick={() => setBatchOpen(true)}>
              订单号批量搜索
            </Button>
            <Button
              icon={<CopyOutlined />}
              disabled={!selectedRowKeys.length}
              onClick={() => void copySelectedOrderIds()}
            >
              复制选中订单
            </Button>
            {batchMeta ? (
              <Tag color={batchMeta.missing.length ? 'warning' : 'success'}>
                已搜索 {batchMeta.requested} 个 / 未匹配 {batchMeta.missing.length} 个
              </Tag>
            ) : null}
            <Button
              icon={<SendOutlined />}
              loading={sending}
              disabled={!selectedRowKeys.length}
              onClick={() => void handleSend()}
            >
              {t('Trigger sending')}
            </Button>
          </Space>
        }
      >
        {windowInfo ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${t('Filter window')}: ${windowInfo.start} ~ ${windowInfo.end}（${windowInfo.basis}）`}
            description={windowInfo.note}
          />
        ) : null}
        <Card
          size="small"
          title={t('Sending progress')}
          style={{ marginBottom: 12 }}
          extra={
            <Space>
              {jobRecord ? (
                <Tag color={JOB_STATUS_MAP[String(jobRecord.status)]?.color || 'default'}>
                  {t(JOB_STATUS_MAP[String(jobRecord.status)]?.label || String(jobRecord.status))}
                </Tag>
              ) : null}
              <Typography.Text type="secondary">
                {jobSerial ? `${t('Job serial')}: ${jobSerial}` : t('No job yet')}
              </Typography.Text>
              <Button
                size="small"
                icon={<RedoOutlined />}
                loading={sending}
                disabled={!jobSerial || jobProgress.failed === 0}
                onClick={() => void handleRetryFailed()}
              >
                {t('Retry failed')}
              </Button>
            </Space>
          }
        >
          <Space size={32} wrap>
            <Statistic title={t('Total')} value={jobProgress.total} />
            <Statistic title={t('Sent')} value={jobProgress.done} valueStyle={{ color: '#3f8600' }} />
            <Statistic title={t('Remaining')} value={jobProgress.pending} />
            <Statistic title={t('Failed')} value={jobProgress.failed} valueStyle={{ color: '#cf1322' }} />
          </Space>
          <Progress percent={jobProgress.percent} style={{ marginTop: 8 }} />
        </Card>
        <Segmented
          style={{ marginBottom: 12 }}
          value={activeTab}
          onChange={(value) => setActiveTab(String(value))}
          options={[
            { label: `${t('Today sendable')} (${records.length})`, value: 'all' },
            { label: `${t('Today pending')} (${sendableRecords.length})`, value: 'pending' },
            { label: `${t('Today sent')} (${sentRecords.length})`, value: 'sent' },
            { label: `${t('Not sendable')} (${blockedRecords.length})`, value: 'blocked' },
          ]}
        />
        <Table
          rowKey="order_id"
          loading={loading}
          dataSource={displayRecords}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (record) => ({ disabled: !record.sendable }),
          }}
          scroll={{ x: 1900 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          columns={[
            { title: t('Store name'), dataIndex: 'store_name', key: 'store_name', width: 140, fixed: 'left' as const },
            {
              title: t('Order ID'),
              dataIndex: 'order_id',
              key: 'order_id',
              width: 200,
              render: (value: unknown) => <span style={{ whiteSpace: 'nowrap' }}>{String(value || '-')}</span>,
            },
            {
              title: t('Sender'),
              dataIndex: 'sender_email',
              key: 'sender_email',
              width: 220,
              ellipsis: { showTitle: true },
            },
            { title: t('Current delivery'), dataIndex: 'delivery_details', key: 'delivery_details', width: 120 },
            {
              title: t('Delivery at send'),
              dataIndex: 'delivery_details_at_send',
              key: 'delivery_details_at_send',
              width: 180,
            },
            {
              title: t('Created time (Beijing)'),
              dataIndex: 'create_time',
              key: 'create_time',
              width: 190,
              render: (value: unknown) => <span style={{ whiteSpace: 'nowrap' }}>{String(value || '-')}</span>,
            },
            {
              title: t('Updated time (Beijing)'),
              dataIndex: 'update_time',
              key: 'update_time',
              width: 190,
              render: (value: unknown) => <span style={{ whiteSpace: 'nowrap' }}>{String(value || '-')}</span>,
            },
            {
              title: t('Sendable at (Pacific)'),
              dataIndex: 'platform_sendable_at',
              key: 'platform_sendable_at',
              width: 190,
              render: (value: unknown) => <span style={{ whiteSpace: 'nowrap' }}>{String(value || '-')}</span>,
            },
            { title: t('Remark'), dataIndex: 'remark', key: 'remark', width: 160, ellipsis: { showTitle: true } },
            {
              title: t('Send express mail'),
              key: 'send',
              width: 150,
              fixed: 'right' as const,
              render: (_value: unknown, record: Record<string, any>) => {
                if (Number(record.email_sent)) {
                  return <Tag color="success">{t('Sent express mail')}</Tag>;
                }
                if (!record.sendable) {
                  return (
                    <Tooltip title={String(record.reason || '-')}>
                      <Button size="small" disabled>
                        {t('Send')}
                      </Button>
                    </Tooltip>
                  );
                }
                return (
                  <Button
                    size="small"
                    type="primary"
                    loading={rowSending === String(record.order_id)}
                    disabled={sending}
                    onClick={() => void handleSendOne(record)}
                  >
                    {dryRun ? t('Dry run send') : t('Send')}
                  </Button>
                );
              },
            },
            {
              title: t('View details'),
              key: 'actions',
              fixed: 'right' as const,
              width: 110,
              render: (_value: unknown, record: Record<string, any>) => (
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => {
                    void openDetail(record);
                  }}
                >
                  {t('View details')}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title={t('Send job details')}
        extra={
          <Space>
            {jobRecord ? (
              <Tag color={JOB_STATUS_MAP[String(jobRecord.status)]?.color || 'default'}>
                {t(JOB_STATUS_MAP[String(jobRecord.status)]?.label || String(jobRecord.status))}
              </Tag>
            ) : null}
            <Typography.Text type="secondary">
              {jobSerial ? `${t('Job serial')}: ${jobSerial}` : t('No job yet')}
            </Typography.Text>
          </Space>
        }
      >
        {lastResult ? (
          <Alert
            style={{ marginTop: 12 }}
            type={Number(lastResult.failed) > 0 ? 'warning' : 'success'}
            showIcon
            message={`Dify ${t('Result')}: ${String(lastResult.summary || '')}`}
            description={`${t('Elapsed')}: ${lastResult.elapsed_ms} ms`}
          />
        ) : null}
        {jobItems.length ? (
          <Table
            style={{ marginTop: 12 }}
            rowKey="id"
            size="small"
            dataSource={jobItems}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: t('Order ID'), dataIndex: 'order_id', key: 'order_id', width: 170 },
              {
                title: t('Recipient'),
                dataIndex: 'recipient_email',
                key: 'recipient_email',
                width: 220,
                ellipsis: true,
              },
              { title: t('Sender'), dataIndex: 'sender_email', key: 'sender_email', width: 200, ellipsis: true },
              {
                title: t('Status'),
                dataIndex: 'status',
                key: 'status',
                width: 110,
                render: (value: string) => (
                  <Tag
                    color={
                      value === 'sent'
                        ? 'success'
                        : value === 'failed'
                          ? 'error'
                          : value === 'skipped'
                            ? 'warning'
                            : 'default'
                    }
                  >
                    {value}
                  </Tag>
                ),
              },
              { title: t('Sent at'), dataIndex: 'sent_at', key: 'sent_at', width: 180 },
              { title: t('Failure reason'), dataIndex: 'error', key: 'error', ellipsis: { showTitle: true } },
            ]}
          />
        ) : null}
      </Card>

      <Modal
        title={t('Select date')}
        open={customDateOpen}
        onCancel={() => setCustomDateOpen(false)}
        onOk={() => {
          const nextDate = customDateDraft || date || laDateString(0);
          setDate(nextDate);
          setCustomDateOpen(false);
          void loadSendable(nextDate);
        }}
        okText={t('Confirm')}
        cancelText={t('Cancel')}
      >
        <DatePicker
          value={customDateDraft ? dayjs(customDateDraft) : null}
          format="YYYY-MM-DD"
          allowClear={false}
          style={{ width: '100%' }}
          disabledDate={(current) => current && current.isAfter(dayjs(laDateString(0)), 'day')}
          onChange={(value) => setCustomDateDraft(value ? value.format('YYYY-MM-DD') : '')}
        />
      </Modal>

      <Drawer
        title={t('Express mail details')}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        width={720}
      >
        {detailRecord ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('Order ID')}>{String(detailRecord.order_id || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Store name')}>{String(detailRecord.store_name || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Sender')}>{String(detailRecord.sender_email || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Current delivery')}>
              {String(detailRecord.delivery_details || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Delivery at send')}>
              {String(detailRecord.delivery_details_at_send || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Created time (Beijing)')}>
              {String(detailRecord.create_time || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Updated time (Beijing)')}>
              {String(detailRecord.update_time || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Sendable at (Pacific)')}>
              {String(detailRecord.platform_sendable_at || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Remark')}>{String(detailRecord.remark || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Express mail sent')}>
              {Number(detailRecord.email_sent) ? <Tag color="success">{t('Sent express mail')}</Tag> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('Express mail body')}>
              {detailBodyLoading ? (
                <Spin size="small" />
              ) : detailBodyError ? (
                <Typography.Text type="danger">{detailBodyError}</Typography.Text>
              ) : (
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {detailBody || '-'}
                </Typography.Paragraph>
              )}
            </Descriptions.Item>
            {detailRecord.sendable ? null : (
              <Descriptions.Item label={t('Not sendable reason')}>
                <Typography.Text type="danger">{String(detailRecord.reason || '-')}</Typography.Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        ) : null}
      </Drawer>

      <Modal
        title="按平台订单编号精确搜索"
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        width={560}
        footer={[
          <Button key="clear" onClick={() => setBatchInput('')}>
            清空
          </Button>,
          <Button key="close" onClick={() => setBatchOpen(false)}>
            关闭
          </Button>,
          <Button key="search" type="primary" loading={batchSearching} onClick={() => void handleBatchSearch()}>
            搜索
          </Button>,
        ]}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text type="secondary">一行一个平台订单编号，最多 200 行；批量搜索不限日期。</Typography.Text>
          <Input.TextArea
            rows={8}
            value={batchInput}
            onChange={(event) => setBatchInput(event.target.value)}
            placeholder={'精确搜索，一行一项，最多支持200行'}
          />
          {batchMeta ? (
            <Alert
              type={batchMeta.missing.length ? 'warning' : 'success'}
              showIcon
              message={`输入 ${batchMeta.requested} 个，匹配 ${
                batchMeta.requested - batchMeta.missing.length
              } 个，未匹配 ${batchMeta.missing.length} 个`}
              description={batchMeta.missing.length ? batchMeta.missing.slice(0, 20).join('、') : undefined}
            />
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={t('Sender mailboxes')}
        open={mailboxVisible}
        onCancel={() => setMailboxVisible(false)}
        footer={null}
        width={860}
      >
        <Table
          rowKey="store_name"
          size="small"
          dataSource={mailboxes}
          pagination={false}
          columns={[
            { title: t('Store name'), dataIndex: 'store_name', key: 'store_name' },
            { title: t('Sender'), dataIndex: 'sender_email', key: 'sender_email' },
            {
              title: t('Enabled'),
              dataIndex: 'enabled',
              key: 'enabled',
              render: (value: number) => (
                <Tag color={Number(value) ? 'success' : 'default'}>{Number(value) ? t('Enabled') : t('Disabled')}</Tag>
              ),
            },
            { title: t('Notes'), dataIndex: 'notes', key: 'notes', ellipsis: true },
          ]}
        />
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message={t('Mailbox hint')}
          description={<Typography.Text>{t('Mailbox hint detail')}</Typography.Text>}
        />
      </Modal>
    </Space>
  );
}
