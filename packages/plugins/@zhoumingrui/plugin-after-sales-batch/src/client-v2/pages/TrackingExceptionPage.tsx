import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  DatePicker,
  Col,
  Divider,
  Dropdown,
  Popover,
  Drawer,
  Form,
  Input,
  InputNumber,
  AutoComplete,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import {
  BarChartOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownOutlined,
  FileSearchOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AttachmentField } from './AfterSalesRequestsPage';
import dayjs from 'dayjs';

/**
 * 快递异常工作台（预览版）
 *
 * 设计边界：
 *  - 不改 7D4 / D4 的查询与同步逻辑；
 *  - 只读 v2 7D4，前端计算数据质量、异常类型、已恢复标记；
 *  - 人工核实只写现有的 handle_status / handle_note / handle_updated_at，不新增字段；
 *  - 默认只显示“可用”的 12 位 FedEx 行，可疑/非 FedEx/虚拟单号需手动打开开关。
 */
const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const COLLECTION = '7D4';
const ACTIONLOG_COLLECTION = '7D4_ActionLog';
const ROUTE = '/tracking-exception/workbench';
const PAGE_SIZE = 500;
// 恢复周期只统计「已恢复且异常持续超过 3 天」的有价值样本（与恢复周期历史表口径一致）
const RECOVERY_MIN_MINUTES = 72 * 60;
const GREETINGS = [
  'Hi',
  'Hello',
  'Dear Buyer',
  'Dear Customer',
  'Hi Customer',
  'Hi Buyer',
  'Hello Customer',
  'Hello Buyer',
];

const FIELDS = [
  'id',
  'store-name',
  'order-id',
  'order-id-in-warehouse',
  'tracking-number',
  'warehouse-name',
  'msku',
  'msku-quantity',
  'sku-in-stock',
  'sku-in-stock-quantity',
  'email-address',
  'Status',
  'AdditionalStatus',
  'DaysBeforeOnline',
  'DaysOfStalled',
  'DeliveredDate',
  'ScheduledDeliveryDate',
  'exception_reason',
  'query_status',
  'note',
  'handle_status',
  'closed_at',
  'handler_id',
  'assigned_at',
  'handler_name',
  'owner_id',
  'owner_account',
  'handle_note',
  'handle_updated_at',
  'owner_name',
  'assign_source',
  'exception_status',
  'data_status',
  'exception_type',
  'exception_started_at',
  'exception_resolved_at',
  'manual_action',
  'manual_action_at',
  'manual_action_by',
  'exception_state',
  'exception_active',
  'exception_recovered_at',
  'is_delivered',
  'is_technical_error',
  'action_plan',
  'handle_result',
  'result_at',
  'customer_contacted',
  'work_order_serial',
  'resend_tracking_number',
  'refund_info',
  'claim_record_no',
  'close_reason',
];

type Row = Record<string, any>;
type Quality = '可用' | '查询异常' | '虚拟单号' | '其他承运商' | '数据不完整' | '天数异常' | '数据过旧';
type Carrier = 'FedEx' | 'UPS' | '其他';
type ExceptionType = 'initial' | 'transit' | 'other' | 'query';
type ExceptionState = '异常中' | '已恢复' | '待核实' | '已作废';

type EnrichedRow = Row & {
  _quality: Quality;
  _carrier: Carrier;
  _qualityReasons: string[];
  _type: ExceptionType;
  _state: ExceptionState;
  _startedAt?: string;
  _recoveredAt?: string;
  _ageDays: number | null;
  _isClean: boolean;
  _isRecovered: boolean;
  _isInvalid: boolean;
  _isClosed: boolean;
  _needsManual: boolean;
  _isActive: boolean;
  _isTechnical: boolean;
  _suggestion: string;
  _statusLabel: string;
};

function parseNote(note: unknown) {
  if (!note || typeof note !== 'string') return null;
  try {
    const parsed = JSON.parse(note);
    const exception = parsed?.exception;
    const episodes = Array.isArray(exception?.episodes) ? exception.episodes : [];
    const latest = episodes.length ? episodes[episodes.length - 1] : null;
    return {
      active: Boolean(exception?.active),
      startedAt: latest?.startedAt as string | undefined,
      recoveredAt: latest?.recoveredAt as string | undefined,
      reasons: Array.isArray(latest?.reasons) ? latest.reasons : [],
    };
  } catch {
    return null;
  }
}

function normalizeStatus(status: unknown) {
  const text = String(status ?? '').trim();
  if (!text) return '未知';
  if (/delivered|entregado/i.test(text)) return '已交付';
  if (/label created|etiqueta/i.test(text)) return '已建单';
  if (/on the way|en camino|in transit|运输中/i.test(text)) return '运输中';
  if (/exception|excepción|异常/i.test(text)) return '异常';
  return text;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 365) return null;
  return number;
}

function detectCarrier(tracking: unknown): Carrier {
  const value = String(tracking || '')
    .trim()
    .toUpperCase();
  if (/^1Z/.test(value)) return 'UPS';
  if (/^\d{12}$/.test(value)) return 'FedEx';
  return '其他';
}

/** FedEx / UPS 官网查询链接；其他承运商或虚拟单号返回 null。 */
function carrierTrackingUrl(tracking: unknown): string | null {
  const value = String(tracking || '').trim();
  if (!value) return null;
  const carrier = detectCarrier(value);
  if (carrier === 'UPS') {
    return `https://www.ups.com/track?loc=en_CN&tracknum=${encodeURIComponent(value)}&requester=WT/trackdetails`;
  }
  if (carrier === 'FedEx') {
    return `https://www.fedex.com/fedextrack/summary?trknbr=${encodeURIComponent(value)}`;
  }
  return null;
}

function TrackingNumberLink({ value, copyable = false }: { value?: unknown; copyable?: boolean }) {
  const text = String(value || '').trim();
  if (!text) return <>-</>;
  const url = carrierTrackingUrl(text);
  if (!url) {
    return copyable ? (
      <Typography.Text copyable style={{ whiteSpace: 'nowrap' }}>
        {text}
      </Typography.Text>
    ) : (
      <span style={{ whiteSpace: 'nowrap' }}>{text}</span>
    );
  }
  return (
    <Typography.Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      copyable={copyable}
      style={{ whiteSpace: 'nowrap' }}
    >
      {text}
    </Typography.Link>
  );
}

function enrich(row: Row): EnrichedRow {
  const tracking = String(row['tracking-number'] ?? '').trim();
  const status = String(row.Status ?? '').trim();
  const additional = String(row.AdditionalStatus ?? '').trim();
  const note = parseNote(row.note);
  const reasons: string[] = [];

  const isFedex = /^\d{12}$/.test(tracking);
  const isUps = /^1Z[0-9A-Z]{16}$/i.test(tracking);
  const isVirtual = /^8926\d{11}$/.test(tracking);
  const queryStatus = String(row.query_status || '').toUpperCase();
  const isTechnical =
    queryStatus === 'ERROR' ||
    (!queryStatus && (
      /邮件查询错误|查询错误|查询失败|NOTFOUND|TRACKINGNUMBER/i.test(`${additional} ${status}`) ||
      /查询失败|NOTFOUND/i.test(String(row.note ?? ''))
    ));
  const isOtherCarrier = Boolean(tracking) && !isFedex && !isUps && !isVirtual;
  const delivered = Boolean(row.DeliveredDate) || /delivered|entregado/i.test(status);
  const noteRecovered = Boolean(note?.recoveredAt) || note?.active === false;
  const v2Recovered = row.exception_status === 'recovered';
  const isInvalid = row.data_status === 'invalid';
  const isRecovered = v2Recovered || delivered || noteRecovered;

  let quality: Quality = '可用';
  if (isVirtual) {
    quality = '虚拟单号';
    reasons.push('15 位 8926 开头，判定为 Wayfair 虚拟单号，不应查 FedEx');
  } else if (isOtherCarrier) {
    quality = '其他承运商';
    reasons.push('非 FedEx/UPS 运单，暂未接入查询');
  } else if (isTechnical) {
    quality = '查询异常';
    reasons.push('查询状态为 ERROR 或备注显示查询失败，需人工核实');
  } else if (!tracking) {
    quality = '数据不完整';
    reasons.push('缺少运单号');
  } else if (!note?.startedAt) {
    quality = '数据不完整';
    reasons.push('note 中没有异常开始时间');
  } else if (numberOrNull(row.DaysBeforeOnline) === null && numberOrNull(row.DaysOfStalled) === null) {
    quality = '天数异常';
    reasons.push('DaysBeforeOnline/DaysOfStalled 超出合理范围');
  }

  const startedAt = row.exception_started_at || note?.startedAt;
  const recoveredAt = row.exception_resolved_at || note?.recoveredAt || (delivered ? row.DeliveredDate : undefined);
  let ageDays: number | null = null;
  if (startedAt && dayjs(startedAt).isValid()) {
    ageDays = Math.max(0, dayjs().startOf('day').diff(dayjs(startedAt).startOf('day'), 'day'));
  }
  if (ageDays === null) ageDays = numberOrNull(row.DaysOfStalled) ?? numberOrNull(row.DaysBeforeOnline);

  // 7D4 的 note 里可能残留很久以前的 episode；超过 30 天的“异常中”默认不可信。
  if (quality === '可用' && ageDays !== null && ageDays > 30) {
    quality = '数据过旧';
    reasons.push('异常开始时间超过 30 天，7D4 数据可能未同步');
  }

  const statusText = `${status} ${additional}`;
  let type: ExceptionType = 'other';
  if (isTechnical) {
    type = 'query';
  } else if (/label created|etiqueta|初始|待上网/i.test(statusText) || (numberOrNull(row.DaysBeforeOnline) ?? 0) > 3) {
    type = 'initial';
  } else if ((numberOrNull(row.DaysOfStalled) ?? 0) > 3 || /on the way|en camino|in transit|运输中/i.test(statusText)) {
    type = 'transit';
  }

  const state: ExceptionState = isInvalid ? '已作废' : isRecovered ? '已恢复' : isTechnical ? '待核实' : '异常中';
  const isClean = quality === '可用' && (isFedex || isUps) && !isTechnical && !isInvalid;
  const needsManual = isTechnical || quality === '数据不完整' || quality === '天数异常' || quality === '数据过旧';
  const suggestion = isRecovered
    ? '已恢复，无需行动'
    : quality === '数据过旧'
      ? '数据过旧，需核实'
      : isTechnical
        ? '数据待核实'
        : ageDays !== null && ageDays >= 7
          ? '建议处理'
          : ageDays !== null && ageDays >= 3
            ? '继续等待'
            : '观察';

  return {
    ...row,
    _quality: quality,
    _carrier: detectCarrier(row['tracking-number']),
    _qualityReasons: reasons,
    _type: type,
    _state: state,
    _startedAt: startedAt,
    _recoveredAt: recoveredAt,
    _ageDays: ageDays,
    _isClean: isClean,
    _isRecovered: isRecovered,
    _isInvalid: isInvalid,
    _isClosed: String(row.handle_status || '').toLowerCase() === 'closed',
    _needsManual: needsManual,
    _isActive: row.exception_active === 1 || row.exception_active === true
      || (!isRecovered && !isInvalid && !isTechnical),
    _isTechnical: isTechnical,
    _suggestion: suggestion,
    _statusLabel: normalizeStatus(row.Status),
  };
}

const TYPE_LABEL: Record<ExceptionType, string> = {
  initial: '初始状态',
  transit: '运输途中',
  other: '其他',
  query: '查询失败',
};

const QUALITY_COLOR: Record<Quality, string> = {
  可用: 'green',
  查询异常: 'orange',
  虚拟单号: 'purple',
  其他承运商: 'blue',
  数据不完整: 'red',
  天数异常: 'red',
  数据过旧: 'volcano',
};

/** KPI 标题：主标题 + 第二行小字（括号口径），避免整行 KPI 被挤到两行。 */
function StatTitle({ main, sub }: { main: string; sub?: string }) {
  return (
    <span>
      {main}
      {sub ? (
        <>
          <br />
          <span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>{sub}</span>
        </>
      ) : null}
    </span>
  );
}

type FilterKey =
  | 'all'
  | 'usable'
  | 'suspect'
  | 'initial-3'
  | 'initial-3-7'
  | 'initial-7'
  | 'transit-3'
  | 'transit-3-7'
  | 'transit-7'
  | 'recent-30'
  | 'recovered'
  | 'manual'
  | 'invalid'
  | 'unassigned'
  | 'mine'
  | 'active'
  | 'technical'
  | 'substantive';

type AdvancedField = 'carrier' | 'quality' | 'handle_status' | 'type' | 'age' | 'store' | 'tracking' | 'order';
type AdvancedOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'is_empty' | 'not_empty' | 'gte' | 'lte';
type AdvancedCondition = { id: string; field: AdvancedField; operator: AdvancedOperator; value: string };

const ADVANCED_FIELDS: Array<{ value: AdvancedField; label: string; kind: 'string' | 'number' }> = [
  { value: 'carrier', label: '物流商', kind: 'string' },
  { value: 'quality', label: '数据质量', kind: 'string' },
  { value: 'handle_status', label: '处理状态', kind: 'string' },
  { value: 'type', label: '异常类型', kind: 'string' },
  { value: 'age', label: '持续天数', kind: 'number' },
  { value: 'store', label: '店铺', kind: 'string' },
  { value: 'tracking', label: '运单号', kind: 'string' },
  { value: 'order', label: '平台订单号', kind: 'string' },
];

