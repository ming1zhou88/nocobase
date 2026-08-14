import {
  DownloadOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RedoOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
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
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useT } from '../locale';

const WORK_ORDER_ROUTE = '/after-sales/batch-workbench';
const FALLBACK_ANSWER_TIMEOUT_SECONDS = 60;

const DEFAULT_REPLY_GREETINGS = [
  'Hi',
  'Hello',
  'Dear Buyer',
  'Dear Customer',
  'Hi Customer',
  'Hi Buyer',
  'Hello Customer',
  'Hello Buyer',
];

const DEFAULT_GREETING_OPTIONS = DEFAULT_REPLY_GREETINGS.map((greeting) => ({ label: greeting, value: greeting }));

const STATUS_COLOR_MAP: Record<string, string> = {
  pending: 'default',
  processing: 'processing',
  succeeded: 'success',
  failed: 'error',
  skipped: 'warning',
};

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

function columnLetter(index: number) {
  let letter = '';
  let value = index;
  while (value >= 0) {
    letter = String.fromCharCode(65 + (value % 26)) + letter;
    value = Math.floor(value / 26) - 1;
  }
  return letter;
}

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

export default function AfterSalesBatchPage() {
  const ctx = useFlowContext();
  const t = useT();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [createVisible, setCreateVisible] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [greetingOptions, setGreetingOptions] =
    useState<Array<{ label: string; value: string }>>(DEFAULT_GREETING_OPTIONS);
  const [employeeUsername, setEmployeeUsername] = useState('');
  const [answerTimeoutSeconds, setAnswerTimeoutSeconds] = useState(FALLBACK_ANSWER_TIMEOUT_SECONDS);
  const [maxAnswerTimeoutSeconds, setMaxAnswerTimeoutSeconds] = useState(300);
  const [minAnswerTimeoutSeconds, setMinAnswerTimeoutSeconds] = useState(10);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [taskRecord, setTaskRecord] = useState<Record<string, any> | null>(null);
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm();

  async function request(action: string, values?: Record<string, unknown>) {
    const response = await ctx.api.request({
      url: `afterSalesBatch:${action}`,
      method: 'post',
      data: values || {},
    });
    return response.data;
  }

  async function loadEmployees() {
    try {
      const response = await request('listEmployees');
      let sourceRecords = Array.isArray(response.records) ? response.records : [];

      if (!sourceRecords.length) {
        const fallback = await ctx.api.resource('aiEmployees').listByUser();
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

  async function loadReplyGreetings() {
    try {
      const response = await request('listReplyGreetings');
      const sourceRecords = Array.isArray(response.records) ? response.records : [];
      const options = sourceRecords
        .map((item: Record<string, unknown>) => {
          const greeting = String(item.greeting || '').trim();
          return greeting ? { label: greeting, value: greeting } : null;
        })
        .filter((item): item is { label: string; value: string } => item !== null);
      setGreetingOptions(options.length ? options : DEFAULT_GREETING_OPTIONS);
    } catch (error) {
      setGreetingOptions(DEFAULT_GREETING_OPTIONS);
    }
  }

  function downloadImportTemplate() {
    const worksheet = XLSX.utils.aoa_to_sheet([IMPORT_TEMPLATE_COLUMNS, IMPORT_TEMPLATE_SAMPLE]);
    const greetingColumnLetter = columnLetter(IMPORT_TEMPLATE_COLUMNS.indexOf('回信抬头'));
    if (greetingColumnLetter) {
      const greetingList = Array.from(
        new Set([...DEFAULT_REPLY_GREETINGS, ...greetingOptions.map((option) => option.value)]),
      ).join(',');
      const dataValidations: Record<string, { type: string; formulae: string[]; allowBlank: boolean }> = {};
      for (let row = 2; row <= 1001; row += 1) {
        dataValidations[`${greetingColumnLetter}${row}`] = {
          type: 'list',
          formulae: [`"${greetingList}"`],
          allowBlank: true,
        };
      }
      worksheet['!dataValidations'] = dataValidations;
    }
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

  async function loadWorkOrders(nextPage = page, nextPageSize = pageSize, nextKeyword = keyword) {
    setLoading(true);
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
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadTask(currentTaskId: number) {
    try {
      const response = await request('getTask', { taskId: currentTaskId });
      setTaskRecord(response);
      if (response?.status === 'succeeded' || response?.status === 'failed' || response?.status === 'canceled') {
        await loadWorkOrders();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadEmployees();
    void loadReplyGreetings();
    void loadWorkOrders(1, pageSize, keyword);
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
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const normalizedRows = normalizeImportedRows(rows).filter((row) => row.order_id && row.reply_greeting);
      if (!normalizedRows.length) {
        message.error(t('No valid rows found. Please use the template and keep Order ID + Reply greeting.'));
        return Upload.LIST_IGNORE;
      }
      await request('createWorkOrders', { records: normalizedRows });
      message.success(`${t('Imported records')}: ${normalizedRows.length}`);
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
    setTaskId(Number(response.id));
    message.success(t('Start batch'));
  }

  async function handleStopBatch() {
    if (!taskId) {
      return;
    }
    await ctx.api.resource('asyncTasks').stop({ filterByTk: taskId });
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
    setTaskId(Number(response.id));
    message.success(t('Retry'));
    await loadWorkOrders(page, pageSize, keyword);
  }

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex', padding: 24 }}>
      <Typography.Title level={3}>{t('After-sales batch workbench')}</Typography.Title>
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
            {taskRecord?.status ? <Tag>{taskRecord.status}</Tag> : null}
            {(taskRecord?.status === 'running' || taskRecord?.status === 'pending') && taskId ? (
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
            onChange: (nextPage, nextPageSize) => {
              void loadWorkOrders(nextPage, nextPageSize, keyword);
            },
          }}
          columns={[
            { title: t('Order ID'), dataIndex: 'order_id', key: 'order_id' },
            { title: t('Buyer email'), dataIndex: 'buyer_email', key: 'buyer_email' },
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
              width: 120,
              render: (_value: unknown, record: Record<string, any>) => (
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
            <Select placeholder={t('Reply greeting')} options={greetingOptions} showSearch />
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
    </Space>
  );
}
