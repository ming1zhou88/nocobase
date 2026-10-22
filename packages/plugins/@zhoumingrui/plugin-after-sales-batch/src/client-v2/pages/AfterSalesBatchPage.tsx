import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
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
  Radio,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useT } from '../locale';

// A 页 / B 页共用同一个组件，按当前地址给"复制路由"不同结果
const WORK_ORDER_ROUTE =
  typeof window !== 'undefined' && window.location.pathname.includes('batch-workbench-b')
    ? '/after-sales/batch-workbench-b'
    : '/after-sales/batch-workbench';
const CN_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * 统一按北京时间显示（口径与飞书邮件时间一致）。
 * 后端返回的 created_at / guide_generated_at 是同一时刻的 UTC ISO 串（如 2026-10-20T18:51:25.000Z），
 * 这里转成 Asia/Shanghai 的 `YYYY-MM-DD HH:mm:ss`；已经是本地时间字符串的原样保留。
 */
function formatCnDateTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = CN_TIME_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** 原料来源（material_sources JSON）→ 人读文本 */
function formatMaterialSources(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  let data: any = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return value;
    }
  }
  const used: string[] = Array.isArray(data?.used_labels) ? data.used_labels : [];
  const notes: string[] = Array.isArray(data?.notes) ? data.notes : [];
  return [used.length ? `已用：${used.join('、')}` : '已用：无', notes.length ? `说明：${notes.join('；')}` : '']
    .filter(Boolean)
    .join('｜');
}

const BATCH_POLL_INTERVAL_MS = 3000;
// 与连接器 MAX_BATCH_SIZE 保持一致（默认 50，可用环境变量覆盖时需同步调整）
const MAX_BATCH_SIZE = 50;

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

// 指南详情里按北京时间展示的时间字段
const GUIDE_TIME_FIELDS = new Set(['buyer_email_time', 'created_time', 'seller_reply_time']);

// 指南详情：文档 20 字段（②～⑳），按顺序展示（实际回信正文单独一块渲染，避免重复）
const GUIDE_DISPLAY_FIELDS: Array<[string, string]> = [
  ['guide_serial', 'Guide serial'],
  ['store_name', 'Store name'],
  ['order_id', 'Order ID'],
  ['buyer_email', 'Buyer email'],
  ['buyer_email_body', 'Buyer email body'],
  ['buyer_email_time', 'Buyer email date time'],
  ['mail_record_id', 'Mail record id'],
  ['communication_history_summary', 'Communication history summary'],
  ['current_email_summary', 'Current email summary'],
  ['buyer_other_info', 'Buyer other info'],
  ['seller_reply_draft', 'Seller reply draft reference'],
  ['seller_action_guide', 'Seller action guide'],
  ['reasoning_explanation', 'Reasoning explanation'],
  ['created_time', 'Created at'],
  ['seller_reply_time', 'Reply time'],
  ['work_order_serial', 'Work order serial'],
  ['material_sources', 'Material sources'],
  ['review_status', 'Review status'],
];

// 导入表头映射（阶段二字段名：tone_and_language / case_template_path / table_a_depth / table_b_depth）
const IMPORT_HEADER_MAP: Record<string, string> = {
  订单编号: 'order_id',
  order_id: 'order_id',
  买家邮箱: 'buyer_email',
  buyer_email: 'buyer_email',
  邮件抬头: 'reply_greeting',
  回信抬头: 'reply_greeting',
  reply_greeting: 'reply_greeting',
  买家问题类型: 'buyer_issue_type',
  buyer_issue_type: 'buyer_issue_type',
  相关信息补充: 'additional_context',
  additional_context: 'additional_context',
  语气和语言要求: 'tone_and_language',
  tone_and_language: 'tone_and_language',
  回复倾向: 'reply_preference',
  reply_preference: 'reply_preference',
  邮件篇幅: 'email_length',
  email_length: 'email_length',
  标准参考案例模版路径: 'case_template_path',
  case_template_path: 'case_template_path',
  '表 A 获取深度': 'table_a_depth',
  表A获取深度: 'table_a_depth',
  table_a_depth: 'table_a_depth',
  '表 B 获取深度': 'table_b_depth',
  表B获取深度: 'table_b_depth',
  table_b_depth: 'table_b_depth',
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
  '113-9233930-0206620',
  'buyer@example.com',
  'Dear Customer',
  '部件受损',
  '买家反馈第二箱玻璃桌面碎裂，希望补发桌板',
  '英文，礼貌专业',
  '先安抚再给方案',
  '中等',
  '/templates/parts/damaged.md',
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
      if (value === '' || value === null || value === undefined) {
        continue;
      }
      normalized[mappedKey] = value;
    }
    return normalized;
  });
}