function advancedFieldValue(row: EnrichedRow, field: AdvancedField): string {
  switch (field) {
    case 'carrier':
      return row._carrier;
    case 'quality':
      return row._quality;
    case 'handle_status':
      return String(row.handle_status || '');
    case 'type':
      return row._type;
    case 'age':
      return row._ageDays === null || row._ageDays === undefined ? '' : String(row._ageDays);
    case 'store':
      return String(row['store-name'] || '');
    case 'tracking':
      return String(row['tracking-number'] || '');
    case 'order':
      return String(row['order-id'] || '');
    default:
      return '';
  }
}

function matchesAdvancedCondition(row: EnrichedRow, condition: AdvancedCondition): boolean {
  const actual = advancedFieldValue(row, condition.field);
  const expected = String(condition.value || '');
  if (condition.operator === 'is_empty') return actual.trim() === '';
  if (condition.operator === 'not_empty') return actual.trim() !== '';
  if (condition.operator === 'eq') return actual.toLowerCase() === expected.toLowerCase();
  if (condition.operator === 'neq') return actual.toLowerCase() !== expected.toLowerCase();
  if (condition.operator === 'contains') return actual.toLowerCase().includes(expected.toLowerCase());
  if (condition.operator === 'not_contains') return !actual.toLowerCase().includes(expected.toLowerCase());
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (condition.operator === 'gte') return left >= right;
  if (condition.operator === 'lte') return left <= right;
  return true;
}

function matchesAdvancedConditions(row: EnrichedRow, conditions: AdvancedCondition[], logic: 'and' | 'or'): boolean {
  const valid = conditions.filter((item) => item.field);
  if (!valid.length) return true;
  return logic === 'and'
    ? valid.every((condition) => matchesAdvancedCondition(row, condition))
    : valid.some((condition) => matchesAdvancedCondition(row, condition));
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'usable', label: '可用 FedEx/UPS' },
  { key: 'suspect', label: '可疑/其他承运商' },
  { key: 'initial-3', label: '初始≥3天' },
  { key: 'initial-3-7', label: '初始 3–7天' },
  { key: 'initial-7', label: '初始≥7天' },
  { key: 'transit-3', label: '运输≥3天' },
  { key: 'transit-3-7', label: '运输 3–7天' },
  { key: 'transit-7', label: '运输≥7天' },
  { key: 'recent-30', label: '近 30 天' },
  { key: 'recovered', label: '已恢复' },
  { key: 'manual', label: '待人工核实' },
  { key: 'invalid', label: '已作废' },
  { key: 'unassigned', label: '待指派' },
  { key: 'mine', label: '我的待办' },
  { key: 'active', label: '异常中' },
  { key: 'technical', label: '技术异常' },
  { key: 'substantive', label: '待实质处理' },
];

// 高频操作放在「导出当前筛选」右侧，其余筛选继续往后排（单行 wrap，避免多行占高度）
const PRIMARY_FILTER_KEYS: FilterKey[] = ['all', 'mine', 'manual', 'recovered', 'unassigned'];

const FILTER_COLORS: Record<FilterKey, string> = {
  all: '#595959',
  usable: '#389e0d',
  suspect: '#d46b08',
  'initial-3': '#d46b08',
  'initial-3-7': '#d46b08',
  'initial-7': '#ad4e00',
  'transit-3': '#1677ff',
  'transit-3-7': '#1677ff',
  'transit-7': '#0958d9',
  'recent-30': '#722ed1',
  recovered: '#389e0d',
  manual: '#d48806',
  invalid: '#8c8c8c',
  unassigned: '#cf1322',
  mine: '#08979c',
  active: '#cf1322',
  technical: '#d46b08',
  substantive: '#722ed1',
};

function matchFilter(row: EnrichedRow, key: FilterKey, currentUserId?: number | string) {
  if (key === 'all') return true;
  if (key === 'usable') return row._isClean;
  if (key === 'suspect') return !row._isClean;
  if (key === 'recovered') return row._isRecovered;
  if (key === 'manual') return row._needsManual && !row._isClosed;
  if (key === 'invalid') return row._isInvalid;
  if (key === 'unassigned') return !row.handler_id && row._isActive && !row._isTechnical && !row._isClosed;
  if (key === 'mine')
    return (
      Boolean(row.handler_id) && Number(row.handler_id) === Number(currentUserId) && row._isActive && !row._isClosed
    );
  if (key === 'active') return row._isActive && !row._isClosed;
  if (key === 'technical') return row._isTechnical;
  if (key === 'substantive') return row._isActive && !row._isTechnical && !row._isClosed && (row._ageDays ?? 0) >= 7;
  if (key === 'recent-30') {
    if (!row._startedAt) return false;
    return dayjs(row._startedAt).isAfter(dayjs().startOf('day').subtract(30, 'day'));
  }
  const [type, ...rangeParts] = key.split('-') as [ExceptionType, ...string[]];
  const range = rangeParts.join('-');
  if (row._type !== type) return false;
  if (row._ageDays === null) return false;
  if (range === '3') return row._ageDays >= 3;
  if (range === '3-7') return row._ageDays >= 3 && row._ageDays < 7;
  if (range === '7') return row._ageDays >= 7;
  return true;
}

// 上方 KPI 与下方筛选条的对应关系（帮助页第二节）。
const KPI_CHIP_ROWS = [
  { metric: '总行数', scope: '全部', chip: '全部', relation: '相等' },
  { metric: '可用 FedEx/UPS', scope: '全部', chip: '可用 FedEx/UPS', relation: '相等' },
  { metric: '异常中（可用）', scope: '仅可用数据', chip: '异常中（全部）', relation: 'C ⊆ D（前者是后者的子集）' },
  { metric: '已恢复（可用）', scope: '仅可用数据', chip: '已恢复（全部）', relation: '前者是后者的子集' },
  { metric: '可疑/其他承运商', scope: '全部', chip: '可疑/其他承运商', relation: '相等（= 总行数 − 可用）' },
  { metric: '待实质处理（全部）', scope: '全部', chip: '待实质处理', relation: '相等（同一口径）' },
  { metric: '技术异常', scope: '全部', chip: '技术异常', relation: '相等；与“异常中”互斥' },
  { metric: '待指派（全部）', scope: '全部', chip: '待指派', relation: '相等（同一口径）' },
];

// 帮助页第三节：集合记号与包含关系。
const HELP_LEGEND = [
  ['U', '7D4 全部行'],
  ['A', '可用 FedEx/UPS'],
  ['B', '可疑/其他承运商'],
  ['C', '异常中（可用）'],
  ['D', '底部“异常中”（全部）'],
  ['E', '技术异常'],
  ['F', '待实质处理（全部）'],
  ['G', '待指派（全部）'],
  ['H', '待人工核实'],
  ['I', '已作废'],
];

const HELP_MATH = `U = A ∪ B，A ∩ B = ∅，B = U − A
C ⊆ A
D = C ∪ (B ∩ X)，X = { x | x 仍异常且未关闭 }
C ⊆ D；当 B ∩ X ≠ ∅ 时 C ⊊ D
E ∩ D = ∅
F ⊆ D
G ⊆ D
H = E ∪ { x | 数据质量 ∉ {可用} }
I = { x | data_status = invalid }`;

