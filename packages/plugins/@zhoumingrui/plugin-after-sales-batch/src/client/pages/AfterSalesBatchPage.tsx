import {
  CopyOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RedoOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';
import { AFTER_SALES_BATCH_ROUTE_PATH } from '../plugin';
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useT } from '../locale';

const WORK_ORDER_ROUTE = '/admin/after-sales/batch-workbench';
const FALLBACK_ANSWER_TIMEOUT_SECONDS = 180;

const STATUS_COLOR_MAP: Record<string, string> = {
  pending: 'default',
  processing: 'processing',
  succeeded: 'success',
  failed: 'error',
  skipped: 'warning',
};

// 指南详情按顺序展示的字段（字段名 -> i18n 标签 key）
const GUIDE_DISPLAY_FIELDS: Array<[string, string]> = [
  ['store_name', 'Store name'],
  ['order_id', 'Order ID'],
  ['buyer_email', 'Buyer email'],
  ['buyer_email_body', 'Buyer email body'],
  ['buyer_email_date_time', 'Buyer email date time'],
  ['communication_history_summary', 'Communication history summary'],
  ['current_email_core_request', 'Current email core request'],
  ['current_issue_factual_summary', 'Current issue factual summary'],
  ['case_background_risk_notes', 'Case background risk notes'],
  ['after_sales_issue_type', 'After-sales issue type'],
  ['current_handling_stage', 'Current handling stage'],
  ['ai_recommended_handling_plan', 'AI recommended handling plan'],
  ['seller_reply_draft_reference', 'Seller reply draft reference'],
  ['seller_internal_action_guide', 'Seller internal action guide'],
  ['manual_confirmation_required', 'Manual confirmation required'],
  ['ai_confidence_level', 'AI confidence level'],
  ['reasoning_explanation', 'Reasoning explanation'],
];

const IMPORT_HEADER_MAP: Record<string, string> = {
  订单编号: 'order_id',
  order_id: 'order_id',
  买家邮箱: 'buyer_email',
  buyer_email: 'buyer_email',
  '表 A 获取深度': 'email4final_depth',
  email4final_depth: 'email4final_depth',
  '表 B 获取深度': 'ai_after_sales_guide_depth',
  ai_after_sales_guide_depth: 'ai_after_sales_guide_depth',
  买家问题类型: 'buyer_issue_type',
  buyer_issue_type: 'buyer_issue_type',
  相关信息补充: 'additional_context',
  additional_context: 'additional_context',
  语气和语言要求: 'tone_and_language_requirement',
  tone_and_language_requirement: 'tone_and_language_requirement',
  回复倾向: 'reply_preference',
  reply_preference: 'reply_preference',
  邮件篇幅: 'email_length',
  email_length: 'email_length',
  邮件抬头: 'reply_greeting',
  回信抬头: 'reply_greeting',
  reply_greeting: 'reply_greeting',
  标准参考案例模版路径: 'standard_case_template_path',
  standard_case_template_path: 'standard_case_template_path',
};

const IMPORT_TEMPLATE_COLUMNS = [
  '订单编号',
  '买家邮箱',
  '回信抬头',
  '买家问题类型',
  '相关信息补充',
  '语气和语言要求',
  '回复倾向',
  '邮件篇幅',
  '标准参考案例模版路径',
  '表 A 获取深度',
  '表 B 获取深度',
];

const IMPORT_TEMPLATE_SAMPLE = [
  'ORDER-20260814-001',
  'buyer@example.com',
  'Dear Customer',
  '物流未送达',
  '买家表示超过预计送达时间 5 天仍未收到',
  '专业、安抚、简洁',
  '优先补寄，必要时退款',
  '中等',
  '/templates/logistics/not-delivered.md',
  3,
  1,
];

function normalizeImportedRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const mappedKey = IMPORT_HEADER_MAP[String(key).trim()];
      if (!mappedKey) {
        continue;
      }
      normalized[mappedKey] = value;
    }
    return normalized;
  });
}