/** 批次状态 -> 展示文案/颜色 */
const BATCH_STATUS_MAP: Record<string, { color: string; label: string }> = {
  running: { color: 'processing', label: 'Running' },
  all_done: { color: 'success', label: 'All done' },
  part_failed: { color: 'error', label: 'Part failed' },
};

export default function AfterSalesBatchPage() {
  const ctx = useFlowContext();
  const t = useT();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [keyword, setKeyword] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [greetingOptions, setGreetingOptions] = useState(DEFAULT_GREETING_OPTIONS);
  const [createVisible, setCreateVisible] = useState(false);
  // 生成方式：dify = Dify 工作流（默认）；local = NocoBase 内置 AI 员工（本地驱动兜底）
  const [provider, setProvider] = useState<'dify' | 'local'>('dify');
  const [detailRecord, setDetailRecord] = useState<Record<string, any> | null>(null);
  const [form] = Form.useForm();

  const [batchSerial, setBatchSerial] = useState<string | null>(null);
  const [batchRecord, setBatchRecord] = useState<Record<string, any> | null>(null);
  const [starting, setStarting] = useState(false);

  const [decisionVisible, setDecisionVisible] = useState(false);
  const [decisionRows, setDecisionRows] = useState<Record<string, any>[]>([]);
  const [decisionValues, setDecisionValues] = useState<Record<string, 'skip' | 'regenerate'>>({});
  const pendingSerials = useRef<string[]>([]);

  const [guideVisible, setGuideVisible] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideRecord, setGuideRecord] = useState<Record<string, any> | null>(null);
  const [guideSimilarity, setGuideSimilarity] = useState<{ score: number; guide_serial: string } | null>(null);
  const guideMissingMaterials = useMemo(() => {
    const raw = guideRecord?.material_sources;
    if (!raw) return [] as string[];
    let data: any = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return Array.isArray(data?.notes) ? data.notes.filter((note: unknown) => typeof note === 'string') : [];
  }, [guideRecord]);
  const [editingReply, setEditingReply] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySaving, setReplySaving] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);

  async function request(action: string, values?: Record<string, unknown>) {
    const response = await ctx.api.request({
      url: `afterSalesBatch:${action}`,
      method: 'post',
      data: values || {},
    });
    // NocoBase 自定义 action 的响应被包了一层 { data: { ... } }，这里解包后再返回业务数据。
    return response?.data?.data ?? response?.data ?? {};
  }

  async function loadGreetings() {
    try {
      const response = await request('listReplyGreetings');
      const options = (response.records || []).map((item: Record<string, any>) => ({
        label: String(item.greeting),
        value: String(item.greeting),
      }));
      setGreetingOptions(options.length ? options : DEFAULT_GREETING_OPTIONS);
    } catch (error) {
      setGreetingOptions(DEFAULT_GREETING_OPTIONS);
    }
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
    } catch (error) {
      if (!silent) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function loadBatch(currentBatchSerial: string, silent = true) {
    const response = await request('getGuideBatch', { batch_serial: currentBatchSerial });
    setBatchRecord(response.batch || null);
    await loadWorkOrders(1, pageSize, keyword, silent);
    return response.batch as Record<string, any> | null;
  }

  useEffect(() => {
    void loadGreetings();
    void loadWorkOrders(1, pageSize, keyword);
    const savedBatchSerial = window.localStorage.getItem('afterSalesGuideBatchSerial');
    if (savedBatchSerial) {
      setBatchSerial(savedBatchSerial);
    } else {
      // 没有本地记录时回显最近一次批次，避免刷新后进度四项空白
      void (async () => {
        try {
          const latest = await request('listGuideBatches', { limit: 1 });
          const latestBatch = latest.records?.[0];
          if (latestBatch?.batch_serial) {
            setBatchSerial(String(latestBatch.batch_serial));
            setBatchRecord(latestBatch);
          }
        } catch (error) {
          // 取不到最近批次不影响页面
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!batchSerial) {
      return;
    }
    void loadBatch(batchSerial);
    const timer = window.setInterval(async () => {
      const latest = await loadBatch(batchSerial);
      if (latest && latest.status !== 'running') {
        window.clearInterval(timer);
      }
    }, BATCH_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchSerial]);

  const batchProgress = useMemo(() => {
    const totalCount = Number(batchRecord?.total_count || 0);
    const done = Number(batchRecord?.done_count || 0);
    const pending = Number(batchRecord?.pending_count || 0);
    const failed = Number(batchRecord?.failed_count || 0);
    const skipped = Number(batchRecord?.skipped_count || 0);
    return {
      totalCount,
      done,
      pending,
      failed,
      skipped,
      percent: totalCount ? Number((((done + failed + skipped) / totalCount) * 100).toFixed(2)) : 0,
    };
  }, [batchRecord]);

  /** 触发批次：先创建（不执行）→ 后台执行 → 轮询进度 */
  async function triggerBatch(serials: string[], decisions: Record<string, string> = {}, defaultAction = 'generate') {
    if (!serials.length) {
      message.warning(t('Please select at least one work order'));
      return;
    }
    if (serials.length > MAX_BATCH_SIZE) {
      message.warning(t('Batch size limit', { max: MAX_BATCH_SIZE, count: serials.length }));
      return;
    }
    setStarting(true);
    try {
      const response = await request('startGuideBatch', {
        work_order_serials: serials,
        decisions,
        default_action: defaultAction,
        provider,
      });
      const nextBatchSerial = response.batch?.batch_serial;
      if (nextBatchSerial) {
        setBatchSerial(String(nextBatchSerial));
        window.localStorage.setItem('afterSalesGuideBatchSerial', String(nextBatchSerial));
      }
      setBatchRecord(response.batch || null);
      if (response.accepted === false && response.reason) {
        message.info(String(response.reason));
      } else {
        message.success(t('Start batch'));
      }
      setSelectedRowKeys([]);
      await loadWorkOrders(1, pageSize, keyword, true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  /** 触发前检查：已有指南的工单按规格第三步提示"去除 / 重新生成" */
  async function handleStartBatch() {
    const serials = selectedRowKeys.map((value) => String(value));
    if (!serials.length) {
      message.warning(t('Please select at least one work order'));
      return;
    }
    try {
      const inspected = await request('inspectWorkOrders', { work_order_serials: serials });
      const existing = (inspected.records || []).filter((item: Record<string, any>) => item.has_guide);
      if (existing.length) {
        pendingSerials.current = serials;
        setDecisionRows(existing);
        setDecisionValues(
          Object.fromEntries(
            existing.map((item: Record<string, any>) => [
              item.work_order_serial,
              item.has_actual_reply || item.review_status === '已审核' ? 'skip' : 'regenerate',
            ]),
          ),
        );
        setDecisionVisible(true);
        return;
      }
      await triggerBatch(serials);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmDecisions() {
    setDecisionVisible(false);
    await triggerBatch(pendingSerials.current, decisionValues);
  }

  async function handleRetryBatch() {
    if (!batchSerial) {
      message.warning(t('No batch yet'));
      return;
    }
    setStarting(true);
    try {
      await request('retryGuideBatch', { batch_serial: batchSerial });
      message.success(t('Retry'));
      await loadBatch(batchSerial, false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  /** 单条"重新生成"：解绑旧记录（旧记录保留、不再参与参考）后单独跑一个批次 */
  async function handleRegenerate(record: Record<string, any>) {
    const serial = String(record.work_order_serial || '');
    if (!serial) {
      return;
    }
    modal.confirm({
      title: t('Regenerate'),
      content: t('Regenerate confirm'),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      onOk: async () => {
        await triggerBatch([serial], { [serial]: 'regenerate' });
      },
    });
  }

  async function handleDelete() {
    const serials = selectedRowKeys.map((value) => String(value)).filter(Boolean);
    if (!serials.length) {
      return;
    }
    modal.confirm({
      title: t('Delete selected'),
      content: t('Delete confirm'),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await request('deleteWorkOrders', { work_order_serials: serials });
          setSelectedRowKeys([]);
          await loadWorkOrders(page, pageSize, keyword);
          message.success(t('Deleted'));
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }

  async function openCreateModal() {
    let greeting = '';
    try {
      const response = await ctx.api.request({ url: 'auth:check' });
      const user = response?.data?.data ?? response?.data ?? {};
      greeting = user.replyGreeting || user.reply_greeting || '';
    } catch {
      greeting = '';
    }
    if (!greeting) {
      message.warning('请先配置个人邮件抬头');
    }
    form.setFieldsValue({ reply_greeting: greeting, table_a_depth: 3, table_b_depth: 1 });
    setCreateVisible(true);
  }

  async function handleCreate(values: Record<string, unknown>) {
    try {
      await request('createWorkOrders', { records: [values] });
      setCreateVisible(false);
      form.resetFields();
      await loadWorkOrders(1, pageSize, keyword);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  const uploadProps: UploadProps = {
    accept: '.csv,.xlsx,.xls',
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', codepage: 65001 });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        const normalizedRows = normalizeImportedRows(rows);
        // 回信抬头必须取候选项（连接器侧同样校验，这里提前给出可读报错）
        const greetingColumnLetter = columnLetter(IMPORT_TEMPLATE_COLUMNS.indexOf('回信抬头'));
        const greetingCandidates = new Set([
          ...DEFAULT_REPLY_GREETINGS,
          ...greetingOptions.map((option) => String(option.value)),
        ]);
        const invalidGreetings = normalizedRows
          .map((row, index) => ({ value: String(row.reply_greeting || '').trim(), rowNumber: index + 2 }))
          .filter((item) => item.value && !greetingCandidates.has(item.value));
        if (invalidGreetings.length) {
          message.error(
            t('Invalid reply greeting in column {{column}}: {{values}}', {
              column: greetingColumnLetter,
              values: [...new Set(invalidGreetings.map((item) => item.value))].join('、'),
            }),
          );
          return Upload.LIST_IGNORE;
        }
        const validRows = normalizedRows.filter((row) => row.order_id || row.buyer_email);
        if (!validRows.length) {
          message.error(t('No valid rows found. Please use the template and keep Order ID + Reply greeting.'));
          return Upload.LIST_IGNORE;
        }
        // 同一次导入内按"订单号 + 邮箱"去重，避免重复上传；不同时间的再次导入仍是新工单。
        const seen = new Set<string>();
        const uniqueRows = validRows.filter((row) => {
          const key = `${row.order_id || ''}|${row.buyer_email || ''}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
        const duplicateCount = validRows.length - uniqueRows.length;
        await request('createWorkOrders', { records: uniqueRows });
        if (duplicateCount > 0) {
          message.warning(t('Ignored duplicate orders', { count: duplicateCount, imported: uniqueRows.length }));
        } else {
          message.success(`${t('Imported records')}: ${uniqueRows.length}`);
        }
        await loadWorkOrders(1, pageSize, keyword);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
      return Upload.LIST_IGNORE;
    },
  };

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

  async function handleViewGuide(record: Record<string, any>) {
    const guideSerial = String(record.guide_serial || '');
    if (!guideSerial) {
      message.warning(t('No guide generated yet'));
      return;
    }
    setGuideVisible(true);
    setGuideLoading(true);
    setGuideRecord(null);
    setGuideSimilarity(null);
    setEditingReply(false);
    setReplyDraft('');
    try {
      const response = await request('getGuide', { guide_serial: guideSerial });
      setGuideSimilarity((response as any).previous_guide_similarity || null);
      let record = response.guide || null;
      // 核查文件链接以"插件侧配置的连接器地址"为准：
      // 库里存的是连接器生成时的绝对地址（本地/生产环境不同），这里覆盖成本地可访问的地址。
      try {
        const links = await request('getGuideArtifactUrls', { guide_serial: guideSerial });
        if (record && links?.links) {
          record = {
            ...record,
            email_history_csv_url: links.links.email_history_csv,
            realtime_express_txt_url: links.links.realtime_express_txt,
          };
        }
      } catch (error) {
        // 取不到就用库里存的绝对地址
      }
      setGuideRecord(record);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGuideLoading(false);
    }
  }

  /** 审核：标"已审核"（表 B 参考的可用条件之一） */
  async function handleReview(nextStatus: '已审核' | '') {
    const guideSerial = String(guideRecord?.guide_serial || '');
    if (!guideSerial) {
      return;
    }
    setReviewSaving(true);
    try {
      const response = await request('updateGuide', {
        guide_serial: guideSerial,
        values: { review_status: nextStatus },
      });
      setGuideRecord(response.guide || guideRecord);
      message.success(t('Saved'));
      await loadWorkOrders(page, pageSize, keyword, true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleSaveReply() {
    const guideSerial = String(guideRecord?.guide_serial || '');
    if (!guideSerial) {
      return;
    }
    setReplySaving(true);
    try {
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      const sellerReplyTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
        now.getHours(),
      )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const response = await request('updateGuide', {
        guide_serial: guideSerial,
        values: { actual_seller_reply_body: replyDraft, seller_reply_time: sellerReplyTime },
      });
      setGuideRecord(response.guide || guideRecord);
      setEditingReply(false);
      message.success(t('Saved'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setReplySaving(false);
    }
  }

  const batchStatus = BATCH_STATUS_MAP[String(batchRecord?.status || '')] || null;
  const failures = Array.isArray(batchRecord?.failure_detail) ? batchRecord.failure_detail : [];

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
              await navigator.clipboard.writeText(WORK_ORDER_ROUTE);
              message.success(t('Copied') + ': ' + WORK_ORDER_ROUTE);
            }}
          />
        </Tooltip>
      </Space>
      <Typography.Paragraph type="secondary">
        {t('The route is independent, which makes it easier to mount under a custom admin menu on the target server.')}{' '}
        {t('Route path')}: {WORK_ORDER_ROUTE}
      </Typography.Paragraph>

      <Card
        title={t('Batch progress')}
        extra={
          <Space>
            {batchStatus ? <Tag color={batchStatus.color}>{t(batchStatus.label)}</Tag> : null}
            <Typography.Text type="secondary">
              {batchSerial ? `${t('Batch serial')}: ${batchSerial}` : t('No batch yet')}
            </Typography.Text>
            <Button
              size="small"
              icon={<RedoOutlined />}
              loading={starting}
              disabled={!batchSerial || Number(batchRecord?.failed_count || 0) === 0}
              onClick={() => void handleRetryBatch()}
            >
              {t('Retry failed')}
            </Button>
          </Space>
        }
      >
        <Space size={48} wrap>
          <Statistic title={t('Total')} value={batchProgress.totalCount} />
          <Statistic title={t('Completed')} value={batchProgress.done} valueStyle={{ color: '#3f8600' }} />
          <Statistic title={t('Remaining')} value={batchProgress.pending} />
          <Statistic title={t('Failed')} value={batchProgress.failed} valueStyle={{ color: '#cf1322' }} />
          <Statistic title={t('Skipped')} value={batchProgress.skipped} />
        </Space>
        <Progress percent={batchProgress.percent} style={{ marginTop: 16 }} />
        {failures.length ? (
          <Alert
            type="error"
            style={{ marginTop: 12 }}
            message={t('Failure detail')}
            description={
              <Space direction="vertical" size={2}>
                {failures.map((item: Record<string, any>) => (
                  <Typography.Text key={String(item.work_order_serial)}>
                    {String(item.work_order_serial)}：{String(item.reason || '')}
                  </Typography.Text>
                ))}
              </Space>
            }
          />
        ) : null}
      </Card>

      <Card
        title={t('Work orders')}
        extra={
          <Space wrap>
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
            <Button icon={<PlusOutlined />} type="primary" onClick={() => void openCreateModal()}>
              {t('Create work order')}
            </Button>
            <Select
              style={{ width: 150 }}
              value={provider}
              onChange={(value) => setProvider(value)}
              options={[
                { value: 'dify', label: t('Dify workflow') },
                { value: 'local', label: t('Local AI employee') },
              ]}
            />
            <Button icon={<PlayCircleOutlined />} loading={starting} onClick={() => void handleStartBatch()}>
              {t('Start batch')}
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>
              {t('Delete selected')}
            </Button>
            <Typography.Text type="secondary">
              {t('Batch size hint')}（{selectedRowKeys.length}/{MAX_BATCH_SIZE}）
            </Typography.Text>
          </Space>
        }
      >
        <Table
          rowKey="work_order_serial"
          loading={loading}
          dataSource={records}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          scroll={{ x: 1400 }}
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
            { title: t('Work order serial'), dataIndex: 'work_order_serial', key: 'work_order_serial', width: 200 },
            {
              title: t('Creation source'),
              dataIndex: 'creation_source',
              key: 'creation_source',
              width: 150,
              render: (value: string) => (value === 'daily' ? t('Daily order push') : t('Local creation')),
            },
            {
              title: t('Owner'),
              dataIndex: 'owner_name',
              key: 'owner_name',
              width: 100,
              render: (value: string | null) => value || '-',
            },
            {
              title: t('Order ID'),
              dataIndex: 'order_id',
              key: 'order_id',
              width: 210,
              render: (value: string | null) => (value ? <span style={{ whiteSpace: 'nowrap' }}>{value}</span> : '-'),
            },
            { title: t('Issue type'), dataIndex: 'buyer_issue_type', key: 'buyer_issue_type', width: 140 },
            {
              // 表 A / 表 B 获取深度合并为一列，和旧版工作台一致（如 3/1）
              title: t('Fetch depth (A/B)'),
              key: 'fetch_depth',
              width: 130,
              render: (_value: unknown, record: Record<string, any>) =>
                `${record.table_a_depth ?? '-'} / ${record.table_b_depth ?? '-'}`,
            },
            {
              title: t('Has AI guide'),
              dataIndex: 'has_guide',
              key: 'has_guide',
              width: 120,
              render: (value: string) => <Tag color={value === '是' ? 'success' : 'default'}>{value}</Tag>,
            },
            {
              title: t('Guide serial'),
              dataIndex: 'guide_serial',
              key: 'guide_serial',
              width: 200,
              render: (value: string | null) => value || '-',
            },
            {
              title: t('Generated at'),
              dataIndex: 'guide_generated_at',
              key: 'guide_generated_at',
              width: 180,
              render: (value: string | null) => formatCnDateTime(value),
            },
            {
              title: t('Created at'),
              dataIndex: 'created_at',
              key: 'created_at',
              width: 180,
              render: (value: string | null) => formatCnDateTime(value),
            },
            {
              title: t('Actions'),
              key: 'actions',
              fixed: 'right' as const,
              width: 260,
              render: (_value: unknown, record: Record<string, any>) => (
                <Space>
                  <Button size="small" type="link" onClick={() => setDetailRecord(record)}>
                    {t('View details')}
                  </Button>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    disabled={!record.guide_serial}
                    onClick={() => void handleViewGuide(record)}
                  >
                    {t('View guide')}
                  </Button>
                  <Button
                    size="small"
                    icon={<RedoOutlined />}
                    disabled={
                      !record.guide_serial || record.guide_review_status === '已审核' || record.guide_has_actual_reply
                    }
                    title={
                      record.guide_review_status === '已审核'
                        ? t('Regenerate blocked reviewed')
                        : record.guide_has_actual_reply
                          ? t('Regenerate blocked replied')
                          : undefined
                    }
                    onClick={() => void handleRegenerate(record)}
                  >
                    {t('Regenerate')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={Boolean(detailRecord)}
        title={t('Work order details')}
        onClose={() => setDetailRecord(null)}
        width={620}
        destroyOnClose
      >
        {detailRecord ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions
              title={t('Basic info')}
              bordered
              column={1}
              size="small"
              labelStyle={{ width: 150, whiteSpace: 'nowrap' }}
            >
              <Descriptions.Item label={t('Work order serial')}>
                {detailRecord.work_order_serial || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('Creation source')}>
                {detailRecord.creation_source === 'daily' ? t('Daily order push') : t('Local creation')}
              </Descriptions.Item>
              <Descriptions.Item label={t('Owner')}>{detailRecord.owner_name || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('Created at')}>{formatCnDateTime(detailRecord.created_at)}</Descriptions.Item>
              <Descriptions.Item label={t('Generated at')}>
                {formatCnDateTime(detailRecord.guide_generated_at)}
              </Descriptions.Item>
            </Descriptions>
            <Descriptions
              title={t('Order and buyer')}
              bordered
              column={1}
              size="small"
              labelStyle={{ width: 150, whiteSpace: 'nowrap' }}
            >
              <Descriptions.Item label={t('Order ID')}>{detailRecord.order_id || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('Buyer email')}>{detailRecord.buyer_email || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('Issue type')}>{detailRecord.buyer_issue_type || '-'}</Descriptions.Item>
            </Descriptions>
            <Descriptions
              title={t('Reply settings')}
              bordered
              column={1}
              size="small"
              labelStyle={{ width: 150, whiteSpace: 'nowrap' }}
            >
              <Descriptions.Item label={t('Reply greeting')}>{detailRecord.reply_greeting || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('Additional context')}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{detailRecord.additional_context || '-'}</div>
              </Descriptions.Item>
              <Descriptions.Item label={t('Tone and language')}>
                {detailRecord.tone_and_language || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('Reply preference')}>
                {detailRecord.reply_preference || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('Email length')}>{detailRecord.email_length || '-'}</Descriptions.Item>
            </Descriptions>
            <Descriptions
              title={t('Template')}
              bordered
              column={1}
              size="small"
              labelStyle={{ width: 150, whiteSpace: 'nowrap' }}
            >
              <Descriptions.Item label={t('Template path')}>{detailRecord.case_template_path || '-'}</Descriptions.Item>
            </Descriptions>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        open={createVisible}
        title={t('Create work order')}
        onCancel={() => setCreateVisible(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ table_a_depth: 3, table_b_depth: 1 }}
          onFinish={(values) => void handleCreate(values)}
        >
          <Alert style={{ marginBottom: 12 }} type="info" message={t('Order id or buyer email required')} showIcon />
          <Form.Item name="order_id" label={t('Order ID')}>
            <Input placeholder="113-9233930-0206620" />
          </Form.Item>
          <Form.Item name="buyer_email" label={t('Buyer email')}>
            <Input placeholder="buyer@example.com" />
          </Form.Item>
          <Form.Item name="reply_greeting" label={t('Reply greeting')} rules={[{ required: true }]}>
            <Select options={greetingOptions} />
          </Form.Item>
          <Form.Item name="buyer_issue_type" label={t('Issue type')}>
            <Input />
          </Form.Item>
          <Form.Item name="additional_context" label={t('Additional context')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tone_and_language" label={t('Tone and language')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="reply_preference" label={t('Reply preference')}>
            <Input />
          </Form.Item>
          <Form.Item name="email_length" label={t('Email length')}>
            <Input />
          </Form.Item>
          <Form.Item name="case_template_path" label={t('Template path')}>
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="table_a_depth" label={t('Table A depth')} style={{ flex: 1 }}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="table_b_depth" label={t('Table B depth')} style={{ flex: 1 }}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={decisionVisible}
        title={t('Existing guides found')}
        onCancel={() => setDecisionVisible(false)}
        onOk={() => void confirmDecisions()}
        okText={t('Confirm')}
        cancelText={t('Cancel')}
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('Skip or regenerate tip')} />
        <Space direction="vertical" style={{ width: '100%' }}>
          {decisionRows.map((row) => (
            <Space key={String(row.work_order_serial)} style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text>
                {String(row.work_order_serial)}（{String(row.guide_serial || '-')}）
                {row.has_actual_reply || row.review_status === '已审核' ? (
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                    {row.review_status === '已审核'
                      ? t('Regenerate blocked reviewed')
                      : t('Regenerate blocked replied')}
                  </Typography.Text>
                ) : null}
              </Typography.Text>
              <Radio.Group
                value={decisionValues[String(row.work_order_serial)] || 'regenerate'}
                onChange={(event) =>
                  setDecisionValues((prev) => ({
                    ...prev,
                    [String(row.work_order_serial)]: event.target.value,
                  }))
                }
              >
                <Radio.Button
                  value="regenerate"
                  disabled={Boolean(row.has_actual_reply) || row.review_status === '已审核'}
                >
                  {t('Regenerate')}
                </Radio.Button>
                <Radio.Button value="skip">{t('Skip')}</Radio.Button>
              </Radio.Group>
            </Space>
          ))}
        </Space>
      </Modal>

      <Drawer
        title={t('AI guide detail')}
        open={guideVisible}
        onClose={() => setGuideVisible(false)}
        width={860}
        loading={guideLoading}
        extra={
          guideRecord ? (
            <Space>
              <Tag color={guideRecord.review_status === '已审核' ? 'success' : 'default'}>
                {guideRecord.review_status === '已审核' ? t('Reviewed') : t('Not reviewed')}
              </Tag>
              <Button
                size="small"
                type="primary"
                loading={reviewSaving}
                disabled={guideRecord.review_status === '已审核'}
                onClick={() => void handleReview('已审核')}
              >
                {t('Mark reviewed')}
              </Button>
              <Button
                size="small"
                loading={reviewSaving}
                disabled={guideRecord.review_status !== '已审核'}
                onClick={() => void handleReview('')}
              >
                {t('Clear review')}
              </Button>
              {guideRecord.email_history_csv_url ? (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  href={String(guideRecord.email_history_csv_url)}
                  target="_blank"
                >
                  {t('Email history CSV')}
                </Button>
              ) : null}
              {guideRecord.realtime_express_txt_url ? (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  href={String(guideRecord.realtime_express_txt_url)}
                  target="_blank"
                >
                  {t('Realtime express TXT')}
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {guideRecord ? (
          <>
            {guideSimilarity && guideSimilarity.score >= 0.85 ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={t('Similar to previous guide')}
                description={`${Math.round(guideSimilarity.score * 100)}% · ${guideSimilarity.guide_serial}`}
              />
            ) : null}
            {guideMissingMaterials.length ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={t('Material missing tip')}
                description={guideMissingMaterials.join('；')}
              />
            ) : null}
            <Descriptions column={1} bordered size="small" labelStyle={{ width: 120, whiteSpace: 'normal' }}>
              {GUIDE_DISPLAY_FIELDS.map(([field, label]) => (
                <Descriptions.Item key={field} label={t(label)}>
                  {guideRecord[field] == null || guideRecord[field] === '' ? (
                    '-'
                  ) : field === 'material_sources' ? (
                    formatMaterialSources(guideRecord[field])
                  ) : GUIDE_TIME_FIELDS.has(field) ? (
                    formatCnDateTime(guideRecord[field])
                  ) : field === 'buyer_email_body' || String(guideRecord[field]).length > 120 ? (
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                      {String(guideRecord[field])}
                    </Typography.Paragraph>
                  ) : (
                    String(guideRecord[field])
                  )}
                </Descriptions.Item>
              ))}
              <Descriptions.Item label={t('Actual seller reply')}>
                {editingReply ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Input.TextArea
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      rows={6}
                    />
                    <Space>
                      <Button size="small" type="primary" loading={replySaving} onClick={() => void handleSaveReply()}>
                        {t('Confirm')}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setEditingReply(false);
                          setReplyDraft(guideRecord.actual_seller_reply_body || '');
                        }}
                      >
                        {t('Cancel')}
                      </Button>
                    </Space>
                  </Space>
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{guideRecord.actual_seller_reply_body || '-'}</div>
                    {guideRecord.actual_seller_reply_body ? null : (
                      // 已发出的回信正文是既成事实，正常不提供编辑；只有抓取为空时允许补录
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setReplyDraft('');
                          setEditingReply(true);
                        }}
                      >
                        {t('Backfill reply')}
                      </Button>
                    )}
                  </Space>
                )}
              </Descriptions.Item>
            </Descriptions>
          </>
        ) : (
          <Typography.Text type="secondary">{t('No guide generated yet')}</Typography.Text>
        )}
      </Drawer>
    </Space>
  );
}