export default function TrackingExceptionPage({ helpMode = false }: { helpMode?: boolean } = {}) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  // v2 flow context 的当前用户可能挂在 ctx.user，而不是 currentUser。
  // 统一归一化，否则“我接手”没有效果，“我的待办”也永远按空用户计算。
  const rawCurrentUser: any = (ctx as any)?.user ?? (ctx as any)?.currentUser;
  const currentUser: any = rawCurrentUser?.data?.data ?? rawCurrentUser?.data ?? rawCurrentUser ?? {};

  const writeAssignmentLog = useCallback(
    async (row: any, toUser: any, source: string) => {
      if (!row?.id || !toUser?.id) return;
      await ctx.api.request({
        url: '7D4_AssignmentLog:create',
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          exception_id: Number(row.id),
          from_handler_id: row.handler_id ?? null,
          from_handler_name: row.handler_name ?? null,
          to_handler_id: Number(toUser.id),
          to_handler_name: toUser.nickname || toUser.username || String(toUser.id),
          assigned_by: currentUser?.id ?? null,
          assigned_by_name: currentUser?.nickname || currentUser?.username || '人工',
          assigned_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          source,
        },
      });
    },
    [ctx, currentUser],
  );
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuspect, setShowSuspect] = useState(true);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [workloadOpen, setWorkloadOpen] = useState(false);
  const [workloadDate, setWorkloadDate] = useState(dayjs());
  const [workloadPeriod, setWorkloadPeriod] = useState<'day' | 'month'>('day');
  const [assignmentLogs, setAssignmentLogs] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState('');
  // 默认只看可用数据（12 位 FedEx/UPS）；可疑/其他承运商需在“数据质量”里切换。
  const [qualityFilter, setQualityFilter] = useState<string>('可用');
  const [carrierFilter, setCarrierFilter] = useState<'all' | Carrier>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedLogic, setAdvancedLogic] = useState<'and' | 'or'>('and');
  const [advancedConditions, setAdvancedConditions] = useState<AdvancedCondition[]>([]);
  const [selected, setSelected] = useState<EnrichedRow | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [actionLogs, setActionLogs] = useState<Row[]>([]);
  const [actionLogsLoading, setActionLogsLoading] = useState(false);
  const [requestTimeline, setRequestTimeline] = useState<Row[]>([]);
  const [actionType, setActionType] = useState('contacted_warehouse');
  const [actionNote, setActionNote] = useState('');
  const [contactTarget, setContactTarget] = useState('');
  const [followUpAt, setFollowUpAt] = useState<string>('');
  const [resendTrackingNumber, setResendTrackingNumber] = useState('');
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundCurrency, setRefundCurrency] = useState('USD');
  const [claimRecordNo, setClaimRecordNo] = useState('');
  const [claimAmount, setClaimAmount] = useState('');
  const [claimCurrency, setClaimCurrency] = useState('USD');
  const [claimReceived, setClaimReceived] = useState('');
  const [claimStatus, setClaimStatus] = useState('');
  const [claimSaving, setClaimSaving] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [customerContacted, setCustomerContacted] = useState<string>('0');
  const [workOrderSerial, setWorkOrderSerial] = useState('');
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<Row[]>([]);
  const [assignUserId, setAssignUserId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [workOrderMode, setWorkOrderMode] = useState<'link' | 'create'>('link');
  const [workOrderRow, setWorkOrderRow] = useState<EnrichedRow | null>(null);
  const [linkSerial, setLinkSerial] = useState('');
  const [linking, setLinking] = useState(false);
  const [createGreeting, setCreateGreeting] = useState('Hi');
  const [createIssueType, setCreateIssueType] = useState('');
  const [createContext, setCreateContext] = useState('');
  const [createTone, setCreateTone] = useState('');
  const [createPreference, setCreatePreference] = useState('');
  const [createLength, setCreateLength] = useState('');
  const [createTemplate, setCreateTemplate] = useState('');
  const [creating, setCreating] = useState(false);
  // 平台订单快递信息（按平台订单号聚合全部子订单）
  const [expressOpen, setExpressOpen] = useState(false);
  const [expressOrderId, setExpressOrderId] = useState('');
  const [expressRows, setExpressRows] = useState<Row[]>([]);
  const [expressMail, setExpressMail] = useState<Row | null>(null);
  const [expressLoading, setExpressLoading] = useState(false);
  const [trendRows, setTrendRows] = useState<Row[]>([]);
  const [canAssign, setCanAssign] = useState<boolean | null>(null);
  const [isAgent, setIsAgent] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchAssignOpen, setBatchAssignOpen] = useState(false);
  const [quickKind, setQuickKind] = useState<'warehouse-contacts' | 'reship-requests' | 'refund-requests' | 'claim-requests' | null>(null);
  const [quickRow, setQuickRow] = useState<EnrichedRow | null>(null);
  const [quickCreated, setQuickCreated] = useState<{ id: number; url: string; title: string } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickForm] = Form.useForm();
  const [requestSummary, setRequestSummary] = useState<Record<string, Row>>({});
  const [batchAssignUserId, setBatchAssignUserId] = useState('');
  const [batchAssigning, setBatchAssigning] = useState(false);
  // 页面固定高度：只有表体滚动，标题/统计/筛选/表头保持不动（与售后工单工作台一致）
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(360);

  const loadRequestSummaries = useCallback(async (list: Row[]) => {
    const orderIds = Array.from(new Set(list.map((row) => String(row['order-id'] || '').trim()).filter(Boolean)));
    if (!orderIds.length) { setRequestSummary({}); return; }
    try {
      const response = await ctx.api.request({
        url: 'v_AfterSalesRequestSummary:list',
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params: {
          pageSize: 5000,
        },
      });
      const body = response?.data?.data ?? response?.data ?? [];
      const rows = Array.isArray(body) ? body : body?.data ?? [];
      const next: Record<string, Row> = {};
      for (const item of Array.isArray(rows) ? rows : []) next[String(item.platform_order_id)] = item;
      setRequestSummary(next);
    } catch {
      setRequestSummary({});
    }
  }, [ctx]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all: Row[] = [];
      let page = 1;
      let total = 0;
      do {
        const response = await ctx.api.request({
          url: 'dailyAfterSales:trackingExceptionList',
          method: 'post',
          data: {
            page,
            pageSize: PAGE_SIZE,
            sort: ['-id'],
            fields: FIELDS.join(','),
          },
        });
        // NocoBase 对自定义 action 的 body 会再包一层 data；
        // 同时兼容普通资源 {data:[...], meta} 的形状。
        const body = response?.data?.data ?? {};
        const data = Array.isArray(body) ? body : body?.data ?? [];
        total = Number(body?.meta?.count ?? response?.data?.meta?.count ?? total ?? 0);
        all.push(...(Array.isArray(data) ? data : []));
        if (!Array.isArray(data) || data.length < PAGE_SIZE) break;
        page += 1;
      } while (all.length < total && page <= 30);
      setRows(all.map(enrich));
      void loadRequestSummaries(all);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [ctx, message, loadRequestSummaries]);

  const loadUsers = useCallback(async () => {
    try {
      const response = await ctx.api.request({ url: 'users:list', method: 'get', params: { pageSize: 200 } });
      const data = response?.data?.data ?? response?.data ?? [];
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      setUsers([]);
    }
  }, [ctx]);

  const assignOwner = useCallback(async () => {
    if (!selected || !assignUserId) return;
    const user = users.find((item) => String(item.id) === String(assignUserId));
    if (!user) return;
    setAssigning(true);
    try {
      const name = user.nickname || user.username || user.name || String(user.id);
      await ctx.api.request({
        url: `${COLLECTION}:update?filterByTk=${selected.id}`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          handler_name: name,
          handler_id: user.id,
          owner_id: user.id,
          assigned_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          assign_status: '已指派',
          assign_source: 'manual',
        },
      });
      await writeAssignmentLog(selected, user, 'manual');
      message.success(`已指派给 ${name}`);
      setSelected(null);
      setAssignUserId('');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAssigning(false);
    }
  }, [assignUserId, ctx, load, message, selected, users, writeAssignmentLog]);

  const acceptCase = useCallback(async () => {
    if (!selected || !currentUser?.id) return;
    setAssigning(true);
    try {
      const name = currentUser.nickname || currentUser.username || String(currentUser.id);
      await ctx.api.request({
        url: `${COLLECTION}:update?filterByTk=${selected.id}`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          handler_id: currentUser.id,
          handler_name: name,
          owner_id: currentUser.id,
          assigned_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          assign_status: '已指派',
          assign_source: 'accept',
          handle_status: '跟踪中',
          handle_updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        },
      });
      await writeAssignmentLog(selected, currentUser, 'accept');
      message.success('已接手');
      setSelected(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAssigning(false);
    }
  }, [ctx, currentUser, load, message, selected, writeAssignmentLog]);

  const openWorkOrder = useCallback(
    async (row: EnrichedRow) => {
      setWorkOrderRow(row);
      setWorkOrderMode(row.work_order_serial ? 'link' : 'create');
      setLinkSerial(String(row.work_order_serial || ''));
      setCreateGreeting(String(currentUser?.replyGreeting || currentUser?.reply_greeting || 'Hi'));
      setCreateIssueType(String(row.exception_reason || ''));
      setCreateContext('');
      setCreateTone('');
      setCreatePreference('');
      setCreateLength('');
      setCreateTemplate('');
      setWorkOrderOpen(true);
      // 邮件抬头默认取当前登录人的个人配置；读取失败时保留 Hi 兜底。
      if (currentUser?.id) {
        try {
          const response = await ctx.api.request({
            url: `users:get?filterByTk=${currentUser.id}`,
            method: 'get',
          });
          const user = response?.data?.data ?? response?.data ?? {};
          const greeting = user.replyGreeting || user.reply_greeting;
          if (greeting) setCreateGreeting(String(greeting));
        } catch {
          // 用户没有配置时保留兜底值
        }
      }
    },
    [ctx],
  );

  const saveLinkWorkOrder = useCallback(async () => {
    if (!workOrderRow || !linkSerial.trim()) {
      message.warning('请填写工单号');
      return;
    }
    setLinking(true);
    try {
      const serial = linkSerial.trim();
      await ctx.api.request({
        url: `${COLLECTION}:update?filterByTk=${workOrderRow.id}`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: { work_order_serial: serial },
      });
      await ctx.api.request({
        url: `${ACTIONLOG_COLLECTION}:create`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          exception_id: workOrderRow.id,
          orderItem_orderItemId: workOrderRow.orderItem_orderItemId,
          'tracking-number': workOrderRow['tracking-number'],
          action_type: 'other',
          action_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          action_status: 'done',
          action_note: `关联售后工单：${serial}`,
          operator_name: currentUser?.nickname || currentUser?.username || '人工',
        },
      });
      message.success('已关联工单');
      setWorkOrderOpen(false);
      setWorkOrderRow(null);
      setLinkSerial('');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLinking(false);
    }
  }, [ctx, linkSerial, load, message, workOrderRow]);

  const saveCreateWorkOrder = useCallback(async () => {
    if (!workOrderRow) return;
    setCreating(true);
    try {
      const response = await ctx.api.request({
        url: 'dailyAfterSales:createTrackingExceptionWorkOrder',
        method: 'post',
        data: {
          exception_id: workOrderRow.id,
          reply_greeting: createGreeting,
          buyer_issue_type: createIssueType.trim() || null,
          additional_context: createContext.trim() || null,
          tone_and_language: createTone.trim() || null,
          reply_preference: createPreference.trim() || null,
          email_length: createLength.trim() || null,
          case_template_path: createTemplate.trim() || null,
        },
      });
      const serial = response?.data?.data?.work_order_serial || response?.data?.work_order_serial;
      message.success(serial ? `工单已创建：${serial}` : '工单已创建');
      setWorkOrderOpen(false);
      setWorkOrderRow(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [
    createContext,
    createGreeting,
    createIssueType,
    createLength,
    createPreference,
    createTemplate,
    createTone,
    ctx,
    load,
    message,
    workOrderRow,
  ]);

  const openHandlingDetail = useCallback(async () => {
    try {
      const response = await ctx.api.request({
        url: 'desktopRoutes:list',
        method: 'get',
        params: {
          pageSize: 100,
          filter: JSON.stringify({ title: '快递异常处理明细' }),
        },
      });
      const routes = response?.data?.data ?? response?.data ?? [];
      const route = Array.isArray(routes) ? routes.find((item: any) => item?.title === '快递异常处理明细') : null;
      const href = route?.options?.href;
      if (!href) {
        message.warning('未找到快递异常处理明细页面');
        return;
      }
      window.open(href.startsWith('http') ? href : `${window.location.origin}${href}`, '_blank');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [ctx, message]);

  const openHandlingSummary = useCallback(async () => {
    try {
      const response = await ctx.api.request({
        url: 'desktopRoutes:list',
        method: 'get',
        params: { pageSize: 100, filter: JSON.stringify({ title: '快递异常处理汇总' }) },
      });
      const routes = response?.data?.data ?? response?.data ?? [];
      const route = Array.isArray(routes) ? routes.find((item: any) => item?.title === '快递异常处理汇总') : null;
      const href = route?.options?.href;
      if (!href) {
        message.warning('未找到快递异常处理汇总页面');
        return;
      }
      window.open(href.startsWith('http') ? href : `${window.location.origin}${href}`, '_blank');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [ctx, message]);

  const openRecoveryDetail = useCallback(async () => {
    try {
      const response = await ctx.api.request({
        url: 'desktopRoutes:list',
        method: 'get',
        params: { pageSize: 100, filter: JSON.stringify({ title: '快递异常恢复周期' }) },
      });
      const routes = response?.data?.data ?? response?.data ?? [];
      const route = Array.isArray(routes) ? routes.find((item: any) => item?.title === '快递异常恢复周期') : null;
      const href = route?.options?.href;
      if (!href) {
        message.warning('未找到快递异常恢复周期页面');
        return;
      }
      window.open(href.startsWith('http') ? href : `${window.location.origin}${href}`, '_blank');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }, [ctx, message]);

  const loadPermissions = useCallback(async () => {
    try {
      const response = await ctx.api.request({
        url: 'dailyAfterSales:trackingExceptionPermissions',
        method: 'post',
        data: {},
      });
      const data = response?.data?.data ?? response?.data ?? {};
      setCanAssign(Boolean(data.is_assigner));
      setIsAgent(Boolean(data.is_agent));
    } catch {
      setCanAssign(false);
      setIsAgent(false);
    }
  }, [ctx]);

  const batchAssign = useCallback(async () => {
    if (!batchAssignUserId || !selectedRowKeys.length) return;
    setBatchAssigning(true);
    try {
      await ctx.api.request({
        url: 'dailyAfterSales:batchAssignTrackingExceptions',
        method: 'post',
        data: { rowIds: selectedRowKeys.map(Number), owner_id: Number(batchAssignUserId) },
      });
      const targetUser = users.find((item) => String(item.id) === String(batchAssignUserId));
      if (targetUser) {
        for (const id of selectedRowKeys) {
          const row = rows.find((item) => String(item.id) === String(id));
          await writeAssignmentLog(row, targetUser, 'batch');
        }
      }
      message.success(`已指派 ${selectedRowKeys.length} 行`);
      setBatchAssignOpen(false);
      setBatchAssignUserId('');
      setSelectedRowKeys([]);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchAssigning(false);
    }
  }, [batchAssignUserId, ctx, load, message, rows, selectedRowKeys, users, writeAssignmentLog]);

  const batchClose = useCallback(() => {
    if (!canAssign || !selectedRowKeys.length) return;
    Modal.confirm({
      title: '批量核实恢复快递异常',
      content: `确认将选中的 ${selectedRowKeys.length} 行标记为已核实恢复并关闭？关闭后仍保留记录。`,
      okText: '确认核实恢复',
      cancelText: '取消',
      onOk: async () => {
        try {
          const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
          const stamp = dayjs().format('YYYY-MM-DD HH:mm');
          const operatorName = currentUser?.nickname || currentUser?.username || '人工';
          let closedCount = 0;
          let skippedCount = 0;
          for (const id of selectedRowKeys) {
            const row = rows.find((item) => String(item.id) === String(id));
            if (String(row?.handle_status || '').toLowerCase() === 'closed') {
              skippedCount += 1;
              continue;
            }
            const note = `[批量核实 ${stamp}] 已核实恢复`;
            await ctx.api.request({
              url: `${COLLECTION}:update?filterByTk=${id}`,
              method: 'post',
              headers: { 'x-data-source': DATA_SOURCE_KEY },
              data: { handle_status: 'closed', closed_at: now, close_reason: note },
            });
            await ctx.api.request({
              url: `${ACTIONLOG_COLLECTION}:create`,
              method: 'post',
              headers: { 'x-data-source': DATA_SOURCE_KEY },
              data: {
                exception_id: id,
                orderItem_orderItemId: row?.orderItem_orderItemId ?? null,
                'tracking-number': row?.['tracking-number'] ?? null,
                action_type: 'close',
                action_at: now,
                action_status: 'done',
                action_note: note,
                close_reason: note,
                operator_id: currentUser?.id ?? null,
                operator_name: operatorName,
              },
            });
            closedCount += 1;
          }
          message.success(`已关闭 ${closedCount} 行${skippedCount ? `，跳过 ${skippedCount} 行已关闭数据` : ''}`);
          setSelectedRowKeys([]);
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        }
      },
    });
  }, [canAssign, ctx, load, message, rows, selectedRowKeys]);

  const loadTrend = useCallback(async () => {
    try {
      const response = await ctx.api.request({
        url: 'TrackingExceptionStatsDaily:list',
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params: {
          pageSize: 7,
          sort: ['-stat_date'],
          filter: JSON.stringify({ store_name: { $eq: '' } }),
        },
      });
      setTrendRows(response?.data?.data ?? []);
    } catch {
      setTrendRows([]);
    }
  }, [ctx]);

  const loadActionLogs = useCallback(
    async (exceptionId: number) => {
      setActionLogsLoading(true);
      try {
        const response = await ctx.api.request({
          url: `${ACTIONLOG_COLLECTION}:list`,
          method: 'get',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          params: {
            pageSize: 200,
            sort: 'action_at',
            filter: JSON.stringify({ exception_id: exceptionId }),
          },
        });
        setActionLogs(response?.data?.data ?? []);
      } catch (error) {
        setActionLogs([]);
        message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setActionLogsLoading(false);
      }
    },
    [ctx, message],
  );

  const openExpressInfo = useCallback(
    async (row: Row) => {
      const orderId = String(row['order-id'] ?? '').trim();
      setExpressOrderId(orderId);
      setExpressOpen(true);
      setExpressRows([]);
      setExpressMail(null);
      if (!orderId) {
        return;
      }
      setExpressLoading(true);
      try {
        const [listRes, mailRes] = await Promise.all([
          ctx.api.request({
            url: 'v_MabangOrderFullV3:list',
            method: 'get',
            headers: { 'x-data-source': DATA_SOURCE_KEY },
            params: {
              pageSize: 200,
              sort: ['-purchase-date'],
              filter: JSON.stringify({ $and: [{ 'order-id': { $eq: orderId } }] }),
            },
          }),
          ctx.api.request({
            url: '7E2:list',
            method: 'get',
            headers: { 'x-data-source': DATA_SOURCE_KEY },
            params: {
              pageSize: 1,
              filter: JSON.stringify({ $and: [{ 'order-id': { $eq: orderId } }] }),
            },
          }),
        ]);
        setExpressRows(listRes?.data?.data ?? []);
        setExpressMail((mailRes?.data?.data ?? [])[0] ?? null);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setExpressLoading(false);
      }
    },
    [ctx, message],
  );

  const loadRequestTimeline = useCallback(async (orderId: string) => {
    if (!orderId) { setRequestTimeline([]); return; }
    const sources = [
      { collection: 'AfterSalesWarehouseContact', label: '联系仓库', status: 'contact_status', note: (row: Row) => [row.contact_channel, row.message_content || row.issue_description].filter(Boolean).join(' · ') },
      { collection: 'AfterSalesReshipRequest', label: '补寄申请', status: 'request_status', note: (row: Row) => [row.reship_type, row.reship_item_sku || row.reship_item_name, row.reason].filter(Boolean).join(' · ') },
      { collection: 'AfterSalesRefundRequest', label: '退款申请', status: 'request_status', note: (row: Row) => [row.refund_amount ? `${row.refund_amount} ${row.refund_currency || ''}` : '', row.reason].filter(Boolean).join(' · ') },
      { collection: 'AfterSalesClaimRequest', label: '索赔申请', status: 'claim_status', note: (row: Row) => [row.claim_amount ? `${row.claim_amount} ${row.claim_currency || ''}` : '', row.claim_reason].filter(Boolean).join(' · ') },
    ];
    const items: Row[] = [];
    await Promise.all(sources.map(async (source) => {
      try {
        const response = await ctx.api.request({
          url: `${source.collection}:list`,
          method: 'get',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          params: { pageSize: 100, sort: ['-created_at'], filter: JSON.stringify({ platform_order_id: orderId }) },
        });
        const body = response?.data?.data ?? response?.data ?? [];
        for (const row of Array.isArray(body) ? body : body?.data ?? []) {
          items.push({
            timeline_id: `${source.collection}-${row.id}`,
            action_type: source.label,
            action_at: row.created_at,
            operator_name: row.created_by,
            action_note: [row[source.status], source.note(row)].filter(Boolean).join(' · '),
          });
        }
      } catch {
        // 单个请求表异常不影响其他时间线
      }
    }));
    setRequestTimeline(items.sort((a, b) => String(b.action_at || '').localeCompare(String(a.action_at || ''))));
  }, [ctx]);

  useEffect(() => {
    if (!selected) {
      setActionLogs([]);
      setRequestTimeline([]);
      return;
    }
    void loadActionLogs(selected.id);
    void loadRequestTimeline(String(selected['order-id'] || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 表体高度 = 容器高度 - 表头 - 分页；表体独立滚动，页面本身不滚（菜单栏保持吸收在顶部）
  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) return undefined;
    const updateHeight = () => {
      const headerHeight = element.querySelector('.ant-table-thead')?.clientHeight || 46;
      const paginationHeight = element.querySelector('.ant-pagination')?.clientHeight || 56;
      setTableScrollY(Math.max(160, element.clientHeight - headerHeight - paginationHeight - 2));
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    updateHeight();
    return () => observer.disconnect();
  }, [loading]);

  const filterScopedRows = useMemo(
    () =>
      rows.filter((row) => {
        if (!matchesAdvancedConditions(row, advancedConditions, advancedLogic)) return false;
        if (carrierFilter !== 'all' && row._carrier !== carrierFilter) return false;
        if (ownerFilter === 'unassigned') return !row.handler_id;
        if (ownerFilter !== 'all' && Number(row.handler_id) !== Number(ownerFilter)) return false;
        return true;
      }),
    [rows, carrierFilter, ownerFilter, advancedConditions, advancedLogic],
  );
  const scopedRows = useMemo(
    () => (showSuspect ? filterScopedRows : filterScopedRows.filter((row) => row._isClean)),
    [filterScopedRows, showSuspect],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = {
      all: 0,
      usable: 0,
      suspect: 0,
      'initial-3': 0,
      'initial-3-7': 0,
      'initial-7': 0,
      'transit-3': 0,
      'transit-3-7': 0,
      'transit-7': 0,
      'recent-30': 0,
      recovered: 0,
      manual: 0,
      invalid: 0,
      unassigned: 0,
      mine: 0,
      active: 0,
      technical: 0,
      substantive: 0,
    };
    for (const row of scopedRows) {
      for (const filter of FILTERS) {
        if (filter.key === 'manual') continue;
        if (matchFilter(row, filter.key, currentUser?.id)) result[filter.key] += 1;
      }
    }
    // 待人工核实始终按全量数据计数；否则默认“只看可用数据”时按钮永远显示 0。
    result.manual = filterScopedRows.filter((row) => row._needsManual && !row._isClosed).length;
    return result;
  }, [currentUser?.id, scopedRows, rows]);

  const filteredRows = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    const filtered = scopedRows.filter((row) => {
      if (!matchFilter(row, filterKey, currentUser?.id)) return false;
      if (qualityFilter !== 'all' && row._quality !== qualityFilter) return false;
      if (!lower) return true;
      return [
        row['order-id'],
        row['order-id-in-warehouse'],
        row['tracking-number'],
        row['store-name'],
        row['warehouse-name'],
        row['msku'],
        row.handler_name,
        row.handle_note,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lower));
    });
    // 日常处理优先：未恢复在前，已恢复在后；同状态按持续天数倒序。
    return filtered.sort((a, b) => {
      const recoveredDiff = Number(a._isRecovered) - Number(b._isRecovered);
      if (recoveredDiff !== 0) return recoveredDiff;
      return (b._ageDays ?? -1) - (a._ageDays ?? -1);
    });
  }, [currentUser?.id, scopedRows, filterKey, qualityFilter, keyword]);

  const exportRows = useCallback(() => {
    const source = selectedRowKeys.length ? rows.filter((row) => selectedRowKeys.includes(row.id)) : filteredRows;
    if (!source.length) {
      message.warning('没有可导出的数据');
      return;
    }
    const headers = [
      '店铺',
      '平台订单编号',
      '子订单编号',
      '运单号',
      '仓库',
      '异常类型',
      '异常开始',
      '已持续',
      '状态',
      '数据质量',
      '处理结果',
      '处理人',
      '处理状态',
      '关联工单',
    ];
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(',')];
    for (const row of source) {
      lines.push(
        [
          row['store-name'],
          row['order-id'],
          row['order-id-in-warehouse'],
          row['tracking-number'],
          row['warehouse-name'],
          TYPE_LABEL[row._type],
          row._startedAt,
          row._ageDays === null ? '' : `${row._ageDays} 天`,
          row._state,
          row._quality,
          row.handle_result,
          row.handler_name,
          row.handle_status,
          row.work_order_serial,
        ]
          .map(escape)
          .join(','),
      );
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `快递异常_${dayjs().format('YYYYMMDD_HHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, message, rows, selectedRowKeys]);

  const stats = useMemo(() => {
    const clean = rows.filter((row) => row._isClean);
    const activeRows = rows.filter((row) => row._isActive);
    const substantive = rows.filter(
      (row) => row._isActive && !row._isTechnical && !row._isClosed && (row._ageDays ?? 0) >= 7,
    );
    const cutoff = dayjs().subtract(30, 'day');
    const resultRows = rows.filter(
      (row) =>
        ['已补寄', '已退款', '已补寄+退款'].includes(String(row.handle_result || '')) &&
        row.result_at &&
        dayjs(row.result_at).isAfter(cutoff),
    );
    const premature = resultRows.filter(
      (row) => row.delivered_at && dayjs(row.delivered_at).isAfter(dayjs(row.result_at)),
    );
    // 平均恢复周期：只统计“确实恢复 + 异常持续超过 3 天”的有价值样本。
    // 几十分钟/几小时就恢复的短时波动属于正常现象，会拉低均值，按口径直接排除。
    const cycleMinutes: number[] = [];
    let recoveryTotal = 0;
    for (const row of rows) {
      if (!row._isRecovered) continue;
      const endedAt = row.exception_recovered_at || row.exception_resolved_at;
      if (!row.exception_started_at || !endedAt) continue;
      if (!dayjs(endedAt).isAfter(cutoff)) continue;
      const minutes = dayjs(endedAt).diff(dayjs(row.exception_started_at), 'minute');
      if (!Number.isFinite(minutes) || minutes < 0) continue;
      recoveryTotal += 1;
      if (minutes <= RECOVERY_MIN_MINUTES) continue;
      cycleMinutes.push(minutes);
    }
    const recoveryAvg = cycleMinutes.length
      ? cycleMinutes.reduce((total, minutes) => total + minutes, 0) / cycleMinutes.length / 1440
      : null;
    return {
      total: rows.length,
      clean: clean.length,
      active: clean.filter((row) => row._state === '异常中').length,
      recovered: clean.filter((row) => row._isRecovered).length,
      suspect: rows.length - clean.length,
      substantive: substantive.length,
      technical: rows.filter((row) => row._isTechnical).length,
      unassigned: activeRows.filter((row) => !row.handler_id && !row._isTechnical && !row._isClosed).length,
      prematureRate: resultRows.length ? (premature.length * 100) / resultRows.length : 0,
      recoveryAvg,
      recoveryCount: cycleMinutes.length,
      recoveryTotal,
    };
  }, [rows]);

  // 帮助页“当前实时数据”：与页面 KPI / 筛选条同源，随行数据实时计算。
  const helpMetrics = useMemo(
    () => [
      { key: 'total', label: '总行数', value: stats.total },
      { key: 'clean', label: '可用 FedEx/UPS', value: stats.clean },
      { key: 'activeClean', label: '异常中（可用）', value: stats.active },
      { key: 'recoveredClean', label: '已恢复（可用）', value: stats.recovered },
      { key: 'suspect', label: '可疑/其他承运商', value: stats.suspect },
      { key: 'substantive', label: '待实质处理（全部）', value: stats.substantive },
      { key: 'technical', label: '技术异常', value: stats.technical },
      { key: 'unassigned', label: '待指派（全部）', value: stats.unassigned },
      { key: 'chipActive', label: '底部：异常中', value: counts.active },
      { key: 'chipRecovered', label: '底部：已恢复', value: counts.recovered },
      { key: 'chipManual', label: '底部：待人工核实', value: counts.manual },
      { key: 'chipInvalid', label: '底部：已作废', value: counts.invalid },
    ],
    [stats, counts],
  );

  useEffect(() => {
    if (!workloadOpen) return;
    const start = (workloadPeriod === 'month' ? workloadDate.startOf('month') : workloadDate.startOf('day')).format(
      'YYYY-MM-DD HH:mm:ss',
    );
    const end = (
      workloadPeriod === 'month'
        ? workloadDate.add(1, 'month').startOf('month')
        : workloadDate.add(1, 'day').startOf('day')
    ).format('YYYY-MM-DD HH:mm:ss');
    void ctx.api
      .request({
        url: '7D4_AssignmentLog:list',
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params: {
          pageSize: 2000,
          sort: ['assigned_at'],
          filter: JSON.stringify({ assigned_at: { $gte: start, $lt: end } }),
        },
      })
      .then((response) => {
        const body = response?.data?.data ?? response?.data ?? {};
        setAssignmentLogs(Array.isArray(body) ? body : body?.data ?? []);
      })
      .catch(() => setAssignmentLogs([]));
  }, [ctx, workloadDate, workloadOpen, workloadPeriod]);

  const workloadRows = useMemo(() => {
    const target = workloadPeriod === 'month' ? workloadDate.startOf('month') : workloadDate.startOf('day');
    const byOwner = new Map<
      string,
      { id: string; name: string; assigned: number; completed: number; carryover: number; open: number }
    >();
    for (const row of rows) {
      const id = row.handler_id ? String(row.handler_id) : '';
      if (!id) continue;
      if (!byOwner.has(id)) {
        byOwner.set(id, {
          id,
          name: String(row.handler_name || row.owner_name || id),
          assigned: 0,
          completed: 0,
          carryover: 0,
          open: 0,
        });
      }
      const item = byOwner.get(id)!;
      const assignedAt = row.assigned_at ? dayjs(row.assigned_at) : null;
      const closedAt = row.closed_at ? dayjs(row.closed_at) : null;
      const isOpen = row._isActive && !row._isClosed;
      if (
        assignedAt &&
        ((workloadPeriod === 'month' && assignedAt.isSame(target, 'month')) ||
          (workloadPeriod === 'day' && assignedAt.isSame(target, 'day')))
      )
        item.assigned += 1;
      if (
        closedAt &&
        ((workloadPeriod === 'month' && closedAt.isSame(target, 'month')) ||
          (workloadPeriod === 'day' && closedAt.isSame(target, 'day')))
      )
        item.completed += 1;
      if (isOpen) item.open += 1;
      if (isOpen && assignedAt && assignedAt.isBefore(target, 'day')) item.carryover += 1;
    }
    const assignedFromLogs = new Map<string, Set<number>>();
    for (const log of assignmentLogs) {
      const ownerId = log.to_handler_id ? String(log.to_handler_id) : '';
      if (!ownerId || !log.exception_id) continue;
      if (!assignedFromLogs.has(ownerId)) assignedFromLogs.set(ownerId, new Set());
      assignedFromLogs.get(ownerId)!.add(Number(log.exception_id));
      if (!byOwner.has(ownerId)) {
        byOwner.set(ownerId, {
          id: ownerId,
          name: String(log.to_handler_name || ownerId),
          assigned: 0,
          completed: 0,
          carryover: 0,
          open: 0,
        });
      }
    }
    for (const [ownerId, ids] of assignedFromLogs) {
      const item = byOwner.get(ownerId);
      if (item) item.assigned = ids.size;
    }
    return Array.from(byOwner.values())
      .map((item) => ({
        ...item,
        remaining: item.assigned + item.carryover - item.completed,
        rate: item.assigned + item.carryover > 0 ? (item.completed * 100) / (item.assigned + item.carryover) : 0,
      }))
      .sort((a, b) => b.open - a.open || b.assigned - a.assigned);
  }, [assignmentLogs, rows, workloadDate, workloadPeriod]);

  const trendSeries = useMemo(() => {
    const byDate = new Map(
      trendRows.map((row) => [String(row.stat_date || '').slice(0, 10), Number(row.substantive_total || 0)]),
    );
    const today = dayjs().startOf('day');
    return Array.from({ length: 7 }, (_, index) => {
      const date = today.subtract(6 - index, 'day');
      const key = date.format('YYYY-MM-DD');
      return {
        date: key,
        value: byDate.has(key) ? byDate.get(key) : null,
        isToday: index === 6,
      };
    });
  }, [trendRows]);

  async function saveManualCheck(action: 'recovered' | 'abnormal' | 'note') {
    if (!selected) return;
    if (action === 'recovered' && selected._isClosed) {
      message.info('该行已经是已关闭状态，无需重复核实恢复');
      return;
    }
    setSaving(true);
    try {
      const now = dayjs();
      const stamp = now.format('YYYY-MM-DD HH:mm');
      const actionText = action === 'recovered' ? '已核实恢复' : action === 'abnormal' ? '仍异常' : '备注';
      const line = `[人工核实 ${stamp}] ${actionText}${manualNote.trim() ? `：${manualNote.trim()}` : ''}`;
      const actionType = action === 'recovered' ? 'close' : action === 'abnormal' ? 'tracking' : 'other';
      if (action !== 'note') {
        const update: Record<string, unknown> = {
          handle_status: action === 'recovered' ? 'closed' : 'pending',
          handle_updated_at: now.format('YYYY-MM-DD HH:mm:ss'),
        };
        if (action === 'recovered') {
          update.closed_at = now.format('YYYY-MM-DD HH:mm:ss');
          update.close_reason = line;
        } else {
          update.closed_at = null;
          update.close_reason = null;
        }
        await ctx.api.request({
          url: `${COLLECTION}:update?filterByTk=${selected.id}`,
          method: 'post',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          data: update,
        });
      }
      await ctx.api.request({
        url: `${ACTIONLOG_COLLECTION}:create`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          exception_id: selected.id,
          orderItem_orderItemId: selected.orderItem_orderItemId,
          'tracking-number': selected['tracking-number'],
          action_type: actionType,
          action_at: now.format('YYYY-MM-DD HH:mm:ss'),
          action_status: action === 'abnormal' ? 'in_progress' : 'done',
          action_note: line,
          close_reason: action === 'recovered' ? line : null,
          operator_id: currentUser?.id ?? null,
          operator_name: currentUser?.nickname || currentUser?.username || '人工',
        },
      });
      message.success('已记录人工核实行动');
      setSelected(null);
      setManualNote('');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveClaim() {
    if (!selected) return;
    setClaimSaving(true);
    try {
      const data = {
        exception_id: selected.id,
        claim_record_no: claimRecordNo.trim() || null,
        claim_amount: claimAmount === '' ? null : Number(claimAmount),
        claim_currency: claimCurrency || 'USD',
        claim_received_amount: claimReceived === '' ? null : Number(claimReceived),
        claim_status: claimStatus.trim() || null,
        updated_by: currentUser?.nickname || currentUser?.username || '人工',
      };
      let exists = false;
      try {
        const response = await ctx.api.request({
          url: `7D4_Claim:list?pageSize=1&filter=${encodeURIComponent(JSON.stringify({ exception_id: selected.id }))}`,
          method: 'get',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
        });
        const body = response?.data?.data ?? response?.data ?? [];
        exists = Array.isArray(body) ? body.length > 0 : Boolean(body?.data?.length);
      } catch {
        exists = false;
      }
      try {
        await ctx.api.request({
          url: exists ? `7D4_Claim:update?filterByTk=${selected.id}` : '7D4_Claim:create',
          method: 'post',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          data,
        });
      } catch (error) {
        if (exists) throw error;
        await ctx.api.request({
          url: `7D4_Claim:create`,
          method: 'post',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          data,
        });
      }
      message.success('索赔信息已保存');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setClaimSaving(false);
    }
  }

  async function saveActionLog() {
    if (!selected) return;
    setSaving(true);
    try {
      const now = dayjs();
      await ctx.api.request({
        url: `${ACTIONLOG_COLLECTION}:create`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          exception_id: selected.id,
          orderItem_orderItemId: selected.orderItem_orderItemId,
          'tracking-number': selected['tracking-number'],
          action_type: actionType,
          action_at: now.format('YYYY-MM-DD HH:mm:ss'),
          action_status: 'done',
          action_note: actionNote.trim() || null,
          contact_target: contactTarget.trim() || null,
          follow_up_at: followUpAt || null,
          resend_tracking_number: resendTrackingNumber.trim() || null,
          refund_amount: refundAmount ? Number(refundAmount) : null,
          refund_currency: refundCurrency || null,
          claim_record_no: claimRecordNo.trim() || null,
          close_reason: actionType === 'close' ? closeReason.trim() || actionNote.trim() || null : null,
          operator_name: currentUser?.nickname || currentUser?.username || '人工',
        },
      });
      const resultPatch: Row = {};
      if (actionType === 'reship') {
        resultPatch.handle_result = '已补寄';
        resultPatch.result_at = now.format('YYYY-MM-DD HH:mm:ss');
        resultPatch.resend_tracking_number = resendTrackingNumber.trim() || null;
        resultPatch.resend_info = actionNote.trim() || null;
      } else if (actionType === 'refund') {
        resultPatch.handle_result = '已退款';
        resultPatch.result_at = now.format('YYYY-MM-DD HH:mm:ss');
        resultPatch.refund_info = actionNote.trim() || null;
      } else if (actionType === 'close') {
        resultPatch.handle_status = 'closed';
        resultPatch.close_reason = closeReason.trim() || actionNote.trim() || null;
        resultPatch.closed_at = now.format('YYYY-MM-DD HH:mm:ss');
      }
      if (customerContacted === '1') resultPatch.customer_contacted = 1;
      if (workOrderSerial.trim()) resultPatch.work_order_serial = workOrderSerial.trim();
      if (Object.keys(resultPatch).length) {
        await ctx.api.request({
          url: `${COLLECTION}:update?filterByTk=${selected.id}`,
          method: 'post',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          data: resultPatch,
        });
      }
      message.success('行动记录已新增');
      setActionNote('');
      setContactTarget('');
      setFollowUpAt('');
      setResendTrackingNumber('');
      setRefundAmount('');
      setClaimRecordNo('');
      setCloseReason('');
      setWorkOrderSerial('');
      await loadActionLogs(selected.id);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function openQuickRequest(kind: 'warehouse-contacts' | 'reship-requests' | 'refund-requests' | 'claim-requests', row: EnrichedRow) {
    setQuickKind(kind);
    setQuickRow(row);
    setQuickCreated(null);
    quickForm.resetFields();
    const common = {
      platform_order_id: String(row['order-id'] || ''),
      platform_sku: String(row.msku || ''),
      stock_sku: String(row['sku-in-stock'] || ''),
      sub_order_id: String(row['order-id-in-warehouse'] || ''),
      tracking_number: String(row['tracking-number'] || ''),
      store_name: String(row['store-name'] || ''),
      handler_id: row.handler_id ?? null,
      handler_name: String(row.handler_name || ''),
      warehouse_name: String(row['warehouse-name'] || ''),
      source_type: 'tracking_exception',
      exception_id: Number(row.id),
      source_row_id: Number(row.id),
    };
    const issue = String(row.exception_reason || row.handle_note || '');
    if (kind === 'warehouse-contacts') {
      quickForm.setFieldsValue({ ...common, contact_status: '待发送', issue_description: issue, message_content: '' });
    } else if (kind === 'reship-requests') {
      quickForm.setFieldsValue({ ...common, request_status: '待审核', reason: issue, quantity: 1, reship_item_sku: common.stock_sku || '' });
    } else if (kind === 'refund-requests') {
      quickForm.setFieldsValue({ ...common, request_status: '待审核', refund_currency: 'USD', reason: issue });
    } else {
      quickForm.setFieldsValue({ ...common, claim_status: '待提交', claim_currency: 'USD', claim_trigger: '快递异常', claim_reason: issue });
    }
  }

  async function saveQuickRequest() {
    if (!quickKind || !quickRow) return;
    setQuickSaving(true);
    try {
      const values = await quickForm.validateFields();
      const collections: Record<string, string> = {
        'warehouse-contacts': 'AfterSalesWarehouseContact',
        'reship-requests': 'AfterSalesReshipRequest',
        'refund-requests': 'AfterSalesRefundRequest',
        'claim-requests': 'AfterSalesClaimRequest',
      };
      const titles: Record<string, string> = {
        'warehouse-contacts': '仓库联系记录',
        'reship-requests': '补寄申请',
        'refund-requests': '退款申请',
        'claim-requests': '索赔申请',
      };
      const data = {
        ...values,
        source_type: 'tracking_exception',
        exception_id: Number(quickRow.id),
        source_row_id: Number(quickRow.id),
        created_by: currentUser?.nickname || currentUser?.username || '人工',
      };
      const response = await ctx.api.request({
        url: 'afterSalesRequest:create',
        method: 'post',
        data: { request_type: quickKind, values: data },
      });
      const body = response?.data?.data ?? response?.data;
      const id = Number(body?.id);
      if (!id) throw new Error('创建后未返回记录 ID');
      setQuickCreated({ id, url: `/v/admin/after-sales/${quickKind}?record_id=${id}`, title: titles[quickKind] });
      message.success(`${titles[quickKind]}已创建`);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || '创建失败');
    } finally {
      setQuickSaving(false);
    }
  }

  const columns = [
    {
      title: '店铺',
      dataIndex: 'store-name',
      width: 110,
      render: (value: string) => value || '-',
    },
    {
      title: '平台订单编号',
      dataIndex: 'order-id',
      width: 180,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '子订单编号',
      dataIndex: 'order-id-in-warehouse',
      width: 185,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '运单号',
      dataIndex: 'tracking-number',
      width: 200,
      ellipsis: true,
      render: (value: string) => <TrackingNumberLink value={value} />,
    },
    {
      title: '物流商',
      dataIndex: '_carrier',
      width: 85,
      render: (value: Carrier) => (
        <Tag color={value === 'FedEx' ? 'blue' : value === 'UPS' ? 'purple' : 'default'}>{value}</Tag>
      ),
    },
    {
      title: '仓库',
      dataIndex: 'warehouse-name',
      width: 160,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '异常类型',
      dataIndex: '_type',
      width: 90,
      render: (value: ExceptionType) => <Tag>{TYPE_LABEL[value]}</Tag>,
    },
    {
      title: '异常开始',
      dataIndex: '_startedAt',
      width: 140,
      render: (value: string) => (value ? dayjs(value).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '已持续',
      dataIndex: '_ageDays',
      width: 90,
      render: (value: number | null, row: EnrichedRow) =>
        value === null ? <Typography.Text type="secondary">未知</Typography.Text> : `${value} 天`,
    },
    {
      title: '状态',
      dataIndex: '_state',
      width: 100,
      render: (value: ExceptionState) => (
        <Tag
          color={value === '已恢复' ? 'green' : value === '已作废' ? 'default' : value === '待核实' ? 'orange' : 'red'}
        >
          {value}
        </Tag>
      ),
    },
    {
      title: '数据质量',
      dataIndex: '_quality',
      width: 110,
      render: (value: Quality) => <Tag color={QUALITY_COLOR[value]}>{value}</Tag>,
    },
    {
      title: '建议',
      dataIndex: '_suggestion',
      width: 120,
      render: (value: string) => value,
    },
    {
      title: '处理结果',
      dataIndex: 'handle_result',
      width: 110,
      render: (value: string) => value || '-',
    },
    {
      title: '关联工单',
      dataIndex: 'work_order_serial',
      width: 140,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '处理人',
      dataIndex: 'handler_name',
      width: 95,
      render: (value: string) => value || '-',
    },
    {
      title: '处理状态',
      dataIndex: 'handle_status',
      width: 100,
      render: (value: string) => value || '-',
    },
    {
      title: '处理事项',
      key: 'request-summary',
      width: 260,
      render: (_: unknown, row: EnrichedRow) => {
        const item = requestSummary[String(row['order-id'] || '')];
        if (!item) return <Typography.Text type="secondary">未发起</Typography.Text>;
        const parts: string[] = [];
        if (Number(item.contact_count) > 0) parts.push(`联系${item.contact_count}${item.contact_latest_status ? `（${item.contact_latest_status}）` : ''}`);
        if (Number(item.reship_count) > 0) parts.push(`补寄${item.reship_count}${item.reship_latest_status ? `（${item.reship_latest_status}）` : ''}`);
        if (Number(item.refund_count) > 0) parts.push(`退款${item.refund_count}${item.refund_latest_status ? `（${item.refund_latest_status}）` : ''}`);
        if (Number(item.claim_count) > 0) parts.push(`索赔${item.claim_count}${item.claim_latest_status ? `（${item.claim_latest_status}）` : ''}`);
        return parts.length ? <Typography.Text style={{ fontSize: 13, lineHeight: '20px' }}>{parts.join('；')}</Typography.Text> : '-';
      },
    },
    {
      title: '平台订单快递信息',
      key: 'express-info',
      width: 150,
      fixed: 'right' as const,
      render: (_: unknown, row: EnrichedRow) => (
        <Button type="link" size="small" onClick={() => void openExpressInfo(row)}>
          查看快递信息
        </Button>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 360,
      fixed: 'right' as const,
      render: (_: unknown, row: EnrichedRow) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setSelected(row);
              setManualNote('');
            }}
          >
            查看 / 处理
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() =>
              window.open(
                `/v/admin/tracking-exception/handling-detail?exception_id=${encodeURIComponent(
                  String(row.id),
                )}&tracking_number=${encodeURIComponent(String(row['tracking-number'] || ''))}`,
                '_blank',
              )
            }
          >
            处理明细
          </Button>
          <Button type="link" size="small" onClick={() => openWorkOrder(row)}>
            创建或关联工单
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'warehouse-contacts', label: '联系仓库' },
                { key: 'reship-requests', label: '补寄申请' },
                { key: 'refund-requests', label: '退款申请' },
                { key: 'claim-requests', label: '索赔申请' },
              ],
              onClick: ({ key }) => {
                openQuickRequest(key as 'warehouse-contacts' | 'reship-requests' | 'refund-requests' | 'claim-requests', row);
              },
            }}
          >
            <Button type="link" size="small">
              处理事项 <DownOutlined />
            </Button>
          </Dropdown>
        </Space>
      ),
    },
  ];

  // 固定列错位修复：scroll.x 必须等于“所有列宽 + 多选列宽”，否则 antd 会按比例拉伸，
  // 固定列（sticky）用声明宽度定位、表体用拉伸后宽度，表头/表体就会错位。
  const tableScrollX =
    columns.reduce((sum: number, col: any) => sum + (Number(col.width) || 0), 0) + (canAssign ? 32 : 0);

  // 高频筛选紧跟「导出当前筛选」，其余筛选项顺延，整体只占一两行
  const visibleFilters = FILTERS.filter((filter) => !isAgent || filter.key !== 'unassigned');
  const priorityFilters = PRIMARY_FILTER_KEYS.map((key) => visibleFilters.find((filter) => filter.key === key)).filter(
    Boolean,
  ) as Array<{ key: FilterKey; label: string }>;
  const restFilters = visibleFilters.filter((filter) => !PRIMARY_FILTER_KEYS.includes(filter.key));
  const stageFilterKeys: FilterKey[] = [
    'initial-3',
    'initial-3-7',
    'initial-7',
    'transit-3',
    'transit-3-7',
    'transit-7',
  ];
  const qualityFilterKeys: FilterKey[] = ['usable', 'suspect', 'technical'];
  const focusFilterKeys: FilterKey[] = ['recent-30', 'invalid', 'active', 'substantive'];
  const stageFilters = restFilters.filter((filter) => stageFilterKeys.includes(filter.key));
  const qualityFilters = restFilters.filter((filter) => qualityFilterKeys.includes(filter.key));
  const focusFilters = restFilters.filter((filter) => focusFilterKeys.includes(filter.key));
  const renderFilterChip = (filter: { key: FilterKey; label: string }) => (
    <Button
      key={filter.key}
      type={filterKey === filter.key ? 'primary' : 'default'}
      onClick={() => {
        setFilterKey(filter.key);
        if (filter.key === 'manual') setShowSuspect(true);
      }}
    >
      {filter.label}
      <span style={{ marginLeft: 6, color: FILTER_COLORS[filter.key], fontWeight: 600 }}>{counts[filter.key]}</span>
    </Button>
  );

  const advancedFilterContent = (
    <div style={{ width: 680, maxHeight: 430, overflow: 'auto', paddingRight: 4 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space>
          <Typography.Text>条件关系：</Typography.Text>
          <Select
            value={advancedLogic}
            style={{ width: 130 }}
            onChange={setAdvancedLogic}
            options={[
              { label: '满足全部', value: 'and' },
              { label: '满足任意', value: 'or' },
            ]}
          />
          <Button
            onClick={() =>
              setAdvancedConditions((items) => [
                ...items,
                { id: `${Date.now()}-${items.length}`, field: 'carrier', operator: 'eq', value: '' },
              ])
            }
          >
            添加条件
          </Button>
        </Space>
        {advancedConditions.map((condition, index) => {
          const field = ADVANCED_FIELDS.find((item) => item.value === condition.field);
          const noValue = condition.operator === 'is_empty' || condition.operator === 'not_empty';
          return (
            <Space key={condition.id} wrap align="center">
              <Typography.Text type="secondary">#{index + 1}</Typography.Text>
              <Select
                value={condition.field}
                style={{ width: 140 }}
                onChange={(value: AdvancedField) =>
                  setAdvancedConditions((items) =>
                    items.map((item) =>
                      item.id === condition.id
                        ? {
                            ...item,
                            field: value,
                            operator:
                              ADVANCED_FIELDS.find((candidate) => candidate.value === value)?.kind === 'number'
                                ? 'eq'
                                : 'contains',
                            value: '',
                          }
                        : item,
                    ),
                  )
                }
                options={ADVANCED_FIELDS.map((item) => ({ label: item.label, value: item.value }))}
              />
              <Select
                value={condition.operator}
                style={{ width: 130 }}
                onChange={(value: AdvancedOperator) =>
                  setAdvancedConditions((items) =>
                    items.map((item) => (item.id === condition.id ? { ...item, operator: value } : item)),
                  )
                }
                options={
                  field?.kind === 'number'
                    ? [
                        { label: '等于', value: 'eq' },
                        { label: '大于等于', value: 'gte' },
                        { label: '小于等于', value: 'lte' },
                        { label: '为空', value: 'is_empty' },
                        { label: '不为空', value: 'not_empty' },
                      ]
                    : [
                        { label: '等于', value: 'eq' },
                        { label: '不等于', value: 'neq' },
                        { label: '包含', value: 'contains' },
                        { label: '不包含', value: 'not_contains' },
                        { label: '为空', value: 'is_empty' },
                        { label: '不为空', value: 'not_empty' },
                      ]
                }
              />
              {!noValue ? (
                <Input
                  value={condition.value}
                  style={{ width: 190 }}
                  placeholder={field?.kind === 'number' ? '输入数字' : '输入筛选值'}
                  onChange={(event) =>
                    setAdvancedConditions((items) =>
                      items.map((item) => (item.id === condition.id ? { ...item, value: event.target.value } : item)),
                    )
                  }
                />
              ) : null}
              <Button
                danger
                type="text"
                onClick={() => setAdvancedConditions((items) => items.filter((item) => item.id !== condition.id))}
              >
                删除
              </Button>
            </Space>
          );
        })}
        <Space>
          <Button type="primary" onClick={() => setAdvancedOpen(false)}>
            应用
          </Button>
          <Button onClick={() => setAdvancedConditions([])}>重置</Button>
        </Space>
      </Space>
    </div>
  );

  // 帮助页正文：工作台不再内置 Drawer，独立帮助路由与后续帮助中心共用这块内容。
  const helpBody = (
    <>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          一、当前实时数据
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          数据随页面加载实时计算（来源 7D4），刷新页面即更新；与页面 KPI / 筛选条同源。
        </Typography.Paragraph>
        <div style={{ overflowX: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1040, fontSize: 12 }}>
            <thead>
              <tr>
                {helpMetrics.map((item) => (
                  <th
                    key={item.key}
                    style={{
                      padding: '8px 10px',
                      background: '#fafafa',
                      borderBottom: '1px solid #f0f0f0',
                      whiteSpace: 'nowrap',
                      textAlign: 'left',
                      fontWeight: 600,
                    }}
                  >
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {helpMetrics.map((item) => (
                  <td
                    key={item.key}
                    style={{
                      padding: '10px',
                      borderBottom: '1px solid #f0f0f0',
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    {item.value}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <Divider />
        <Typography.Title level={5}>二、上方 KPI 与下方筛选条的对应关系</Typography.Title>
        <Typography.Paragraph type="secondary">
          上方 KPI 的“异常中/已恢复”只统计<b>可用数据</b>；下方筛选条统计<b>当前筛选范围</b>（默认含可疑/其他承运商）。
          同名不同分母，数值不相等是正常的。
        </Typography.Paragraph>
        <Table
          size="small"
          pagination={false}
          rowKey="metric"
          dataSource={KPI_CHIP_ROWS}
          columns={[
            { title: '上方 KPI', dataIndex: 'metric', width: 190 },
            { title: '统计范围', dataIndex: 'scope', width: 120 },
            { title: '对应下方 chip', dataIndex: 'chip', width: 170 },
            { title: '关系', dataIndex: 'relation' },
          ]}
        />

        <Divider />
        <Typography.Title level={5}>三、字段含义与包含关系</Typography.Title>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <b>记号：</b>
          {HELP_LEGEND.map(([key, label]) => `${key} = ${label}`).join('；')}。
        </Typography.Paragraph>
        <div
          style={{
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 6,
            padding: '12px 14px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            lineHeight: 2,
            whiteSpace: 'pre-wrap',
          }}
        >
          {HELP_MATH}
        </div>
        <Typography.Paragraph style={{ marginTop: 8 }} type="secondary">
          说明：C ⊆ D 且通常为真子集；E 与 D 互斥，所以“技术异常”不会出现在“异常中”；F、G 都是 D 的子集，
          但 F 与 G 之间没有必然包含关系（待实质处理的行可能已有处理人）。
        </Typography.Paragraph>

        <Divider />
        <Typography.Title level={5}>四、补充说明</Typography.Title>
        <Typography.Paragraph>
          <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
            <li>数据来源：7D4，上游 FedEx/UPS 查询任务每 30 分钟更新一次；查询失败记为“技术异常”，不进入业务异常。</li>
            <li>
              “可疑/其他承运商”：目前只有 FedEx 和 UPS 接入了 API 查询，其余承运商（如 WP 单号）先进入可疑；
              后续通过人工导表或新 API 接入后转为可用。
            </li>
            <li>
              右侧“近 7 日实质异常”是每日 00:05 的快照（TrackingExceptionStatsDaily），与页面实时 KPI 不是同一时点；
              2026-11-18 起技术异常按 query_status 修正，历史快照口径不同。
            </li>
            <li>常见问题：上下数字不一致→分母不同；技术异常很多→先修查询链路（代理/网络）；可疑行很多→先做承运商/单号清洗。</li>
          </ul>
        </Typography.Paragraph>
    </>
  );

  if (helpMode) {
    return (
      <div style={{ padding: 24, maxWidth: 1200 }}>
        <Typography.Title level={3}>快递异常工作台 · 使用帮助</Typography.Title>
        {helpBody}
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 24,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Space align="center" wrap>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          快递异常工作台
        </Typography.Title>
        <Tooltip title="复制路由路径">
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={async () => {
              await navigator.clipboard.writeText(ROUTE);
              message.success(`已复制：${ROUTE}`);
            }}
          />
        </Tooltip>
        <Button type="primary" icon={<TeamOutlined />} onClick={() => setWorkloadOpen(true)}>
          今日分派
        </Button>
        <Dropdown
          menu={{
            items: [
              { key: 'detail', icon: <FileSearchOutlined />, label: '快递异常处理明细' },
              { key: 'summary', icon: <BarChartOutlined />, label: '快递异常处理汇总' },
              { key: 'recovery', icon: <ClockCircleOutlined />, label: '快递异常恢复周期' },
            ],
            onClick: ({ key }) => {
              if (key === 'detail') void openHandlingDetail();
              if (key === 'summary') void openHandlingSummary();
              if (key === 'recovery') void openRecoveryDetail();
            },
          }}
        >
          <Button>
            快递异常子页面 <DownOutlined />
          </Button>
        </Dropdown>
        <Dropdown
          menu={{
            items: [
              { key: 'warehouse-contacts', label: '仓库联系汇总' },
              { key: 'reship-requests', label: '补寄申请' },
              { key: 'refund-requests', label: '退款申请' },
              { key: 'claim-requests', label: '索赔申请' },
            ],
            onClick: ({ key }) => window.open(`/v/admin/after-sales/${key}`, '_blank'),
          }}
        >
          <Button>
            处理事项子页面 <DownOutlined />
          </Button>
        </Dropdown>
      </Space>
        <Tooltip title="打开使用帮助（实时数据 + 口径说明）">
          <Button size="small" icon={<QuestionCircleOutlined />} onClick={() => window.open('/v/admin/tracking-exception/help', '_blank')}>
            帮助
          </Button>
        </Tooltip>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        异常状态取 7D4 的 exception_status / data_status；人工处理写回 7D4 并追加 7D4_ActionLog。 路由：{ROUTE} ｜
        数据源：
        {DATA_SOURCE_KEY} ｜ 集合：{COLLECTION}
      </Typography.Paragraph>
      <style>{`.tracking-exception-table td { white-space: nowrap; vertical-align: middle; height: 40px; padding-top: 6px !important; padding-bottom: 6px !important; } .tracking-exception-table .ant-table-thead > tr > th { height: 38px; white-space: nowrap; } .tracking-exception-table .ant-table-measure-row td, .tracking-exception-table .ant-table-measure-row { height: 0 !important; padding: 0 !important; border: 0 !important; line-height: 0 !important; } .tracking-exception-stats .ant-statistic-title { font-size: 13px; color: rgba(0, 0, 0, 0.85); font-weight: 600; min-height: 40px; }
        .tracking-exception-stats .ant-space { align-items: stretch; }
        .tracking-exception-stats .ant-space-item { display: flex; }
        .tracking-exception-stats .ant-statistic { display: flex; flex-direction: column; width: 100%; }
        .tracking-exception-stats .ant-statistic-content { margin-top: auto; } .tracking-filter-bar .ant-btn { height: 32px; padding-inline: 12px; }
        .tracking-filter-bar .ant-btn > .anticon { font-size: 15px; }
        .tracking-filter-bar .ant-btn-sm { height: 32px; }`}</style>
      <div className="tracking-exception-stats" style={{ flexShrink: 0 }}>
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} xl={16}>
            <Space size="large" wrap>
              <Tooltip title="7D4 全部行，含可疑/其他承运商、已作废">
                <Statistic title="总行数" value={stats.total} />
              </Tooltip>
              <Tooltip title="数据质量=可用，且为 12 位 FedEx 或 UPS 运单">
                <Statistic title="可用 FedEx/UPS" value={stats.clean} valueStyle={{ color: '#3f8600' }} />
              </Tooltip>
              <Tooltip title="可用数据中仍异常的行；不含技术异常/已恢复/已作废。底部“异常中”是全部数据口径（含可疑行）">
                <Statistic title={<StatTitle main="异常中" sub="（可用）" />} value={stats.active} valueStyle={{ color: '#cf1322' }} />
              </Tooltip>
              <Tooltip title="可用数据中已恢复/已妥投的行。底部“已恢复”是全部数据口径（含可疑行）">
                <Statistic title={<StatTitle main="已恢复" sub="（可用）" />} value={stats.recovered} valueStyle={{ color: '#1677ff' }} />
              </Tooltip>
              <Tooltip title="非 FedEx/UPS，或数据质量非可用的行（如 WP 单号、其他承运商）">
                <Statistic title="可疑/其他承运商" value={stats.suspect} valueStyle={{ color: '#d46b08' }} />
              </Tooltip>
              <Tooltip title="全部数据中：仍异常、非技术异常、未关闭、异常持续≥7 天。含可疑/其他承运商；与底部“待实质处理”同一口径">
                <Statistic title={<StatTitle main="待实质处理" sub="（全部）" />} value={stats.substantive} valueStyle={{ color: '#cf1322' }} />
              </Tooltip>
              <Tooltip title="query_status=ERROR（FedEx 查询失败）的行；属数据/技术问题，不计入业务异常">
                <Statistic title="技术异常" value={stats.technical} valueStyle={{ color: '#d46b08' }} />
              </Tooltip>
              <Tooltip title="全部数据中：仍异常、非技术异常、未关闭、且没有处理人。含可疑/其他承运商">
                <Statistic title={<StatTitle main="待指派" sub="（全部）" />} value={stats.unassigned} valueStyle={{ color: '#d46b08' }} />
              </Tooltip>
              <Statistic
                title={<StatTitle main="过早处理率" sub="（近30天）" />}
                value={Number(stats.prematureRate.toFixed(2))}
                suffix="%"
                valueStyle={{ color: stats.prematureRate ? '#cf1322' : '#3f8600' }}
              />
              <Tooltip
                title={`近 30 天已恢复 ${stats.recoveryTotal} 个回合，其中 ${stats.recoveryCount} 个异常持续超过 3 天，计入平均；3 天以内的短时波动属于正常现象，不计入。`}
              >
                <Statistic
                  title={
                    <span>
                      <StatTitle main="平均恢复周期" sub="（近30天）" />
                      <InfoCircleOutlined style={{ marginLeft: 4, fontSize: 12, color: '#8c8c8c' }} />
                    </span>
                  }
                  value={
                    stats.recoveryAvg === null
                      ? '-'
                      : Number((stats.recoveryAvg < 1 ? stats.recoveryAvg * 24 : stats.recoveryAvg).toFixed(1))
                  }
                  suffix={stats.recoveryAvg === null ? undefined : stats.recoveryAvg < 1 ? '小时' : '天'}
                />
              </Tooltip>
            </Space>
          </Col>
          <Col xs={24} xl={8}>
            <Card size="small" style={{ height: '100%' }} styles={{ body: { padding: '8px 12px' } }}>
              <div
                style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}
              >
                <Typography.Text strong style={{ fontSize: 13 }}>
                  近 7 日实质异常
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  按日快照
                </Typography.Text>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {trendSeries.map((item) => (
                  <div key={item.date} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(item.date).format('MM-DD')}
                    </Typography.Text>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 15,
                        lineHeight: '18px',
                        fontWeight: 600,
                        color: item.value === null ? '#bfbfbf' : item.isToday ? '#cf1322' : '#262626',
                      }}
                    >
                      {item.value === null ? '—' : item.value}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
        </Row>
      </div>

      <Card className="tracking-filter-bar" size="small" styles={{ body: { padding: 10 } }} style={{ flexShrink: 0 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <Space wrap size={[8, 8]} align="center">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="订单号 / 运单号 / 店铺 / MSKU"
              style={{ width: 280 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              value={carrierFilter}
              style={{ width: 115 }}
              onChange={setCarrierFilter}
              options={[
                { label: '全部物流商', value: 'all' },
                { label: 'FedEx', value: 'FedEx' },
                { label: 'UPS', value: 'UPS' },
                { label: '其他', value: '其他' },
              ]}
            />
            <Select
              value={ownerFilter}
              style={{ width: 135 }}
              showSearch
              optionFilterProp="label"
              onChange={setOwnerFilter}
              options={[
                { label: '全部处理人', value: 'all' },
                { label: '未指派', value: 'unassigned' },
                ...users.map((user) => ({
                  label: String(user.nickname || user.username || user.id),
                  value: String(user.id),
                })),
              ]}
            />
            <Select
              value={qualityFilter}
              style={{ width: 125 }}
              onChange={setQualityFilter}
              options={[
                { label: '全部质量', value: 'all' },
                { label: '可用', value: '可用' },
                { label: '查询异常', value: '查询异常' },
                { label: '虚拟单号', value: '虚拟单号' },
                { label: '其他承运商', value: '其他承运商' },
                { label: '数据不完整', value: '数据不完整' },
                { label: '天数异常', value: '天数异常' },
                { label: '数据过旧', value: '数据过旧' },
              ]}
            />
            <Popover
              trigger="click"
              placement="bottomLeft"
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              content={advancedFilterContent}
            >
              <Button>高级筛选{advancedConditions.length ? `（${advancedConditions.length}）` : ''}</Button>
            </Popover>
            <Button
              onClick={() => {
                setKeyword('');
                setCarrierFilter('all');
                setOwnerFilter('all');
                setQualityFilter('all');
                setAdvancedConditions([]);
                setFilterKey('all');
              }}
            >
              重置
            </Button>
            <Tooltip title="刷新数据">
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
            </Tooltip>
          </Space>
          <Space wrap size={[6, 6]}>
            {canAssign ? (
              <Button
                size="small"
                type="primary"
                icon={<TeamOutlined />}
                disabled={!selectedRowKeys.length}
                onClick={() => setBatchAssignOpen(true)}
              >
                批量指派{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
              </Button>
            ) : null}
            {canAssign ? (
              <Button
                size="small"
                icon={<SafetyCertificateOutlined />}
                disabled={!selectedRowKeys.length}
                onClick={() => batchClose()}
              >
                批量核实恢复{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
              </Button>
            ) : null}
            <Button onClick={exportRows}>
              导出{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : '当前筛选'}
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content minmax(0, 1fr)',
            columnGap: 12,
            rowGap: 8,
            marginTop: 8,
            alignItems: 'start',
          }}
        >
          <Space wrap size={[6, 6]} align="center">
            <Tooltip title="关闭后只看可用数据">
              <Switch
                size="small"
                checked={showSuspect}
                onChange={(checked) => {
                  setShowSuspect(checked);
                  if (!checked && filterKey === 'manual') setFilterKey('all');
                }}
              />
            </Tooltip>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              队列：
            </Typography.Text>
            {priorityFilters.map(renderFilterChip)}
          </Space>
          <Space wrap size={[6, 6]} align="center">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              异常阶段：
            </Typography.Text>
            {stageFilters.map(renderFilterChip)}
          </Space>
          <Space wrap size={[6, 6]} align="center">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              数据质量：
            </Typography.Text>
            {qualityFilters.map(renderFilterChip)}
          </Space>
          <Space wrap size={[6, 6]} align="center">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              重点关注：
            </Typography.Text>
            {focusFilters.map(renderFilterChip)}
          </Space>
        </div>
      </Card>

      <Card
        title="异常明细"
        style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12 } }}
      >
        <div ref={tableWrapRef} style={{ flex: 1, minHeight: 0 }}>
          <Table<EnrichedRow>
            className="tracking-exception-table"
            rowKey="id"
            rowSelection={canAssign ? { selectedRowKeys, onChange: setSelectedRowKeys, columnWidth: 32 } : undefined}
            size="middle"
            loading={loading}
            dataSource={filteredRows}
            columns={columns as any}
            scroll={{ x: tableScrollX, y: tableScrollY }}
            tableLayout="fixed"
            pagination={{
              pageSize: 50,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100'],
              showTotal: (value) => `共 ${value} 行`,
            }}
          />
        </div>
      </Card>

      <Drawer open={Boolean(selected)} width={720} title="快递异常详情 / 处理" onClose={() => setSelected(null)}>
        {selected ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="店铺">{selected['store-name'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="仓库">{selected['warehouse-name'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="平台订单编号">{selected['order-id'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="子订单编号">{selected['order-id-in-warehouse'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="运单号">
                <TrackingNumberLink value={selected['tracking-number']} />
              </Descriptions.Item>
              <Descriptions.Item label="MSKU">{selected.msku || '-'}</Descriptions.Item>
              <Descriptions.Item label="快递状态">{selected.Status || '-'}</Descriptions.Item>
              <Descriptions.Item label="附加状态">{selected.AdditionalStatus || '-'}</Descriptions.Item>
              <Descriptions.Item label="异常原因" span={2}>
                {selected.exception_reason || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="异常类型">{TYPE_LABEL[selected._type]}</Descriptions.Item>
              <Descriptions.Item label="异常状态">{selected._state}</Descriptions.Item>
              <Descriptions.Item label="异常开始">{selected._startedAt || '-'}</Descriptions.Item>
              <Descriptions.Item label="已持续">
                {selected._ageDays === null ? '未知' : `${selected._ageDays} 天`}
              </Descriptions.Item>
              <Descriptions.Item label="处理人">{selected.handler_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="处理状态">{selected.handle_status || '-'}</Descriptions.Item>
              <Descriptions.Item label="数据质量" span={2}>
                <Tag color={QUALITY_COLOR[selected._quality]}>{selected._quality}</Tag>
                {selected._qualityReasons.length ? (
                  <Typography.Text type="secondary">{selected._qualityReasons.join('；')}</Typography.Text>
                ) : null}
              </Descriptions.Item>
              <Descriptions.Item label="最近处理备注" span={2}>
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                  {selected.handle_note || '-'}
                </Typography.Paragraph>
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="处理人 / 接手">
              <Space wrap>
                {canAssign !== false ? (
                  <>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="选择售后负责人"
                      style={{ width: 260 }}
                      value={assignUserId || undefined}
                      onChange={(value) => setAssignUserId(value)}
                      options={users.map((user) => ({
                        value: String(user.id),
                        label: String(user.nickname || user.username || user.name || user.id),
                      }))}
                    />
                    <Button type="primary" loading={assigning} onClick={() => void assignOwner()}>
                      确认指派
                    </Button>
                  </>
                ) : null}
                <Button loading={assigning} onClick={() => void acceptCase()}>
                  我接手
                </Button>
                <Typography.Text type="secondary">当前：{selected.handler_name || '未指派'}</Typography.Text>
              </Space>
            </Card>

            <Card size="small" title="行动时间线" loading={actionLogsLoading}>
              {[...actionLogs, ...requestTimeline].length ? (
                <Timeline
                  items={[...actionLogs, ...requestTimeline]
                    .sort((a, b) => String(b.action_at || '').localeCompare(String(a.action_at || '')))
                    .map((log) => ({
                      children: (
                        <Space direction="vertical" size={2}>
                          <Typography.Text strong>
                            {String(log.action_type || '-')} · {String(log.operator_name || '系统')}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {log.action_at ? dayjs(log.action_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
                          </Typography.Text>
                          {log.action_note ? <Typography.Text>{String(log.action_note)}</Typography.Text> : null}
                        </Space>
                      ),
                    }))}
                />
              ) : (
                <Typography.Text type="secondary">暂无行动记录</Typography.Text>
              )}
            </Card>

            <Alert
              type={selected._needsManual ? 'warning' : 'info'}
              showIcon
              message={selected._needsManual ? '这行需要人工核实' : '数据质量可用'}
              description={
                selected._needsManual
                  ? '核实后只写处理备注/处理状态，不改 Status、AdditionalStatus 等快递原字段。'
                  : '人工核实也会追加到处理备注，保留原有内容。'
              }
            />

            <Input.TextArea
              rows={4}
              value={manualNote}
              onChange={(event) => setManualNote(event.target.value)}
              placeholder="人工核实备注，例如：某月某日查快递仍异常 / 已恢复正常"
            />

            <Space wrap>
              <Button type="primary" loading={saving} onClick={() => void saveManualCheck('recovered')}>
                标记已核实恢复
              </Button>
              <Button danger loading={saving} onClick={() => void saveManualCheck('abnormal')}>
                标记仍异常
              </Button>
              <Button loading={saving} onClick={() => void saveManualCheck('note')}>
                仅保存备注
              </Button>
            </Space>
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        open={expressOpen}
        width={980}
        title={`平台订单快递信息${expressOrderId ? ` · ${expressOrderId}` : ''}`}
        onClose={() => setExpressOpen(false)}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions bordered size="small" column={3}>
            <Descriptions.Item label="平台订单编号">{expressOrderId || '-'}</Descriptions.Item>
            <Descriptions.Item label="子订单数">{expressRows.length}</Descriptions.Item>
            <Descriptions.Item label="是否已发快递通知邮件">
              {expressMail ? (
                Number(expressMail.email_sent) === 1 ? (
                  <Tag color="green">是</Tag>
                ) : (
                  <Tag color="orange">否</Tag>
                )
              ) : (
                <Tag>未生成通知</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="通知邮件发送时间" span={2}>
              {expressMail?.email_sent_at ? dayjs(expressMail.email_sent_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="可发时间">
              {expressMail?.platform_sendable_at
                ? dayjs(expressMail.platform_sendable_at).format('YYYY-MM-DD HH:mm:ss')
                : '-'}
            </Descriptions.Item>
          </Descriptions>

          <Table<Row>
            rowKey={(row) => String(row.id)}
            size="small"
            loading={expressLoading}
            dataSource={expressRows}
            pagination={false}
            scroll={{ x: 1100 }}
            columns={[
              { title: '子订单号', dataIndex: 'order-id-in-warehouse', width: 190, ellipsis: true },
              { title: '平台SKU', dataIndex: 'msku', width: 160, ellipsis: true },
              { title: '平台数量', dataIndex: 'msku-quantity', width: 90 },
              { title: '库存SKU', dataIndex: 'sku-in-stock', width: 150, ellipsis: true },
              { title: '库存数量', dataIndex: 'sku-in-stock-quantity', width: 90 },
              {
                title: '快递单号',
                dataIndex: 'tracking-number',
                width: 160,
                render: (value: string) => <TrackingNumberLink value={value} copyable />,
              },
              { title: '快递状态', dataIndex: 'Status', width: 130, render: (value: string) => value || '-' },
              { title: '附加状态', dataIndex: 'AdditionalStatus', width: 150, render: (value: string) => value || '-' },
              {
                title: '是否快递异常',
                dataIndex: 'is_tracking_exception',
                width: 120,
                render: (value: string) => (value === '是' ? <Tag color="red">是</Tag> : <Tag color="green">否</Tag>),
              },
              {
                title: '发货时间',
                dataIndex: 'operate-shipment',
                width: 150,
                render: (value: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
              },
              {
                title: '下单时间',
                dataIndex: 'purchase-date',
                width: 150,
                render: (value: string) => (value ? dayjs(value).format('YYYY-MM-DD') : '-'),
              },
            ]}
          />
        </Space>
      </Drawer>

      <Drawer open={workloadOpen} width={820} title="分派与工作量" onClose={() => setWorkloadOpen(false)}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Typography.Text>统计周期：</Typography.Text>
            <Select
              value={workloadPeriod}
              style={{ width: 90 }}
              onChange={(value) => setWorkloadPeriod(value)}
              options={[
                { label: '日', value: 'day' },
                { label: '月', value: 'month' },
              ]}
            />
            {workloadPeriod === 'month' ? (
              <DatePicker.MonthPicker
                value={workloadDate}
                onChange={(value) => value && setWorkloadDate(value)}
                allowClear={false}
              />
            ) : (
              <DatePicker
                value={workloadDate}
                onChange={(value) => value && setWorkloadDate(value)}
                allowClear={false}
              />
            )}
            <Typography.Text type="secondary">
              按当前分配人与当前异常数据计算；分配量优先取分配事件记录。
            </Typography.Text>
          </Space>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={workloadRows}
            columns={[
              {
                title: '处理人',
                dataIndex: 'name',
                width: 120,
                render: (value: string, row: any) => (
                  <Button
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() => {
                      setOwnerFilter(String(row.id));
                      setFilterKey('all');
                      setWorkloadOpen(false);
                    }}
                  >
                    {value}
                  </Button>
                ),
              },
              { title: workloadPeriod === 'month' ? '本月新分' : '当日新分', dataIndex: 'assigned', width: 90 },
              { title: workloadPeriod === 'month' ? '本月完成' : '当日完成', dataIndex: 'completed', width: 90 },
              { title: workloadPeriod === 'month' ? '期初结转' : '历史结转', dataIndex: 'carryover', width: 90 },
              { title: workloadPeriod === 'month' ? '本月剩余' : '当日剩余', dataIndex: 'remaining', width: 90 },
              { title: '当前在手', dataIndex: 'open', width: 90 },
              {
                title: '完成率',
                dataIndex: 'rate',
                width: 100,
                render: (value: number) => `${Number(value || 0).toFixed(1)}%`,
              },
            ]}
          />
        </Space>
      </Drawer>

      <Modal
        open={batchAssignOpen}
        title="批量指派"
        okText="确认指派"
        cancelText="取消"
        confirmLoading={batchAssigning}
        onOk={() => void batchAssign()}
        onCancel={() => setBatchAssignOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">已选 {selectedRowKeys.length} 行</Typography.Text>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择售后负责人"
            value={batchAssignUserId || undefined}
            onChange={setBatchAssignUserId}
            options={users.map((user) => ({
              value: String(user.id),
              label: String(user.nickname || user.username || user.name || user.id),
            }))}
          />
        </Space>
      </Modal>

      <Modal
        open={workOrderOpen}
        title="创建或关联工单"
        footer={null}
        width={700}
        onCancel={() => {
          setWorkOrderOpen(false);
          setWorkOrderRow(null);
        }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            平台订单编号：{workOrderRow?.['order-id'] || '-'} ｜ 子订单编号：
            {workOrderRow?.['order-id-in-warehouse'] || '-'}
          </Typography.Text>
          <Space>
            <Button type={workOrderMode === 'link' ? 'primary' : 'default'} onClick={() => setWorkOrderMode('link')}>
              关联工单
            </Button>
            <Button
              type={workOrderMode === 'create' ? 'primary' : 'default'}
              onClick={() => setWorkOrderMode('create')}
            >
              创建工单
            </Button>
          </Space>

          {workOrderMode === 'link' ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                填入「售后工单工作台」已有的工单号，只绑定，不新建工单。
              </Typography.Text>
              <Input
                value={linkSerial}
                onChange={(event) => setLinkSerial(event.target.value)}
                placeholder="请输入 AfterSalesWorkOrderV2 工单号"
              />
              <Button type="primary" loading={linking} onClick={() => void saveLinkWorkOrder()}>
                保存关联
              </Button>
            </Space>
          ) : (
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Typography.Text type="secondary">
                当前登录人：{currentUser?.nickname || currentUser?.username || '-'}
                ；邮件抬头默认取个人配置，可手动修改。
              </Typography.Text>
              <Typography.Text type="secondary">
                创建新工单，类型写入 creation_source=tracking（快递异常推送）。
              </Typography.Text>
              <Form layout="vertical">
                <Form.Item label="邮件抬头">
                  <Select
                    value={createGreeting}
                    onChange={setCreateGreeting}
                    options={[...new Set([createGreeting, ...GREETINGS])].map((value) => ({ label: value, value }))}
                  />
                </Form.Item>
                <Form.Item label="买家问题类型">
                  <Input value={createIssueType} onChange={(event) => setCreateIssueType(event.target.value)} />
                </Form.Item>
                <Form.Item label="相关信息补充">
                  <Input.TextArea
                    rows={3}
                    value={createContext}
                    onChange={(event) => setCreateContext(event.target.value)}
                  />
                </Form.Item>
                <Form.Item label="语气和语言要求">
                  <Input value={createTone} onChange={(event) => setCreateTone(event.target.value)} />
                </Form.Item>
                <Form.Item label="回复倾向">
                  <Input value={createPreference} onChange={(event) => setCreatePreference(event.target.value)} />
                </Form.Item>
                <Form.Item label="邮件篇幅">
                  <Input value={createLength} onChange={(event) => setCreateLength(event.target.value)} />
                </Form.Item>
                <Form.Item label="标准参考案例模板路径">
                  <Input value={createTemplate} onChange={(event) => setCreateTemplate(event.target.value)} />
                </Form.Item>
              </Form>
              <Button type="primary" block loading={creating} onClick={() => void saveCreateWorkOrder()}>
                创建工单
              </Button>
            </Space>
          )}
        </Space>
      </Modal>

      <Modal
        open={Boolean(quickKind)}
        title={quickKind === 'warehouse-contacts' ? '联系仓库' : quickKind === 'reship-requests' ? '补寄申请' : quickKind === 'refund-requests' ? '退款申请' : '索赔申请'}
        width={720}
        onCancel={() => { setQuickKind(null); setQuickRow(null); setQuickCreated(null); }}
        footer={quickCreated ? [
          <Button key="close" onClick={() => { setQuickKind(null); setQuickRow(null); setQuickCreated(null); }}>关闭</Button>,
          <Button key="continue" type="primary" onClick={() => window.open(quickCreated.url, '_blank')}>继续编辑</Button>,
        ] : [
          <Button key="cancel" onClick={() => { setQuickKind(null); setQuickRow(null); }}>取消</Button>,
          <Button key="create" type="primary" loading={quickSaving} onClick={() => void saveQuickRequest()}>创建</Button>,
        ]}
      >
        {quickCreated ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="success" showIcon message={`${quickCreated.title}已创建`} />
            <Typography.Text type="secondary">
              当前母页面不会自动跳转。可以继续编辑其他字段，或点击“继续编辑”进入子页面查看和处理。
            </Typography.Text>
            <Button type="primary" onClick={() => window.open(quickCreated.url, '_blank')}>继续编辑</Button>
          </Space>
        ) : (
          <Form form={quickForm} layout="vertical">
            <Row gutter={12}>
              <Col span={12}><Form.Item name="platform_order_id" label="平台订单编号" rules={[{ required: true }]}><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="sub_order_id" label="子订单编号"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="platform_sku" label="平台 SKU"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="stock_sku" label="库存 SKU"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="tracking_number" label="运单号"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="store_name" label="店铺"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="warehouse_name" label="仓库"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="handler_name" label="处理人"><Input /></Form.Item></Col>
              <Col span={12}><Form.Item name="handler_id" hidden><Input /></Form.Item></Col>
            </Row>
            {quickKind === 'warehouse-contacts' ? (
              <>
                <Form.Item name="issue_description" label="问题描述"><Input.TextArea rows={2} /></Form.Item>
                <Form.Item name="message_content" label="联系诉求">
                  <AutoComplete
                    options={[
                      { value: '处于初始状态多天未更新，请确认发货状态并及时发货' },
                      { value: '停滞多天未更新，请联系物流承运商调查运输情况并加速运输' },
                      { value: '派送异常，请加速派送' },
                    ]}
                    placeholder="选择常用话术，或直接输入自定义诉求"
                    filterOption={(inputValue, option) => String(option?.value || '').includes(inputValue)}
                  />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}><Form.Item name="contact_channel" label="联系渠道"><Select options={['微信', '飞书', '仓库系统'].map((value) => ({ label: value, value }))} /></Form.Item></Col>
                </Row>
              </>
            ) : null}
            {quickKind === 'reship-requests' ? (
              <>
                <Row gutter={12}>
                  <Col span={12}><Form.Item name="reship_type" label="补寄类型"><Select options={['新箱', '部件'].map((value) => ({ label: value, value }))} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="quantity" label="数量"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="reship_item_sku" label="补寄物品 SKU"><Input /></Form.Item></Col>
                  <Col span={12}><Form.Item name="reship_item_name" label="补寄物品名称"><Input /></Form.Item></Col>
                </Row>
                <Form.Item name="reason" label="补寄原因"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item name="buyer_photos" label="问题图片（最多 5 张）">
                  <AttachmentField ctx={ctx} label="问题图片" maxCount={5} />
                </Form.Item>
              </>
            ) : null}
            {quickKind === 'refund-requests' ? (
              <>
                <Row gutter={12}>
                  <Col span={12}><Form.Item name="refund_amount" label="退款金额"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="refund_currency" label="币种"><Select options={['USD', 'CNY', 'EUR', 'GBP'].map((value) => ({ label: value, value }))} /></Form.Item></Col>
                </Row>
                <Form.Item name="reason" label="退款原因"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item name="refund_photos" label="问题图片（最多 3 张）">
                  <AttachmentField ctx={ctx} label="问题图片" maxCount={3} />
                </Form.Item>
              </>
            ) : null}
            {quickKind === 'claim-requests' ? (
              <>
                <Row gutter={12}>
                  <Col span={12}><Form.Item name="claim_amount" label="索赔金额"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="claim_currency" label="币种"><Select options={['USD', 'CNY', 'EUR', 'GBP'].map((value) => ({ label: value, value }))} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="claim_trigger" label="触发类型"><Select options={['处于初始状态长期未更新', '处于运输状态长期停滞未更新', '交付异常：显示已交付，反馈未收到', '受损返仓', '异常返仓'].map((value) => ({ label: value, value }))} /></Form.Item></Col>
                  <Col span={12}><Form.Item name="related_request_no" label="关联补寄/退款单号"><Input /></Form.Item></Col>
                </Row>
                <Form.Item name="claim_reason" label="索赔原因"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item name="claim_packing_list" label="装箱清单 PDF">
                  <AttachmentField ctx={ctx} label="装箱清单" maxCount={1} accept="application/pdf" />
                </Form.Item>
                <Form.Item name="claim_email_evidence" label="邮件沟通截图">
                  <AttachmentField ctx={ctx} label="邮件截图" maxCount={5} />
                </Form.Item>
                <Form.Item name="claim_tracking_evidence" label="快递异常/交付截图">
                  <AttachmentField ctx={ctx} label="快递截图" maxCount={5} />
                </Form.Item>
                <Form.Item name="claim_other_evidence" label="其他材料">
                  <AttachmentField ctx={ctx} label="其他材料" maxCount={5} />
                </Form.Item>
              </>
            ) : null}
          </Form>
        )}
      </Modal>


    </div>
  );
}
