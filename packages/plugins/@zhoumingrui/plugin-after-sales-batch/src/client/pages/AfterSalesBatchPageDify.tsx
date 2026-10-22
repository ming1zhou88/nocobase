import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useAPIClient } from '@nocobase/client';
import { AFTER_SALES_BATCH_ROUTE_PATH } from '../plugin';
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
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useT } from '../locale';

const WORK_ORDER_ROUTE = '/admin/after-sales/batch-workbench-b';
const BATCH_POLL_INTERVAL_MS = 3000;

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

/**
 * 抽屉里的通用字段列表（文档 20 字段中的②～⑳，按顺序展示）。
 *
 * 注意两个"回信正文"是**两个独立字段**，不要合并：
 *   - `seller_reply_draft`       ⑪ AI 生成的「卖家回信正文参考」
 *   - `actual_seller_reply_body` ⑮ 「实际发送的卖家回信正文」——由程序从表 A 的卖家邮件回填
 * 各自单独一行展示，顺序与文档字段编号一致。
 */
const GUIDE_TIME_FIELDS = new Set(['buyer_email_time', 'created_time', 'seller_reply_time']);

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
  ['actual_seller_reply_body', 'Actual seller reply'],
  ['seller_reply_time', 'Reply time'],
  ['work_order_serial', 'Work order serial'],
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

/**
 * 单元格文字样式：装不下就换行，最多两行；超过两行才省略。
 * 之前用 `nowrap`/`ellipsis` 会截断，必须先 hover 才能看到完整值，用户明确要求改成换行。
 */
const CELL_WRAP_STYLE: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'break-all',
  lineHeight: 1.3,
};

/**
 * 平台订单编号专用样式：**必须一行显示，不换行、不截断**（用户明确要求）。
 * 实测平台单号固定 19 字符（`113-9233930-0206620`），等宽字体下宽度稳定可控。
 */
const ORDER_ID_STYLE: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'visible',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.2px',
};

/**
 * 序列号显示。
 *
 * 现行格式：纯数字 11 位 = 类型前缀(1/2/3) + YYMMDD + 4 位序号，如 `12610130123`
 *   → 本身就是最短形态，原样显示。
 * 历史格式：`ASWO-20261011-GRPJJZ8Q`（旧数据仍在库里）
 *   → 第一段（类型）已由列名表达，压成「日期-唯一码」两段显示。
 * 两种形状都要兼容，所以这里按"是否含短横线"分支。
 */
function shortSerial(value: unknown) {
  const text = String(value ?? '');
  const parts = text.split('-');
  if (parts.length < 3) {
    return text;
  }
  return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
}

/**
 * 紧凑日期时间：后端返回的是 ISO 串（`2026-10-12T17:19:33.000Z`），
 * 直接渲染会折成两行且带无意义的 `.000Z`。这里拆成日期/时间两行显示。
 */
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