export function AfterSalesBatchPage() {
  const api = useAPIClient();
  const t = useT();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [createVisible, setCreateVisible] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [employeeUsername, setEmployeeUsername] = useState('');
  const [answerTimeoutSeconds, setAnswerTimeoutSeconds] = useState(FALLBACK_ANSWER_TIMEOUT_SECONDS);
  const [maxAnswerTimeoutSeconds, setMaxAnswerTimeoutSeconds] = useState(300);
  const [minAnswerTimeoutSeconds, setMinAnswerTimeoutSeconds] = useState(10);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskRecord, setTaskRecord] = useState<Record<string, any> | null>(null);
  const [keyword, setKeyword] = useState('');
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideRecord, setGuideRecord] = useState<Record<string, any> | null>(null);
  const [editingReply, setEditingReply] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySaving, setReplySaving] = useState(false);
  const [form] = Form.useForm();

  // asyncTasks 的状态是数字：null=等待中 0=处理中 1=成功 -1=失败 -2=已取消
  function formatTaskStatus(status: unknown) {
    if (status === null || status === undefined) {
      return t('Pending');
    }
    if (status === 0) {
      return t('Processing');
    }
    if (status === 1) {
      return t('Succeeded');
    }
    if (status === -1) {
      return t('Failed');
    }
    if (status === -2) {
      return t('Cancelled');
    }
    return String(status);
  }

  async function request(action: string, values?: Record<string, unknown>) {
    const response = await api.request({
      url: `afterSalesBatch:${action}`,
      method: 'post',
      data: values || {},
    });
    // NocoBase 自定义 action 的响应被包了一层 { data: { ... } }，这里解包后再返回业务数据。
    return response?.data?.data ?? response?.data ?? {};
  }

  async function loadEmployees() {
    try {
      const response = await request('listEmployees');
      let sourceRecords = Array.isArray(response.records) ? response.records : [];

      if (!sourceRecords.length) {
        const fallback = await api.resource('aiEmployees').listByUser();
        sourceRecords = Array.isArray(fallback?.data?.data) ? fallback.data.data : [];
      }

      const options = sourceRecords.map((item: Record<string, string>) => ({
        label: item.nickname || item.username,
        value: item.username,
      }));
      setEmployeeOptions(options);
      if (!employeeUsername && options[0]?.value) {
        setEmployeeUsername(String(options[0].value));
      }
      if (!options.length) {
        message.warning(t('No AI employees found'));
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadSettings() {
    try {
      const response = await request('getSettings');
      setAnswerTimeoutSeconds(Number(response.answerTimeoutSeconds || FALLBACK_ANSWER_TIMEOUT_SECONDS));
      setMinAnswerTimeoutSeconds(Number(response.minAnswerTimeoutSeconds || 10));
      setMaxAnswerTimeoutSeconds(Number(response.maxAnswerTimeoutSeconds || 300));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function downloadImportTemplate() {
    const worksheet = XLSX.utils.aoa_to_sheet([IMPORT_TEMPLATE_COLUMNS, IMPORT_TEMPLATE_SAMPLE]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'work_orders');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'after-sales-work-order-template.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    message.success(t('Download template'));
  }

  async function loadWorkOrders(nextPage = page, nextPageSize = pageSize, nextKeyword = keyword, silent = false) {
    if (!silent) {
      setLoading(true);
    }
    try {
      const response = await request('listWorkOrders', {
        page: nextPage,
        pageSize: nextPageSize,
        keyword: nextKeyword,
      });
      setRecords(response.records || []);
      setTotal(Number(response.total || 0));
      setPage(Number(response.page || nextPage));
      setPageSize(Number(response.pageSize || nextPageSize));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function loadTask(currentTaskId: string) {
    const response = await request('getTask', { taskId: currentTaskId });
    setTaskRecord(response);
    // 处理过程中每轮也静默刷新一次列表，让每条工单的状态及时更新
    await loadWorkOrders(1, pageSize, keyword, true);
    if (response?.status === 1 || response?.status === -1 || response?.status === -2) {
      window.localStorage.removeItem('afterSalesBatchTaskId');
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadEmployees();
    void loadWorkOrders(1, pageSize, keyword);
    const savedTaskId = window.localStorage.getItem('afterSalesBatchTaskId');
    if (savedTaskId) {
      setTaskId(savedTaskId);
    }
  }, []);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    void loadTask(taskId);
    const timer = window.setInterval(() => {
      void loadTask(taskId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [taskId]);

  const uploadProps: UploadProps = {
    accept: '.csv,.xlsx,.xls',
    showUploadList: false,
    beforeUpload: async (file) => {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', codepage: 65001 });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const normalizedRows = normalizeImportedRows(rows).filter((row) => row.order_id && row.reply_greeting);
      if (!normalizedRows.length) {
        message.error(t('No valid rows found. Please use the template and keep Order ID + Reply greeting.'));
        return Upload.LIST_IGNORE;
      }
      // 同一次导入内按订单号去重，避免手滑重复上传生成重复回答；不同时间的再次导入仍是新工单。
      const seenOrderIds = new Set<string>();
      const uniqueRows = normalizedRows.filter((row) => {
        const orderId = String(row.order_id).trim();
        if (seenOrderIds.has(orderId)) {
          return false;
        }
        seenOrderIds.add(orderId);
        return true;
      });
      const duplicateCount = normalizedRows.length - uniqueRows.length;
      await request('createWorkOrders', { records: uniqueRows });
      if (duplicateCount > 0) {
        message.warning(t('Ignored duplicate orders', { count: duplicateCount, imported: uniqueRows.length }));
      } else {
        message.success(`${t('Imported records')}: ${uniqueRows.length}`);
      }
      await loadWorkOrders(1, pageSize, keyword);
      return Upload.LIST_IGNORE;
    },
  };

  async function handleCreate(values: Record<string, unknown>) {
    await request('createWorkOrders', { records: [values] });
    setCreateVisible(false);
    form.resetFields();
    await loadWorkOrders(1, pageSize, keyword);
  }

  async function handleDelete() {
    const ids = selectedRowKeys.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    if (!ids.length) {
      return;
    }
    await request('deleteWorkOrders', { ids });
    setSelectedRowKeys([]);
    await loadWorkOrders(page, pageSize, keyword);
  }

  async function handleStartBatch() {
    if (!selectedRowKeys.length) {
      message.warning(t('Please select at least one work order'));
      return;
    }
    if (!employeeUsername) {
      message.warning(t('Please select an AI employee'));
      return;
    }
    const response = await request('startBatch', {
      ids: selectedRowKeys,
      employeeUsername,
      answerTimeoutSeconds,
    });
    setTaskId(String(response.id));
    window.localStorage.setItem('afterSalesBatchTaskId', String(response.id));
    message.success(t('Start batch'));
  }

  async function handleStopBatch() {
    if (!taskId) {
      return;
    }
    await api.resource('asyncTasks').stop({ filterByTk: taskId });
    await loadTask(taskId);
    message.success(t('Stop'));
  }

  async function handleRetryWorkOrder(record: Record<string, any>) {
    if (!employeeUsername) {
      message.warning(t('Please select an AI employee'));
      return;
    }

    const id = Number(record.id);
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }

    await request('updateWorkOrders', {
      ids: [id],
      values: {
        has_ai_guide: '否',
        ai_guide_id: null,
        ai_guide_generated_at: null,
        processing_status: 'pending',
        processing_error: null,
      },
    });

    const response = await request('startBatch', {
      ids: [id],
      employeeUsername,
      answerTimeoutSeconds,
    });
    setTaskId(String(response.id));
    window.localStorage.setItem('afterSalesBatchTaskId', String(response.id));
    message.success(t('Retry'));
    await loadWorkOrders(page, pageSize, keyword);
  }

  async function handleViewGuide(record: Record<string, any>) {
    const guideId = Number(record.ai_guide_id);
    if (!Number.isInteger(guideId) || guideId <= 0) {
      message.warning(t('No guide generated yet'));
      return;
    }
    setGuideVisible(true);
    setGuideLoading(true);
    setGuideRecord(null);
    setEditingReply(false);
    setReplyDraft('');
    try {
      const response = await request('getGuide', { guideId });
      setGuideRecord(response.record || null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGuideLoading(false);
    }
  }

  async function handleSaveReply() {
    const guideId = Number(guideRecord?.id);
    if (!Number.isInteger(guideId) || guideId <= 0) {
      return;
    }
    setReplySaving(true);
    try {
      const response = await request('saveGuideActualReply', { guideId, actualReplyBody: replyDraft });
      setGuideRecord(response.record || guideRecord);
      setEditingReply(false);
      message.success(t('Saved'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setReplySaving(false);
    }
  }

  function handleCancelReply() {
    setEditingReply(false);
    setReplyDraft(guideRecord?.actual_seller_reply_body || '');
  }

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex', padding: 24 }}>
      <Space align="center">
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          {t('After-sales batch workbench')}
        </Typography.Title>
        <Tooltip title={t('Copy route path')}>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={async () => {
              await navigator.clipboard.writeText(AFTER_SALES_BATCH_ROUTE_PATH);
              message.success(t('Copied') + ': ' + AFTER_SALES_BATCH_ROUTE_PATH);
            }}
          />
        </Tooltip>
      </Space>
      <Typography.Paragraph type="secondary">
        {t('The route is independent, which makes it easier to mount under a custom admin menu on the target server.')}{' '}
        {t('Route path')}: {WORK_ORDER_ROUTE}
      </Typography.Paragraph>

      <Card title={t('Batch progress')}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            {t('AI employee')}: {employeeUsername || '-'}
          </div>
          <div>
            {t('Answer guard')}: {t('Each answer is limited to {{seconds}} seconds', { seconds: answerTimeoutSeconds })}
          </div>
          <div>
            {t('Completed')}: {taskRecord?.progressCurrent || 0}
          </div>
          <div>
            {t('Remaining')}: {Math.max((taskRecord?.progressTotal || 0) - (taskRecord?.progressCurrent || 0), 0)}
          </div>
          <Progress
            percent={
              taskRecord?.progressTotal
                ? Number((((taskRecord?.progressCurrent || 0) / taskRecord.progressTotal) * 100).toFixed(2))
                : 0
            }
          />
          <Space>
            {taskRecord?.status !== undefined ? <Tag>{formatTaskStatus(taskRecord.status)}</Tag> : null}
            {(taskRecord?.status === 0 || taskRecord?.status === null) && taskId ? (
              <Button size="small" icon={<StopOutlined />} onClick={() => void handleStopBatch()}>
                {t('Stop')}
              </Button>
            ) : null}
          </Space>
        </Space>
      </Card>

      <Card
        title={t('Work orders')}
        extra={
          <Space>
            <Select
              style={{ width: 240 }}
              placeholder={t('AI employee')}
              value={employeeUsername || undefined}
              onChange={setEmployeeUsername}
              options={employeeOptions}
            />
            <InputNumber
              style={{ width: 180 }}
              min={minAnswerTimeoutSeconds}
              max={maxAnswerTimeoutSeconds}
              value={answerTimeoutSeconds}
              onChange={(value) => setAnswerTimeoutSeconds(Number(value || FALLBACK_ANSWER_TIMEOUT_SECONDS))}
              addonBefore={t('Answer timeout')}
              addonAfter={t('Seconds')}
            />
            <Input.Search
              style={{ width: 240 }}
              placeholder={t('Keyword')}
              allowClear
              onSearch={(value) => {
                setKeyword(value);
                void loadWorkOrders(1, pageSize, value);
              }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkOrders(page, pageSize, keyword)}>
              {t('Refresh')}
            </Button>
            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />}>{t('Import file')}</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} onClick={downloadImportTemplate}>
              {t('Download template')}
            </Button>
            <Button icon={<PlusOutlined />} type="primary" onClick={() => setCreateVisible(true)}>
              {t('Create work order')}
            </Button>
            <Button icon={<PlayCircleOutlined />} onClick={() => void handleStartBatch()}>
              {t('Start batch')}
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>
              {t('Delete selected')}
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={records}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '30', '50', '100'],
            onChange: (nextPage, nextPageSize) => {
              void loadWorkOrders(nextPage, nextPageSize, keyword);
            },
          }}
          columns={[
            { title: t('Order ID'), dataIndex: 'order_id', key: 'order_id' },
            {
              title: t('Buyer email'),
              dataIndex: 'buyer_email',
              key: 'buyer_email',
              ellipsis: { showTitle: true },
            },
            { title: t('Reply greeting'), dataIndex: 'reply_greeting', key: 'reply_greeting' },
            { title: t('Email4Final depth'), dataIndex: 'email4final_depth', key: 'email4final_depth', width: 120 },
            {
              title: t('Guide depth'),
              dataIndex: 'ai_after_sales_guide_depth',
              key: 'ai_after_sales_guide_depth',
              width: 120,
            },
            {
              title: t('Has AI guide'),
              dataIndex: 'has_ai_guide',
              key: 'has_ai_guide',
              render: (value: string) => <Tag color={value === '是' ? 'success' : 'default'}>{value}</Tag>,
            },
            { title: t('Guide ID'), dataIndex: 'ai_guide_id', key: 'ai_guide_id', width: 120 },
            {
              title: t('Processing status'),
              dataIndex: 'processing_status',
              key: 'processing_status',
              render: (value: string) => <Tag color={STATUS_COLOR_MAP[value] || 'default'}>{value}</Tag>,
            },
            { title: t('Processing error'), dataIndex: 'processing_error', key: 'processing_error', ellipsis: true },
            { title: t('Created at'), dataIndex: 'created_at', key: 'created_at', width: 180 },
            { title: t('Generated at'), dataIndex: 'ai_guide_generated_at', key: 'ai_guide_generated_at', width: 180 },
            {
              title: t('Actions'),
              key: 'actions',
              width: 200,
              render: (_value: unknown, record: Record<string, any>) => (
                <Space>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    disabled={!record.ai_guide_id}
                    onClick={() => void handleViewGuide(record)}
                  >
                    {t('View guide')}
                  </Button>
                  <Tooltip title={!employeeUsername ? t('Please select an AI employee') : undefined}>
                    <Button
                      size="small"
                      icon={<RedoOutlined />}
                      disabled={record.processing_status === 'processing' || !employeeUsername}
                      onClick={() => void handleRetryWorkOrder(record)}
                    >
                      {t('Retry')}
                    </Button>
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={createVisible}
        title={t('Create work order')}
        onCancel={() => setCreateVisible(false)}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ email4final_depth: 3, ai_after_sales_guide_depth: 1 }}
          onFinish={(values) => void handleCreate(values)}
        >
          <Form.Item name="order_id" label={t('Order ID')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="buyer_email" label={t('Buyer email')}>
            <Input />
          </Form.Item>
          <Form.Item name="reply_greeting" label={t('Reply greeting')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="buyer_issue_type" label={t('Issue type')}>
            <Input />
          </Form.Item>
          <Form.Item name="additional_context" label={t('Additional context')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tone_and_language_requirement" label={t('Tone and language')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="reply_preference" label={t('Reply preference')}>
            <Input />
          </Form.Item>
          <Form.Item name="email_length" label={t('Email length')}>
            <Input />
          </Form.Item>
          <Form.Item name="standard_case_template_path" label={t('Template path')}>
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="email4final_depth" label={t('Email4Final depth')} style={{ flex: 1 }}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="ai_after_sales_guide_depth" label={t('Guide depth')} style={{ flex: 1 }}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Drawer
        title={t('AI guide detail')}
        open={guideVisible}
        onClose={() => setGuideVisible(false)}
        width={720}
        loading={guideLoading}
      >
        {guideRecord ? (
          <Descriptions column={1} bordered size="small">
            {GUIDE_DISPLAY_FIELDS.map(([field, label]) => (
              <Descriptions.Item key={field} label={t(label)}>
                {guideRecord[field] == null || guideRecord[field] === '' ? '-' : String(guideRecord[field])}
              </Descriptions.Item>
            ))}
            <Descriptions.Item label={t('Actual seller reply')}>
              {editingReply ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Input.TextArea value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={4} />
                  <Space>
                    <Button size="small" type="primary" loading={replySaving} onClick={() => void handleSaveReply()}>
                      {t('Confirm')}
                    </Button>
                    <Button size="small" onClick={handleCancelReply}>
                      {t('Cancel')}
                    </Button>
                  </Space>
                </Space>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{guideRecord.actual_seller_reply_body || '-'}</div>
                  {guideRecord.seller_reply_date_time ? (
                    <Typography.Text type="secondary">
                      {t('Reply time')}: {String(guideRecord.seller_reply_date_time)}
                    </Typography.Text>
                  ) : null}
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setReplyDraft(guideRecord.actual_seller_reply_body || '');
                      setEditingReply(true);
                    }}
                  >
                    {t('Edit')}
                  </Button>
                </Space>
              )}
            </Descriptions.Item>
            {['email_history_csv', 'realtime_express_txt'].map((artifactType) => {
              const url = guideRecord[`${artifactType}_download_url`] as string | undefined;
              return url ? (
                <Descriptions.Item key={artifactType} label={t('Download')}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {artifactType}
                  </a>
                </Descriptions.Item>
              ) : null;
            })}
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">{t('No guide generated yet')}</Typography.Text>
        )}
      </Drawer>
    </Space>
  );
}

export default AfterSalesBatchPage;
