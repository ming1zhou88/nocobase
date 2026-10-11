import {
  CheckCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  MailOutlined,
  ReloadOutlined,
  RedoOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';
import { AFTER_SALES_NOTIFY_ROUTE_PATH } from '../plugin';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Progress,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../locale';

const NOTIFY_ROUTE = '/admin/express-mail/notify';
const POLL_INTERVAL_MS = 3000;

const JOB_STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: 'Pending' },
  running: { color: 'processing', label: 'Processing' },
  all_done: { color: 'success', label: 'All done' },
  part_failed: { color: 'error', label: 'Part failed' },
};

export function EmailNotifyPage() {
  const api = useAPIClient();
  const t = useT();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [windowInfo, setWindowInfo] = useState<Record<string, any> | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
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
  const [mailboxVisible, setMailboxVisible] = useState(false);
  const [mailboxes, setMailboxes] = useState<Record<string, any>[]>([]);

  async function request(action: string, values?: Record<string, unknown>) {
    const response = await api.request({
      url: `afterSalesBatch:${action}`,
      method: 'post',
      data: values || {},
    });
    return response?.data?.data ?? response?.data ?? {};
  }

  async function loadSendable(nextDate = date, silent = false) {
    if (!silent) {
      setLoading(true);
    }
    try {
      const response = await request('listEmailNotifySendable', {
        date: nextDate,
        limit: 500,
        dry_run: dryRun ? 1 : '',
      });
      setRecords(response.records || []);
      setWindowInfo(response.window || null);
      setDate(response.window?.date || nextDate);
      setSelectedRowKeys([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
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

  const sendableRecords = useMemo(() => records.filter((record) => record.sendable), [records]);
  const blockedRecords = useMemo(() => records.filter((record) => !record.sendable), [records]);
  const jobProgress = useMemo(() => {
    const total = Number(jobRecord?.total_count || 0);
    const done = Number(jobRecord?.done_count || 0);
    const failed = Number(jobRecord?.failed_count || 0);
    const pending = Number(jobRecord?.pending_count || 0);
    return { total, done, failed, pending, percent: total ? Number((((done + failed) / total) * 100).toFixed(2)) : 0 };
  }, [jobRecord]);

  /** 触发发送：建任务 → 调 Dify 逐封 → 轮询进度 */
  async function handleSend() {
    const orderIds = selectedRowKeys.map((value) => String(value));
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
        }
      },
    });
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
              await navigator.clipboard.writeText(AFTER_SALES_NOTIFY_ROUTE_PATH);
              message.success(`${t('Copied')}: ${AFTER_SALES_NOTIFY_ROUTE_PATH}`);
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
            <Input
              style={{ width: 160 }}
              placeholder={t('US Pacific date')}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              onPressEnter={() => void loadSendable(date)}
            />
            <Button icon={<ReloadOutlined />} type="primary" loading={loading} onClick={() => void loadSendable(date)}>
              {t('Today sendable express emails')}
            </Button>
            <Button icon={<MailOutlined />} onClick={() => void loadMailboxes()}>
              {t('Sender mailboxes')}
            </Button>
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
            {dryRun ? (
              <Tooltip title={t('Dry run write back hint')}>
                <Space size={4}>
                  <Typography.Text type="secondary">{t('Write back in dry run')}</Typography.Text>
                  <Switch size="small" checked={dryRunWriteBack} onChange={setDryRunWriteBack} />
                </Space>
              </Tooltip>
            ) : null}
            <Button
              icon={<SendOutlined />}
              loading={sending}
              disabled={!selectedRowKeys.length}
              onClick={() => void handleSend()}
            >
              {t('Trigger sending')}
            </Button>
            <Button
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
        {windowInfo ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${t('Filter window')}: ${windowInfo.start} ~ ${windowInfo.end}（${windowInfo.basis}）`}
            description={windowInfo.note}
          />
        ) : null}
        <Table
          rowKey="order_id"
          loading={loading}
          dataSource={sendableRecords}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (record) => ({ disabled: !record.sendable }),
          }}
          scroll={{ x: 1500 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          columns={[
            { title: t('Order ID'), dataIndex: 'order_id', key: 'order_id', width: 170, fixed: 'left' as const },
            { title: t('Store name'), dataIndex: 'store_name', key: 'store_name', width: 140 },
            { title: t('Sendable at'), dataIndex: 'platform_sendable_at', key: 'platform_sendable_at', width: 170 },
            {
              title: t('Recipient'),
              dataIndex: 'recipient_email',
              key: 'recipient_email',
              width: 230,
              ellipsis: { showTitle: true },
            },
            {
              title: t('Sender'),
              dataIndex: 'sender_email',
              key: 'sender_email',
              width: 220,
              ellipsis: { showTitle: true },
            },
            { title: t('Subject'), dataIndex: 'subject', key: 'subject', width: 300, ellipsis: { showTitle: true } },
            { title: t('Body chars'), dataIndex: 'body_chars', key: 'body_chars', width: 100 },
            { title: t('Delivery details'), dataIndex: 'delivery_details', key: 'delivery_details', width: 110 },
            {
              title: t('Sender configured'),
              dataIndex: 'sender_configured',
              key: 'sender_configured',
              width: 120,
              render: (value: boolean) => (
                <Tag color={value ? 'success' : 'warning'}>{value ? t('Configured') : t('Not configured')}</Tag>
              ),
            },
            {
              title: t('Actions'),
              key: 'actions',
              fixed: 'right' as const,
              width: 110,
              render: (_value: unknown, record: Record<string, any>) => (
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => {
                    setDetailRecord(record);
                    setDetailVisible(true);
                  }}
                >
                  {t('Preview')}
                </Button>
              ),
            },
          ]}
        />
        {blockedRecords.length ? (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={t('Not sendable count') + `: ${blockedRecords.length}`}
            description={
              <Space direction="vertical" size={2}>
                {blockedRecords.slice(0, 8).map((record) => (
                  <Typography.Text key={String(record.order_id)}>
                    {String(record.order_id)}（{String(record.store_name)}）：{String(record.reason)}
                  </Typography.Text>
                ))}
              </Space>
            }
          />
        ) : null}
      </Card>

      <Card
        title={t('Sending progress')}
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
        <Space size={48} wrap>
          <Statistic title={t('Total')} value={jobProgress.total} />
          <Statistic title={t('Sent')} value={jobProgress.done} valueStyle={{ color: '#3f8600' }} />
          <Statistic title={t('Remaining')} value={jobProgress.pending} />
          <Statistic title={t('Failed')} value={jobProgress.failed} valueStyle={{ color: '#cf1322' }} />
        </Space>
        <Progress percent={jobProgress.percent} style={{ marginTop: 16 }} />
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

      <Drawer title={t('Email preview')} open={detailVisible} onClose={() => setDetailVisible(false)} width={720}>
        {detailRecord ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('Order ID')}>{String(detailRecord.order_id || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Store name')}>{String(detailRecord.store_name || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Recipient')}>{String(detailRecord.recipient_email || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Sender')}>{String(detailRecord.sender_email || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Subject')}>{String(detailRecord.subject || '-')}</Descriptions.Item>
            <Descriptions.Item label={t('Delivery details')}>
              {String(detailRecord.delivery_details || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Sendable at')}>
              {String(detailRecord.platform_sendable_at || '-')}
            </Descriptions.Item>
            <Descriptions.Item label={t('Body preview')}>
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {String(detailRecord.body_preview || '-')}
              </Typography.Paragraph>
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

export default EmailNotifyPage;