/** 统一按北京时间显示（与飞书邮件时间口径一致），输出 `YYYY-MM-DD HH:mm:ss`。 */
function formatCnDateTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = CN_TIME_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function CompactDateTime({ value }: { value?: string | null }) {
  if (!value) {
    return <span>-</span>;
  }
  const formatted = formatCnDateTime(value);
  const [date, time] = formatted.split(' ');
  return (
    <Tooltip title={formatted}>
      <div style={{ lineHeight: 1.25, whiteSpace: 'nowrap' }}>
        <div>{date || '-'}</div>
        {time ? <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{time}</div> : null}
      </div>
    </Tooltip>
  );
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

export function AfterSalesBatchDifyPage() {
  const api = useAPIClient();
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
  const [form] = Form.useForm();

  const [batchSerial, setBatchSerial] = useState<string | null>(null);
  const [batchRecord, setBatchRecord] = useState<Record<string, any> | null>(null);
  const [starting, setStarting] = useState(false);
  /**
   * 生成方式：dify = 走 Dify 工作流（默认）；local = 走 NocoBase 内置 AI 员工
   * （本地驱动，Dify 不可用时的兜底）。两者写同一张 V2 表、六字段口径一致，
   * 差别只在"谁来生成"，用于三方对比测试。
   */
  const [provider, setProvider] = useState<'dify' | 'local'>('dify');

  const [decisionVisible, setDecisionVisible] = useState(false);
  const [decisionRows, setDecisionRows] = useState<Record<string, any>[]>([]);
  const [decisionValues, setDecisionValues] = useState<Record<string, 'skip' | 'regenerate'>>({});
  const pendingSerials = useRef<string[]>([]);

  const [guideVisible, setGuideVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<Record<string, any> | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideRecord, setGuideRecord] = useState<Record<string, any> | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);

  async function request(action: string, values?: Record<string, unknown>) {
    const response = await api.request({
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
          Object.fromEntries(existing.map((item: Record<string, any>) => [item.work_order_serial, 'regenerate'])),
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
        const normalizedRows = normalizeImportedRows(rows).filter((row) => row.order_id || row.buyer_email);
        if (!normalizedRows.length) {
          message.error(t('No valid rows found. Please use the template and keep Order ID + Reply greeting.'));
          return Upload.LIST_IGNORE;
        }
        // 同一次导入内按"订单号 + 邮箱"去重，避免重复上传；不同时间的再次导入仍是新工单。
        const seen = new Set<string>();
        const uniqueRows = normalizedRows.filter((row) => {
          const key = `${row.order_id || ''}|${row.buyer_email || ''}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
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
    try {
      const response = await request('getGuide', { guide_serial: guideSerial });
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

  /*
    原先这里有个 handleSaveReply：把人工输入的回信正文 + "当前系统时间"写进
    actual_seller_reply_body / seller_reply_time。已移除，原因有两条：
      1) 需求规定这两个字段由**程序从表 A 的卖家邮件回填**（正文 + 收件时间），不是人工填写；
      2) 它把"卖家回信时间"填成了操作当时的系统时间，与需求要求的"表 A 该卖家邮件的收件时间"不符。
    回填逻辑应在连接器侧按「平台订单编号 + 买家邮箱 + 买家邮件序列号」匹配表 B 指南行后写入。
  */

  const batchStatus = BATCH_STATUS_MAP[String(batchRecord?.status || '')] || null;
  const failures = Array.isArray(batchRecord?.failure_detail) ? batchRecord.failure_detail : [];

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex', padding: 24 }}>
      <Space align="center">
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          {t('AI after-sales workbench')}
        </Typography.Title>
        {/* 路由信息是给运维挂菜单用的开发说明，收进图标里，不再占一整行 */}
        <Tooltip
          title={
            <span>
              {t(
                'The route is independent, which makes it easier to mount under a custom admin menu on the target server.',
              )}
              <br />
              {t('Route path')}: {WORK_ORDER_ROUTE}
            </span>
          }
        >
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={async () => {
              await navigator.clipboard.writeText(AFTER_SALES_BATCH_ROUTE_PATH);
              message.success(t('Copied') + ': ' + AFTER_SALES_BATCH_ROUTE_PATH);
            }}
          />
        </Tooltip>
      </Space>

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
        {/* 紧凑进度：标签+数字同一行并排，避免 5 个大号数字占掉半屏 */}
        <Space size={16} wrap split={<Typography.Text type="secondary">·</Typography.Text>}>
          <Typography.Text>
            {t('Total')} <Typography.Text strong>{batchProgress.totalCount}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            {t('Completed')}{' '}
            <Typography.Text strong style={{ color: '#3f8600' }}>
              {batchProgress.done}
            </Typography.Text>
          </Typography.Text>
          <Typography.Text>
            {t('Remaining')} <Typography.Text strong>{batchProgress.pending}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            {t('Failed')}{' '}
            <Typography.Text strong style={{ color: batchProgress.failed ? '#cf1322' : undefined }}>
              {batchProgress.failed}
            </Typography.Text>
          </Typography.Text>
          <Typography.Text>
            {t('Skipped')} <Typography.Text strong>{batchProgress.skipped}</Typography.Text>
          </Typography.Text>
          {/* 百分比放在「已去除」右侧，紧跟着绿色进度条，两者一起看更直观 */}
          <Typography.Text strong style={{ color: batchProgress.percent >= 100 ? '#3f8600' : undefined }}>
            {batchProgress.percent ?? 0}%
          </Typography.Text>
          <Progress
            percent={batchProgress.percent}
            size="small"
            showInfo={false}
            style={{ width: 220, marginBottom: 0 }}
            strokeColor={batchProgress.percent >= 100 ? '#52c41a' : undefined}
          />
        </Space>
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
          // 工具栏按用途分三段：查询 → 数据准备（导入/新建） → 批次动作（主操作放最后）
          <Space wrap split={<span style={{ color: '#f0f0f0' }}>|</span>}>
            <Space size={4}>
              <Input.Search
                style={{ width: 220 }}
                placeholder={t('Keyword')}
                allowClear
                onSearch={(value) => {
                  setKeyword(value);
                  void loadWorkOrders(1, pageSize, value);
                }}
              />
              <Tooltip title={t('Refresh')}>
                <Button icon={<ReloadOutlined />} onClick={() => void loadWorkOrders(page, pageSize, keyword)} />
              </Tooltip>
            </Space>
            <Space size={4}>
              <Upload {...uploadProps}>
                <Button icon={<UploadOutlined />}>{t('Import file')}</Button>
              </Upload>
              <Tooltip title={t('Download template')}>
                <Button icon={<DownloadOutlined />} onClick={downloadImportTemplate} />
              </Tooltip>
              <Button icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
                {t('Create work order')}
              </Button>
            </Space>
            <Space size={4}>
              <Select
                style={{ width: 150 }}
                value={provider}
                onChange={(value) => setProvider(value)}
                options={[
                  { value: 'dify', label: t('Dify workflow') },
                  { value: 'local', label: t('Local AI employee') },
                ]}
              />
              {/* 不再加悬浮说明：左侧下拉框已直接显示当前引擎（Dify 工作流 / 本地 AI 员工），
                  再弹一层黑底提示属于重复信息 */}
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={starting}
                onClick={() => void handleStartBatch()}
              >
                {t('Start batch')}
              </Button>
              <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>
                {t('Delete selected')}
              </Button>
            </Space>
          </Space>
        }
      >
        <Table
          rowKey="work_order_serial"
          loading={loading}
          dataSource={records}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          // 各列宽度合计（100+178+190+100+130+95+95+120+105+105+160）；与列宽不符会导致折行
          scroll={{ x: 1378 }}
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
            {
              // 序列号已改为纯 8 位数字，列可以收窄；不截断，装不下换行
              title: t('Work order serial'),
              dataIndex: 'work_order_serial',
              key: 'work_order_serial',
              width: 170,
              render: (value: string) => (
                <Tooltip title={value}>
                  <Typography.Text style={CELL_WRAP_STYLE}>{shortSerial(value)}</Typography.Text>
                </Tooltip>
              ),
            },
            {
              title: t('Creation source'),
              dataIndex: 'creation_source',
              key: 'creation_source',
              width: 110,
              render: (value: string) => (value === 'daily' ? t('Daily order push') : t('Local creation')),
            },
            {
              title: t('Owner'),
              dataIndex: 'owner_name',
              key: 'owner_name',
              width: 90,
              render: (value: string | null) => value || '-',
            },
            {
              // 平台订单编号：用户明确要求**只能一行显示，不截断也不换行**。
              // 实测平台单号固定 19 字符（如 113-9233930-0206620），用等宽字体 + nowrap 完整容纳。
              title: t('Order ID'),
              dataIndex: 'order_id',
              key: 'order_id',
              width: 210,
              render: (value: string | null) =>
                value ? (
                  <Tooltip title={value}>
                    <span style={ORDER_ID_STYLE}>{value}</span>
                  </Tooltip>
                ) : (
                  '-'
                ),
            },
            {
              title: t('Issue type'),
              dataIndex: 'buyer_issue_type',
              key: 'buyer_issue_type',
              width: 130,
              render: (value: string | null) => (value ? <span style={CELL_WRAP_STYLE}>{value}</span> : '-'),
            },
            {
              title: t('Fetch depth (A/B)'),
              key: 'fetch_depth',
              width: 95,
              render: (_value: unknown, record: Record<string, any>) =>
                `${record.table_a_depth ?? '-'} / ${record.table_b_depth ?? '-'}`,
            },
            {
              title: t('Guide'),
              key: 'guide',
              width: 95,
              render: (_value: unknown, record: Record<string, any>) =>
                record.guide_serial ? <Tag color="success">{t('Generated')}</Tag> : <Tag>{t('Not generated')}</Tag>,
            },
            {
              // 需求第 13 项：AI 驱动售后处理指南记录序列号（此前被我合并进 Tag 悬停，列表上看不到）
              title: t('Guide serial'),
              dataIndex: 'guide_serial',
              key: 'guide_serial',
              width: 160,
              render: (value: string | null) =>
                value ? (
                  <Tooltip title={value}>
                    <Typography.Text style={{ whiteSpace: 'nowrap' }}>{shortSerial(value)}</Typography.Text>
                  </Tooltip>
                ) : (
                  '-'
                ),
            },
            {
              // 需求第 14 项：AI 处理指南生成时间（原来 "2026-10-1217:19:33.000Z" 会折两行）
              title: t('Generated at'),
              dataIndex: 'guide_generated_at',
              key: 'guide_generated_at',
              width: 150,
              render: (value: string | null) => <CompactDateTime value={value} />,
            },
            {
              title: t('Created at'),
              dataIndex: 'created_at',
              key: 'created_at',
              width: 150,
              render: (value: string | null) => <CompactDateTime value={value} />,
            },
            {
              title: t('Actions'),
              key: 'actions',
              fixed: 'right' as const,
              width: 260,
              render: (_value: unknown, record: Record<string, any>) => (
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => setDetailRecord(record)}>
                    {t('View details')}
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    icon={<EyeOutlined />}
                    disabled={!record.guide_serial}
                    onClick={() => void handleViewGuide(record)}
                  >
                    {t('View guide')}
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    icon={<RedoOutlined />}
                    disabled={!record.guide_serial}
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
          initialValues={{ reply_greeting: 'Dear Customer', table_a_depth: 3, table_b_depth: 1 }}
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
        width={560}
      >
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t('Skip or regenerate tip')} />
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          {decisionRows.map((row, index) => (
            <div
              key={String(row.work_order_serial)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 0',
                borderTop: index === 0 ? 'none' : '1px solid #f0f0f0',
              }}
            >
              {/* 左侧：工单号（新格式为 11 位纯数字，直接显示；旧格式压成两段），指南号降级为次要信息 */}
              <div style={{ minWidth: 0 }}>
                <Tooltip title={String(row.work_order_serial)}>
                  <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
                    {shortSerial(row.work_order_serial)}
                  </Typography.Text>
                </Tooltip>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                  {t('Guide serial')}: {row.guide_serial ? shortSerial(row.guide_serial) : '-'}
                </div>
              </div>
              <Radio.Group
                size="small"
                style={{ flexShrink: 0 }}
                value={decisionValues[String(row.work_order_serial)] || 'regenerate'}
                onChange={(event) =>
                  setDecisionValues((prev) => ({
                    ...prev,
                    [String(row.work_order_serial)]: event.target.value,
                  }))
                }
              >
                <Radio.Button value="regenerate">{t('Regenerate')}</Radio.Button>
                <Radio.Button value="skip">{t('Skip')}</Radio.Button>
              </Radio.Group>
            </div>
          ))}
        </Space>
      </Modal>

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

      <Drawer
        title={t('After-sales handling guide')}
        open={guideVisible}
        onClose={() => setGuideVisible(false)}
        width={920}
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
          <Descriptions
            column={1}
            bordered
            size="small"
            // 标签列不固定宽度时会被挤成两三行（如「指南记录序号」），正文也跟着变窄
            styles={{ label: { width: 120, whiteSpace: 'normal' } }}
          >
            {GUIDE_DISPLAY_FIELDS.map(([field, label]) => (
              <Descriptions.Item key={field} label={t(label)}>
                {guideRecord[field] == null || guideRecord[field] === '' ? (
                  '-'
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
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">{t('No guide generated yet')}</Typography.Text>
        )}
      </Drawer>
    </Space>
  );
}

export default AfterSalesBatchDifyPage;
