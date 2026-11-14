import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  DatePicker,
  Col,
  Drawer,
  Form,
  Input,
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
import { CopyOutlined, InfoCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  'sku-in-stock-quantity',
  'email-address',
  'Status',
  'AdditionalStatus',
  'DaysBeforeOnline',
  'DaysOfStalled',
  'DeliveredDate',
  'ScheduledDeliveryDate',
  'exception_reason',
  'note',
  'handle_status',
  'closed_at',
  'handler_id',
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
type Quality = '可用' | '查询异常' | '虚拟单号' | '非FedEx' | '数据不完整' | '天数异常' | '数据过旧';
type Carrier = 'FedEx' | 'UPS' | '其他';
type ExceptionType = 'initial' | 'transit' | 'other';
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

function enrich(row: Row): EnrichedRow {
  const tracking = String(row['tracking-number'] ?? '').trim();
  const status = String(row.Status ?? '').trim();
  const additional = String(row.AdditionalStatus ?? '').trim();
  const note = parseNote(row.note);
  const reasons: string[] = [];

  const isFedex = /^\d{12}$/.test(tracking);
  const isVirtual = /^8926\d{11}$/.test(tracking);
  const isTechnical =
    /邮件查询错误|查询错误|NOTFOUND|TRACKINGNUMBER/i.test(`${additional} ${status}`) ||
    /NOTFOUND/i.test(String(row.note ?? ''));
  const isNonFedex = Boolean(tracking) && !isFedex && !isVirtual;
  const delivered = Boolean(row.DeliveredDate) || /delivered|entregado/i.test(status);
  const noteRecovered = Boolean(note?.recoveredAt) || note?.active === false;
  const v2Recovered = row.exception_status === 'recovered';
  const isInvalid = row.data_status === 'invalid';
  const isRecovered = v2Recovered || delivered || noteRecovered;

  let quality: Quality = '可用';
  if (isVirtual) {
    quality = '虚拟单号';
    reasons.push('15 位 8926 开头，判定为 Wayfair 虚拟单号，不应查 FedEx');
  } else if (isNonFedex) {
    quality = '非FedEx';
    reasons.push('非 12 位纯数字，未调用 FedEx 查询');
  } else if (isTechnical) {
    quality = '查询异常';
    reasons.push('AdditionalStatus/备注显示查询错误，需人工核实');
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
  if (/label created|etiqueta|初始|待上网/i.test(statusText) || (numberOrNull(row.DaysBeforeOnline) ?? 0) > 3) {
    type = 'initial';
  } else if ((numberOrNull(row.DaysOfStalled) ?? 0) > 3 || /on the way|en camino|in transit|运输中/i.test(statusText)) {
    type = 'transit';
  }

  const state: ExceptionState = isInvalid ? '已作废' : isRecovered ? '已恢复' : isTechnical ? '待核实' : '异常中';
  const isClean = quality === '可用' && isFedex && !isTechnical && !isInvalid;
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
    _isActive: row.exception_active === 1 || row.exception_active === true || (!isRecovered && !isInvalid),
    _isTechnical: isTechnical,
    _suggestion: suggestion,
    _statusLabel: normalizeStatus(row.Status),
  };
}

const TYPE_LABEL: Record<ExceptionType, string> = {
  initial: '初始状态',
  transit: '运输途中',
  other: '其他',
};

const QUALITY_COLOR: Record<Quality, string> = {
  可用: 'green',
  查询异常: 'orange',
  虚拟单号: 'purple',
  非FedEx: 'blue',
  数据不完整: 'red',
  天数异常: 'red',
  数据过旧: 'volcano',
};

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

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'usable', label: '可用 FedEx' },
  { key: 'suspect', label: '可疑/非FedEx' },
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

export default function TrackingExceptionPage() {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  // v2 flow context 的当前用户可能挂在 ctx.user，而不是 currentUser。
  // 统一归一化，否则“我接手”没有效果，“我的待办”也永远按空用户计算。
  const rawCurrentUser: any = (ctx as any)?.user ?? (ctx as any)?.currentUser;
  const currentUser: any = rawCurrentUser?.data?.data ?? rawCurrentUser?.data ?? rawCurrentUser ?? {};
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuspect, setShowSuspect] = useState(true);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [workloadOpen, setWorkloadOpen] = useState(false);
  const [workloadDate, setWorkloadDate] = useState(dayjs());
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [carrierFilter, setCarrierFilter] = useState<'all' | Carrier>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [selected, setSelected] = useState<EnrichedRow | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [actionLogs, setActionLogs] = useState<Row[]>([]);
  const [actionLogsLoading, setActionLogsLoading] = useState(false);
  const [actionType, setActionType] = useState('contacted_warehouse');
  const [actionNote, setActionNote] = useState('');
  const [contactTarget, setContactTarget] = useState('');
  const [followUpAt, setFollowUpAt] = useState<string>('');
  const [resendTrackingNumber, setResendTrackingNumber] = useState('');
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundCurrency, setRefundCurrency] = useState('USD');
  const [claimRecordNo, setClaimRecordNo] = useState('');
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
  const [batchAssignUserId, setBatchAssignUserId] = useState('');
  const [batchAssigning, setBatchAssigning] = useState(false);
  // 页面固定高度：只有表体滚动，标题/统计/筛选/表头保持不动（与售后工单工作台一致）
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(360);

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
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [ctx, message]);

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
        data: { handler_name: name, handler_id: user.id, owner_id: user.id },
      });
      message.success(`已指派给 ${name}`);
      setSelected(null);
      setAssignUserId('');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAssigning(false);
    }
  }, [assignUserId, ctx, load, message, selected, users]);

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
          handle_status: '跟踪中',
          handle_updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        },
      });
      message.success('已接手');
      setSelected(null);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAssigning(false);
    }
  }, [ctx, load, message, selected]);

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
  }, [batchAssignUserId, ctx, load, message, selectedRowKeys]);

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

  useEffect(() => {
    if (!selected) {
      setActionLogs([]);
      return;
    }
    void loadActionLogs(selected.id);
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
        if (carrierFilter !== 'all' && row._carrier !== carrierFilter) return false;
        if (ownerFilter === 'unassigned') return !row.handler_id;
        if (ownerFilter !== 'all' && Number(row.handler_id) !== Number(ownerFilter)) return false;
        return true;
      }),
    [rows, carrierFilter, ownerFilter],
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
    const substantive = rows.filter((row) => {
      if (!row._isActive || row._isTechnical || row.is_delivered === 1) return false;
      const lastEvent = row.source_updated_at || row.exception_started_at;
      return lastEvent ? dayjs().diff(dayjs(lastEvent), 'day') >= 7 : (row._ageDays ?? 0) >= 7;
    });
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

  const workloadRows = useMemo(() => {
    const target = workloadDate.startOf('day');
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
      if (assignedAt?.isSame(target, 'day')) item.assigned += 1;
      if (closedAt?.isSame(target, 'day')) item.completed += 1;
      if (isOpen) item.open += 1;
      if (isOpen && assignedAt && assignedAt.isBefore(target, 'day')) item.carryover += 1;
    }
    return Array.from(byOwner.values())
      .map((item) => ({
        ...item,
        remaining: item.assigned + item.carryover - item.completed,
        rate: item.assigned + item.carryover > 0 ? (item.completed * 100) / (item.assigned + item.carryover) : 0,
      }))
      .sort((a, b) => b.open - a.open || b.assigned - a.assigned);
  }, [rows, workloadDate]);

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
      render: (value: string) => (
        <Typography.Text copyable style={{ whiteSpace: 'nowrap' }}>
          {value || '-'}
        </Typography.Text>
      ),
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
      title: '平台订单快递信息',
      key: 'express-info',
      width: 130,
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
      width: 200,
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
          <Button type="link" size="small" onClick={() => openWorkOrder(row)}>
            创建或关联工单
          </Button>
        </Space>
      ),
    },
  ];

  // 高频筛选紧跟「导出当前筛选」，其余筛选项顺延，整体只占一两行
  const visibleFilters = FILTERS.filter((filter) => !isAgent || filter.key !== 'unassigned');
  const priorityFilters = PRIMARY_FILTER_KEYS.map((key) => visibleFilters.find((filter) => filter.key === key)).filter(
    Boolean,
  ) as Array<{ key: FilterKey; label: string }>;
  const restFilters = visibleFilters.filter((filter) => !PRIMARY_FILTER_KEYS.includes(filter.key));
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
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
        <Button onClick={() => setWorkloadOpen(true)}>今日分派</Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        异常状态取 7D4 的 exception_status / data_status；人工处理写回 7D4 并追加 7D4_ActionLog。 路由：{ROUTE} ｜
        数据源：
        {DATA_SOURCE_KEY} ｜ 集合：{COLLECTION}
      </Typography.Paragraph>
      <style>{`.tracking-exception-table td { white-space: nowrap; vertical-align: middle; height: 40px; padding-top: 6px !important; padding-bottom: 6px !important; } .tracking-exception-table .ant-table-thead > tr > th { height: 38px; white-space: nowrap; } .tracking-exception-table .ant-table-measure-row td, .tracking-exception-table .ant-table-measure-row { height: 0 !important; padding: 0 !important; border: 0 !important; line-height: 0 !important; } .tracking-exception-stats .ant-statistic-title { font-size: 13px; color: rgba(0, 0, 0, 0.85); font-weight: 600; } .tracking-filter-bar .ant-btn { padding-inline: 10px; }`}</style>
      <div className="tracking-exception-stats" style={{ flexShrink: 0 }}>
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} xl={16}>
            <Space size="large" wrap>
              <Statistic title="总行数" value={stats.total} />
              <Statistic title="可用 FedEx" value={stats.clean} valueStyle={{ color: '#3f8600' }} />
              <Statistic title="异常中" value={stats.active} valueStyle={{ color: '#cf1322' }} />
              <Statistic title="已恢复" value={stats.recovered} valueStyle={{ color: '#1677ff' }} />
              <Statistic title="可疑/非FedEx" value={stats.suspect} valueStyle={{ color: '#d46b08' }} />
              <Tooltip title="仍异常、未妥投、非技术异常，且最后事件时间已超过 7 天；7D4 历史不足 7 天时必然为 0。">
                <Statistic title="实质异常" value={stats.substantive} valueStyle={{ color: '#cf1322' }} />
              </Tooltip>
              <Statistic title="技术异常" value={stats.technical} valueStyle={{ color: '#d46b08' }} />
              <Statistic title="待指派" value={stats.unassigned} valueStyle={{ color: '#d46b08' }} />
              <Statistic
                title="过早处理率（近30天）"
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
                      平均恢复周期（近30天）
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
        <Space wrap size={[6, 6]} align="center" style={{ width: '100%' }}>
          <Tooltip title="默认显示全部数据；关闭后只看可用 FedEx 数据（可疑 / 非 FedEx / 技术异常会被隐藏）。">
            <Space size={4}>
              <Switch
                checked={showSuspect}
                onChange={(checked) => {
                  setShowSuspect(checked);
                  if (!checked && filterKey === 'manual') setFilterKey('all');
                }}
              />
              <Typography.Text style={{ fontSize: 12 }}>
                {showSuspect ? '显示可疑数据' : '只看可用数据'}
              </Typography.Text>
            </Space>
          </Tooltip>
          <Select
            value={carrierFilter}
            style={{ width: 120 }}
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
            style={{ width: 150 }}
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
            style={{ width: 140 }}
            onChange={setQualityFilter}
            options={[
              { label: '全部质量', value: 'all' },
              { label: '可用', value: '可用' },
              { label: '查询异常', value: '查询异常' },
              { label: '虚拟单号', value: '虚拟单号' },
              { label: '非FedEx', value: '非FedEx' },
              { label: '数据不完整', value: '数据不完整' },
              { label: '天数异常', value: '天数异常' },
              { label: '数据过旧', value: '数据过旧' },
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="订单号 / 运单号 / 店铺 / MSKU"
            style={{ width: 300 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {canAssign ? (
            <Button
              size="small"
              type="primary"
              disabled={!selectedRowKeys.length}
              onClick={() => setBatchAssignOpen(true)}
            >
              批量指派{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
            </Button>
          ) : null}
          {canAssign ? (
            <Button danger disabled={!selectedRowKeys.length} onClick={() => batchClose()}>
              批量核实恢复{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : ''}
            </Button>
          ) : null}
          <Button onClick={exportRows}>
            导出{selectedRowKeys.length ? `（${selectedRowKeys.length}）` : '当前筛选'}
          </Button>
          {priorityFilters.map(renderFilterChip)}
          {restFilters.map(renderFilterChip)}
        </Space>
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
            rowSelection={canAssign ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined}
            size="middle"
            loading={loading}
            dataSource={filteredRows}
            columns={columns as any}
            scroll={{ x: 2260, y: tableScrollY }}
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
              <Descriptions.Item label="运单号">{selected['tracking-number'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="MSKU">{selected.msku || '-'}</Descriptions.Item>
              <Descriptions.Item label="快递状态">{selected.Status || '-'}</Descriptions.Item>
              <Descriptions.Item label="附加状态">{selected.AdditionalStatus || '-'}</Descriptions.Item>
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
              {actionLogs.length ? (
                <Timeline
                  items={actionLogs.map((log) => ({
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

            <Card size="small" title="新增行动记录">
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Select
                  value={actionType}
                  onChange={setActionType}
                  style={{ width: 220 }}
                  options={[
                    { label: '需跟踪', value: 'tracking' },
                    { label: '已联系仓库', value: 'contacted_warehouse' },
                    { label: '已补寄', value: 'reship' },
                    { label: '已退款', value: 'refund' },
                    { label: '完结', value: 'close' },
                    { label: '其他', value: 'other' },
                  ]}
                />
                <Input.TextArea
                  rows={2}
                  value={actionNote}
                  onChange={(event) => setActionNote(event.target.value)}
                  placeholder="行动说明"
                />
                {actionType === 'contacted_warehouse' ? (
                  <Input
                    value={contactTarget}
                    onChange={(event) => setContactTarget(event.target.value)}
                    placeholder="联系对象 / 仓库"
                  />
                ) : null}
                {actionType === 'reship' ? (
                  <Input
                    value={resendTrackingNumber}
                    onChange={(event) => setResendTrackingNumber(event.target.value)}
                    placeholder="补寄运单号"
                  />
                ) : null}
                {actionType === 'refund' ? (
                  <Space>
                    <Input
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                      placeholder="退款金额"
                      style={{ width: 140 }}
                    />
                    <Select
                      value={refundCurrency}
                      onChange={setRefundCurrency}
                      style={{ width: 100 }}
                      options={[{ value: 'USD' }, { value: 'CNY' }, { value: 'EUR' }]}
                    />
                  </Space>
                ) : null}
                {actionType === 'close' ? (
                  <Input
                    value={closeReason}
                    onChange={(event) => setCloseReason(event.target.value)}
                    placeholder="关闭原因（必填）"
                  />
                ) : null}
                <Space wrap>
                  <Input
                    value={claimRecordNo}
                    onChange={(event) => setClaimRecordNo(event.target.value)}
                    placeholder="索赔记录号（可选）"
                  />
                  <Input
                    value={workOrderSerial}
                    onChange={(event) => setWorkOrderSerial(event.target.value)}
                    placeholder="关联工单号（可选）"
                  />
                  <Select
                    value={customerContacted}
                    onChange={setCustomerContacted}
                    style={{ width: 150 }}
                    options={[
                      { label: '客户未沟通', value: '0' },
                      { label: '客户已沟通', value: '1' },
                    ]}
                  />
                  <DatePicker
                    showTime
                    value={followUpAt ? dayjs(followUpAt) : null}
                    onChange={(value) => setFollowUpAt(value ? value.format('YYYY-MM-DD HH:mm:ss') : '')}
                    placeholder="下次跟进时间"
                  />
                </Space>
                <Button type="primary" loading={saving} onClick={() => void saveActionLog()}>
                  记录行动
                </Button>
              </Space>
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
                render: (value: string) => (value ? <Typography.Text copyable>{value}</Typography.Text> : '-'),
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
            <Typography.Text>统计日期：</Typography.Text>
            <DatePicker value={workloadDate} onChange={(value) => value && setWorkloadDate(value)} allowClear={false} />
            <Typography.Text type="secondary">
              当日新分、当日完成、昨日结转和当前在手均按当前分配人与当前异常数据计算。
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
              { title: '当日新分', dataIndex: 'assigned', width: 90 },
              { title: '当日完成', dataIndex: 'completed', width: 90 },
              { title: '历史结转', dataIndex: 'carryover', width: 90 },
              { title: '当日剩余', dataIndex: 'remaining', width: 90 },
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
    </div>
  );
}
