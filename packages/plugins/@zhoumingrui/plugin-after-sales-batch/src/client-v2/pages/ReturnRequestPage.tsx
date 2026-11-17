import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ClockCircleOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { AttachmentField } from './AfterSalesRequestsPage';

/**
 * 领星退货申请工作台（P1 骨架）
 *
 * 数据/业务全部在 Connector：
 *   GET  /ai/return-orders/list   列表（店铺/退货状态/订单号/日期/等待>N小时/仅未沟通/未指派/我的待办）
 *   GET  /ai/return-orders/stats  我的待办 / 今日分派 / 按人工作量
 *   POST /ai/return-orders/assign 单个或批量指派（责任人表同步）
 *   POST /ai/return-orders/status 单个或批量标记处理状态
 * NocoBase 侧只做转发（returnRequestWorkbench:*）。
 */
const ROUTE = '/return-request/workbench';
const STORES = [
  'Rattan artisan-US',
  'Oasishine-US',
  'Waroom-US',
  'Lviden-US',
  'Leishire-US',
  'Anding-US',
];
const RETURN_STATUS = ['Approved', 'PendingApproval', 'Rejected'];
const HANDLE_STATUS = ['待处理', '处理中', '已完结'];
const WAIT_OPTIONS = [
  { label: '等待 > 12 小时', value: 12 },
  { label: '等待 > 24 小时', value: 24 },
  { label: '等待 > 36 小时', value: 36 },
  { label: '等待 > 48 小时', value: 48 },
];

const STATUS_COLOR: Record<string, string> = {
  待处理: 'orange',
  处理中: 'blue',
  已完结: 'green',
};
const COMM_COLOR: Record<string, string> = {
  待卖家回复: 'volcano',
  待买家回复: 'gold',
};

function normalizeCurrentUser(raw: any) {
  const user = raw?.data?.data ?? raw?.data ?? raw ?? {};
  return {
    id: Number(user.id) || null,
    name: user.nickname || user.username || user.name || '',
  };
}

/**
 * NocoBase 会把自定义 action 的返回包一层：
 *   - 普通对象：{ data: {...} }
 *   - 名字是 list 的 action：{ data: [rows], meta: {...} }
 * 这里统一解包，兼容 {rows,total} 与 {data,meta} 两种形态。
 */
function unwrapActionResult(response: any) {
  const body = response?.data ?? response;
  if (Array.isArray(body)) return { rows: body, total: Number(response?.meta?.total) || body.length };
  if (Array.isArray(body?.data)) {
    return { rows: body.data, total: Number(body?.meta?.total ?? body?.total) || body.data.length };
  }
  if (Array.isArray(body?.rows)) {
    return { rows: body.rows, total: Number(body?.total) || body.rows.length };
  }
  return { rows: [], total: 0 };
}

function unwrapObjectAction(response: any) {
  const body = response?.data ?? response;
  if (body && typeof body === 'object' && 'data' in body && !Array.isArray(body.data)) {
    return body.data;
  }
  return body;
}

function formatWait(hours: unknown) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 24) return `${value} 小时`;
  return `${Math.floor(value / 24)} 天 ${value % 24} 小时`;
}

export default function ReturnRequestPage() {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const currentUser = useMemo(
    () => normalizeCurrentUser((ctx as any)?.user ?? (ctx as any)?.currentUser),
    [ctx],
  );

  const roles: string[] = ((ctx as any)?.user?.roles || [])
    .map((role: any) => String(role?.name || role || ''))
    .filter(Boolean);
  const canAssign = roles.length === 0
    || roles.some((role) => ['after_sales_manager', 'after_sales_duty', 'admin', 'root'].includes(role));
  const canOperateRow = (row: any) => {
    if (!row) return false;
    if (canAssign) return true;
    const owner = Number(row.owner_id);
    if (!owner) return true; // 未指派的公共池，售后人员都可处理
    return Boolean(currentUser.id) && owner === currentUser.id;
  };

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(480);

  const [sellerName, setSellerName] = useState<string | undefined>();
  const [returnStatus, setReturnStatus] = useState<string | undefined>();
  const initialOrderId = typeof window !== 'undefined'
    ? String(new URLSearchParams(window.location.search).get('order_id') || '')
    : '';
  const [keyword, setKeyword] = useState(initialOrderId);
  const [dateRange, setDateRange] = useState<any>(null);
  const [waitOver, setWaitOver] = useState<number | undefined>();
  const [onlyUncommunicated, setOnlyUncommunicated] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<number | undefined>();

  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [workloadOpen, setWorkloadOpen] = useState(false);
  const [requestModal, setRequestModal] = useState<{ type: 'refund' | 'reship'; row: any; request: any } | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestEditing, setRequestEditing] = useState(false);
  const [requestForm] = Form.useForm();
  const [trackingModal, setTrackingModal] = useState<{ row: any; items: any[] } | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState<Array<{ stockSku: string; trackingNo: string }>>([]);
  const [trackingRemark, setTrackingRemark] = useState('');
  const [workOrderState, setWorkOrderState] = useState<{
    row: any;
    linked: any;
    candidates: any[];
    mode: 'view' | 'create' | 'link';
  } | null>(null);
  const [workOrderForm] = Form.useForm();
  const [linkSerial, setLinkSerial] = useState('');

  const buildQuery = useCallback(
    (overrides: Record<string, unknown> = {}) => ({
      page: overrides.page ?? page,
      pageSize: overrides.pageSize ?? pageSize,
      seller_name: sellerName,
      return_status: returnStatus,
      keyword: keyword.trim() || undefined,
      start_date: dateRange?.[0]?.format?.('YYYY-MM-DD'),
      end_date: dateRange?.[1]?.format?.('YYYY-MM-DD'),
      wait_over_hours: waitOver,
      has_communication: onlyUncommunicated ? 0 : undefined,
      owner_id: ownerFilter ?? (onlyMine && currentUser.id ? currentUser.id : undefined),
      unassigned: onlyUnassigned ? 1 : undefined,
    }),
    [
      page,
      pageSize,
      sellerName,
      returnStatus,
      keyword,
      dateRange,
      waitOver,
      onlyUncommunicated,
      onlyMine,
      onlyUnassigned,
      ownerFilter,
      currentUser.id,
    ],
  );

  const loadRows = useCallback(
    async (overrides: Record<string, unknown> = {}) => {
      setLoading(true);
      try {
        const response = await ctx.api.request({
          url: 'returnRequestWorkbench:list',
          method: 'get',
          params: buildQuery(overrides),
        });
        const { rows: list, total: count } = unwrapActionResult(response);
        setRows(list);
        setTotal(count);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    },
    [buildQuery, ctx, message],
  );

  const loadStats = useCallback(async () => {
    try {
      const response = await ctx.api.request({
        url: 'returnRequestWorkbench:stats',
        method: 'get',
        params: { ownerId: currentUser.id || undefined },
      });
      setStats(unwrapObjectAction(response) || null);
    } catch (error) {
      setStats(null);
    }
  }, [ctx, currentUser.id]);

  const loadUsers = useCallback(async () => {
    try {
      const response = await ctx.api.request({ url: 'users:list', method: 'get', params: { pageSize: 200 } });
      const data = (response as any)?.data?.data ?? (response as any)?.data ?? [];
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      setUsers([]);
    }
  }, [ctx]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) return undefined;
    const update = () => {
      // 减掉表头与分页高度，让表体正好填满剩余空间，避免底部留白
      setTableScrollY(Math.max(320, element.clientHeight - 108));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const refreshAll = async () => {
    await Promise.all([loadRows(), loadStats()]);
  };

  const triggerWorkflowRefresh = async () => {
    setSaving(true);
    try {
      await ctx.api.request({ url: 'returnRequestWorkbench:refresh', method: 'post', data: {} });
      message.success('已重算沟通与自动指派');
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const submitAssign = async () => {
    const user = users.find((item) => Number(item.id) === Number(assignUserId));
    if (!user) {
      message.warning('请选择负责人');
      return;
    }
    const ids = selectedKeys.length
      ? selectedKeys.map(Number)
      : [];
    if (!ids.length) {
      message.warning('请先勾选退货申请');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'returnRequestWorkbench:assign',
        method: 'post',
        data: {
          ids,
          owner_id: Number(user.id),
          owner_name: user.nickname || user.username || String(user.id),
          owner_account: user.username || '',
        },
      });
      message.success(`已指派 ${ids.length} 行`);
      setAssignOpen(false);
      setSelectedKeys([]);
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const markStatus = async (ids: number[], status: string) => {
    if (!ids.length) {
      message.warning('请先勾选退货申请');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'returnRequestWorkbench:status',
        method: 'post',
        data: { ids, handle_status: status },
      });
      message.success(`已标记 ${ids.length} 行为「${status}」`);
      setSelectedKeys([]);
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const openRequestModal = async (type: 'refund' | 'reship', row: any) => {
    setRequestLoading(true);
    setRequestModal({ type, row, request: null });
    try {
      const response = await ctx.api.request({
        url: type === 'refund' ? 'returnRequestWorkbench:refundGet' : 'returnRequestWorkbench:reshipGet',
        method: 'get',
        params: { id: row.id },
      });
      const payload: any = unwrapObjectAction(response) || {};
      const request = payload?.request || null;
      setRequestModal({ type, row, request });
      setRequestEditing(!request);
      if (request) {
        requestForm.setFieldsValue(
          type === 'refund'
            ? {
                refund_amount: request.refund_amount ? Number(request.refund_amount) : undefined,
                refund_currency: request.refund_currency || 'USD',
                reason: request.reason || '',
                platform_sku: request.platform_sku || row.seller_sku || '',
                stock_sku: request.stock_sku || row.local_sku || '',
                sub_order_id: request.sub_order_id || '',
                tracking_number: request.tracking_number || row.tracking_id || '',
                store_name: row.seller_name || '',
              }
            : {
                reship_type: request.reship_type || '新箱',
                reship_item_sku: request.reship_item_sku || '',
                reship_item_name: request.reship_item_name || '',
                quantity: request.quantity ? Number(request.quantity) : 1,
                reason: request.reason || '',
                platform_sku: request.platform_sku || row.seller_sku || '',
                stock_sku: request.stock_sku || row.local_sku || '',
                sub_order_id: request.sub_order_id || '',
                tracking_number: request.tracking_number || row.tracking_id || '',
                store_name: row.seller_name || '',
              },
        );
      } else {
        requestForm.setFieldsValue(
          type === 'refund'
            ? {
                refund_amount: row.order_amount ? Number(row.order_amount) : undefined,
                refund_currency: row.currency_code || 'USD',
                reason: '',
                platform_sku: row.seller_sku || '',
                stock_sku: row.local_sku || '',
                sub_order_id: '',
                tracking_number: row.tracking_id || '',
                store_name: row.seller_name || '',
              }
            : {
                reship_type: '新箱',
                reship_item_sku: row.seller_sku || '',
                reship_item_name: '',
                quantity: 1,
                reason: '',
                platform_sku: row.seller_sku || '',
                stock_sku: row.local_sku || '',
                sub_order_id: '',
                tracking_number: row.tracking_id || '',
                store_name: row.seller_name || '',
              },
        );
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRequestLoading(false);
    }
  };

  const saveRequest = async () => {
    if (!requestModal) return;
    const values = await requestForm.validateFields();
    setSaving(true);
    try {
      await ctx.api.request({
        url: requestModal.type === 'refund' ? 'returnRequestWorkbench:refundSave' : 'returnRequestWorkbench:reshipSave',
        method: 'post',
        data: { id: requestModal.row.id, ...values },
      });
      message.success(requestModal.type === 'refund' ? '退款申请已保存' : '补寄申请已保存');
      setRequestModal(null);
      await loadRows();
      await loadStats();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const openTrackingModal = (row: any) => {
    setTrackingModal({ row, items: [] });
    setTrackingDraft([{ stockSku: row.local_sku || '', trackingNo: '' }]);
    setTrackingRemark('');
  };

  const submitTracking = async () => {
    if (!trackingModal) return;
    const items = trackingDraft
      .map(item => ({ stockSku: item.stockSku.trim(), trackingNo: item.trackingNo.replace(/\s/g, '').toUpperCase() }))
      .filter(item => item.trackingNo);
    if (!items.length) {
      message.warning('请至少填写一行退货快递单号');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'returnRequestWorkbench:trackingAdd',
        method: 'post',
        data: { id: trackingModal.row.id, items, remark: trackingRemark.trim() || undefined },
      });
      message.success(`已发起退货快递跟踪（${items.length} 行）`);
      setTrackingModal(null);
      setTrackingDraft([]);
      await loadRows();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const refreshTrackingStatuses = async () => {
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'returnRequestWorkbench:trackingRefresh',
        method: 'post',
        data: { limit: 20 },
      });
      message.success('已刷新快递状态');
      if (trackingModal) {
        const response = await ctx.api.request({
          url: 'returnRequestWorkbench:trackingGet',
          method: 'get',
          params: { id: trackingModal.row.id },
        });
        const payload: any = unwrapObjectAction(response) || {};
        setTrackingModal({ row: trackingModal.row, items: payload?.tracking || [] });
      }
      await loadRows();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const openWorkOrderModal = async (row: any) => {
    setTrackingLoading(true);
    try {
      const response = await ctx.api.request({
        url: 'returnRequestWorkbench:workOrderGet',
        method: 'get',
        params: { id: row.id },
      });
      const payload: any = unwrapObjectAction(response) || {};
      const linked = payload?.linked || null;
      setWorkOrderState({
        row,
        linked,
        candidates: payload?.candidates || [],
        mode: linked ? 'view' : 'create',
      });
      setLinkSerial(linked?.work_order_serial || '');
      workOrderForm.setFieldsValue({
        buyer_issue_type: '退货申请',
        reply_greeting: 'Hello',
        reply_preference: '',
        additional_context: '',
        tone_and_language: '',
        email_length: '',
        case_template_path: '',
      });
      // 邮件抬头默认取当前登录人的个人配置
      const uid = (ctx as any)?.user?.id || currentUser.id;
      if (uid) {
        try {
          const userResp = await ctx.api.request({ url: `users:get?filterByTk=${uid}`, method: 'get' });
          const profile: any = (userResp as any)?.data?.data ?? (userResp as any)?.data ?? {};
          const greeting = profile?.replyGreeting || profile?.reply_greeting;
          if (greeting) workOrderForm.setFieldsValue({ reply_greeting: String(greeting) });
        } catch {
          // 保留兜底
        }
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTrackingLoading(false);
    }
  };

  const submitWorkOrderCreate = async () => {
    if (!workOrderState) return;
    const values = await workOrderForm.validateFields();
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'returnRequestWorkbench:workOrderCreate',
        method: 'post',
        data: { id: workOrderState.row.id, ...values },
      });
      message.success('工单已创建');
      await loadRows();
      await openWorkOrderModal(workOrderState.row);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const submitWorkOrderLink = async () => {
    if (!workOrderState || !linkSerial.trim()) {
      message.warning('请填写要关联的工单号');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'returnRequestWorkbench:workOrderLink',
        method: 'post',
        data: { id: workOrderState.row.id, work_order_serial: linkSerial.trim() },
      });
      message.success('工单已关联');
      await loadRows();
      await openWorkOrderModal(workOrderState.row);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const exportCurrent = async () => {
    setSaving(true);
    try {
      const response = await ctx.api.request({
        url: 'returnRequestWorkbench:list',
        method: 'get',
        params: { ...buildQuery({ page: 1, pageSize: 5000 }), export: 1 },
      });
      const { rows: list } = unwrapActionResult(response);
      const headers = [
        '平台订单号', '商品名称', 'ASIN', 'MSKU', '库存SKU', '退货数量', '退货状态',
        '退货日期', '退货原因', '最新沟通', '等待时长(小时)', '是否已有沟通',
        '处理状态', '负责人', '退货快递状态', '工单号', '退款申请状态', '补寄申请状态',
      ];
      const lines = [headers.join(',')];
      for (const row of list) {
        const values = [
          row.order_id, row.item_name, row.asin, row.seller_sku, row.local_sku,
          row.return_quantity, row.return_status, row.return_date, row.return_reason,
          row.latest_comm_direction, row.wait_hours, Number(row.has_communication) === 1 ? '是' : '否',
          row.handle_status, row.owner_name, row.return_tracking_status,
          row.work_order_serial, row.refund_request_status, row.reship_request_status,
        ];
        lines.push(values.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `退货处理及跟踪_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${list.length} 行`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const resetFilters = () => {
    setSellerName(undefined);
    setReturnStatus(undefined);
    setKeyword('');
    setDateRange(null);
    setWaitOver(undefined);
    setOnlyUncommunicated(false);
    setOnlyMine(false);
    setOnlyUnassigned(false);
    setOwnerFilter(undefined);
    setPage(1);
  };

  const columns = [
    { title: '平台订单编号', dataIndex: 'order_id', width: 170, fixed: 'left' as const },
    { title: '平台 SKU', dataIndex: 'seller_sku', width: 150 },
    { title: 'ASIN', dataIndex: 'asin', width: 120 },
    { title: '店铺名称', dataIndex: 'seller_name', width: 140 },
    { title: '退货数量', dataIndex: 'return_quantity', width: 90 },
    {
      title: '退货状态',
      dataIndex: 'return_status',
      width: 120,
      render: (value: string) => <Tag color={value === 'Approved' ? 'green' : 'orange'}>{value || '-'}</Tag>,
    },
    { title: '退货请求日期', dataIndex: 'return_date', width: 120 },
    {
      title: '最新沟通',
      dataIndex: 'latest_comm_direction',
      width: 120,
      render: (value: string) =>
        value ? <Tag color={COMM_COLOR[value] || 'default'}>{value}</Tag> : <Tag>-</Tag>,
    },
    {
      title: '等待时长',
      dataIndex: 'wait_hours',
      width: 120,
      sorter: (a: any, b: any) => Number(a.wait_hours || 0) - Number(b.wait_hours || 0),
      render: (value: unknown) => formatWait(value),
    },
    {
      title: '是否已有沟通',
      dataIndex: 'has_communication',
      width: 120,
      render: (value: number) =>
        Number(value) === 1 ? <Tag color="blue">已沟通</Tag> : <Tag>未沟通</Tag>,
    },
    {
      title: '处理状态',
      dataIndex: 'handle_status',
      width: 120,
      render: (value: string) => <Tag color={STATUS_COLOR[value] || 'default'}>{value || '待处理'}</Tag>,
    },
    {
      title: '负责人',
      dataIndex: 'owner_name',
      width: 110,
      render: (value: string) => value || <Typography.Text type="secondary">待指派</Typography.Text>,
    },
    {
      title: '工单号',
      dataIndex: 'work_order_serial',
      width: 120,
      render: (value: string) => (value ? <Tag color="geekblue">{value}</Tag> : <Typography.Text type="secondary">未创建</Typography.Text>),
    },
    {
      title: '退货快递',
      dataIndex: 'return_tracking_status',
      width: 120,
      render: (value: string, row: any) =>
        row.return_tracking_no ? (
          <Tag color={value === '已交付' ? 'green' : value === '异常' ? 'red' : value === '运输中' ? 'blue' : 'default'}>
            {value || '待查询'}
          </Tag>
        ) : (
          <Typography.Text type="secondary">未创建</Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 330,
      fixed: 'right' as const,
      render: (_: unknown, row: any) => (
        <Space direction="vertical" size={2}>
          <Space size={4} wrap>
            <Button
              size="small"
              type="link"
              disabled={!canAssign}
              title={canAssign ? undefined : '只有售后主管/值班可以指派'}
              onClick={() => {
                setSelectedKeys([row.id]);
                setAssignOpen(true);
              }}
            >
              指派
            </Button>
            <Button
              size="small"
              type="link"
              disabled={!canOperateRow(row)}
              onClick={() => void openWorkOrderModal(row)}
            >
              创建或关联工单
            </Button>
            <Button
              size="small"
              type="link"
              disabled={!canOperateRow(row)}
              onClick={() => void openTrackingModal(row)}
            >
              发起退货快递跟踪
            </Button>
          </Space>
          <Space size={4} wrap>
            <Dropdown
              disabled={!canOperateRow(row)}
              menu={{
                items: HANDLE_STATUS.map((status) => ({ key: status, label: status })),
                onClick: ({ key }) => void markStatus([Number(row.id)], key),
              }}
            >
              <Button size="small" type="link" disabled={!canOperateRow(row)}>
                状态
              </Button>
            </Dropdown>
            {row.refund_request_id ? (
              <>
                <Tag color="blue">{row.refund_request_status || '待审核'}</Tag>
                <Button
                  size="small"
                  type="link"
                  disabled={!canOperateRow(row)}
                  onClick={() => void openRequestModal('refund', row)}
                >
                  查看退款申请
                </Button>
              </>
            ) : (
              <Button
                size="small"
                type="link"
                disabled={!canOperateRow(row)}
                onClick={() => void openRequestModal('refund', row)}
              >
                创建退款申请
              </Button>
            )}
            {row.reship_request_id ? (
              <>
                <Tag color="blue">{row.reship_request_status || '待审核'}</Tag>
                <Button
                  size="small"
                  type="link"
                  disabled={!canOperateRow(row)}
                  onClick={() => void openRequestModal('reship', row)}
                >
                  查看补寄申请
                </Button>
              </>
            ) : (
              <Button
                size="small"
                type="link"
                disabled={!canOperateRow(row)}
                onClick={() => void openRequestModal('reship', row)}
              >
                创建补寄申请
              </Button>
            )}
          </Space>
        </Space>
      ),
    },
  ];

  const ownerOptions = useMemo(() => {
    const map = new Map<string, { ownerId: number; ownerName: string }>();
    for (const item of [...(stats?.todayAssign || []), ...(stats?.workload || [])]) {
      const id = Number(item.owner_id);
      if (!id) continue;
      if (!map.has(String(id))) {
        map.set(String(id), { ownerId: id, ownerName: String(item.owner_name || id) });
      }
    }
    return [...map.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  }, [stats]);

  const workloadRows = useMemo(() => {
    const map = new Map<string, { owner_id: number; owner_name: string; today: number; open: number; total: number }>();
    const ensure = (id: number, name: string) => {
      const key = String(id);
      if (!map.has(key)) map.set(key, { owner_id: id, owner_name: name, today: 0, open: 0, total: 0 });
      return map.get(key)!;
    };
    for (const item of stats?.todayAssign || []) {
      const id = Number(item.owner_id);
      if (!id) continue;
      ensure(id, String(item.owner_name || id)).today += Number(item.n || 0);
    }
    for (const item of stats?.workload || []) {
      const id = Number(item.owner_id);
      if (!id) continue;
      const row = ensure(id, String(item.owner_name || id));
      row.open += Number(item.open_count || 0);
      row.total += Number(item.total_count || 0);
    }
    return [...map.values()].sort((a, b) => b.open - a.open);
  }, [stats]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, padding: 20, boxSizing: 'border-box' }}>
      <Space align="center" wrap>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          退货处理及跟踪
        </Typography.Title>
        <Tag color="blue">我的待办 {stats?.myTodo ?? '-'}</Tag>
        <Button icon={<TeamOutlined />} onClick={() => setWorkloadOpen(true)}>
          今日分派
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()} loading={loading}>
          刷新
        </Button>
        <Tooltip title="重算最新沟通/等待时长/自动指派（连接器）">
          <Button onClick={() => void triggerWorkflowRefresh()} loading={saving}>
            重算沟通
          </Button>
        </Tooltip>
        <Button onClick={() => void refreshTrackingStatuses()} loading={saving}>
          刷新快递状态
        </Button>
        <Button onClick={() => void exportCurrent()} loading={saving}>
          导出当前筛选
        </Button>
        <Typography.Text type="secondary">{ROUTE}</Typography.Text>
      </Space>

      <Card size="small">
        <Row gutter={[12, 12]}>
          <Col span={3}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="店铺"
              options={STORES.map((value) => ({ label: value, value }))}
              value={sellerName}
              onChange={(value) => {
                setSellerName(value);
                setPage(1);
              }}
            />
          </Col>
          <Col span={3}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="退货状态"
              options={RETURN_STATUS.map((value) => ({ label: value, value }))}
              value={returnStatus}
              onChange={(value) => {
                setReturnStatus(value);
                setPage(1);
              }}
            />
          </Col>
          <Col span={3}>
            <Select
              allowClear
              showSearch
              style={{ width: '100%' }}
              placeholder="负责人"
              value={ownerFilter}
              optionFilterProp="label"
              options={[
                { label: '我的待办', value: currentUser.id || -1 },
                ...ownerOptions.map((item) => ({ label: item.ownerName, value: item.ownerId })),
              ].filter((item) => item.value > 0)}
              onChange={(value) => {
                setOwnerFilter(value ?? undefined);
                setPage(1);
              }}
            />
          </Col>
          <Col span={5}>
            <Input
              allowClear
              placeholder="订单编号 / ASIN / 平台 SKU"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => {
                setPage(1);
                void loadRows({ page: 1 });
              }}
            />
          </Col>
          <Col span={6}>
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              value={dateRange}
              placeholder={['退货请求日期（起）', '退货请求日期（止）']}
              presets={[
                { label: '近 7 天', value: [dayjs().subtract(7, 'day'), dayjs()] },
                { label: '近 30 天', value: [dayjs().subtract(30, 'day'), dayjs()] },
                { label: '近 60 天', value: [dayjs().subtract(60, 'day'), dayjs()] },
                { label: '近 90 天', value: [dayjs().subtract(90, 'day'), dayjs()] },
              ]}
              onChange={(value) => {
                setDateRange(value);
                setPage(1);
              }}
            />
          </Col>
          <Col span={3}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="等待时长"
              options={WAIT_OPTIONS}
              value={waitOver}
              onChange={(value) => {
                setWaitOver(value);
                setPage(1);
              }}
            />
          </Col>
          <Col span={24}>
            <Space wrap size={16}>
              <Space>
                <Switch
                  checked={onlyUncommunicated}
                  onChange={(checked) => {
                    setOnlyUncommunicated(checked);
                    setPage(1);
                  }}
                />
                <Typography.Text>仅显示未沟通</Typography.Text>
              </Space>
              <Space>
                <Switch
                  checked={onlyMine}
                  onChange={(checked) => {
                    setOnlyMine(checked);
                    setPage(1);
                  }}
                />
                <Typography.Text>只看我的待办</Typography.Text>
              </Space>
              <Space>
                <Switch
                  checked={onlyUnassigned}
                  onChange={(checked) => {
                    setOnlyUnassigned(checked);
                    setPage(1);
                  }}
                />
                <Typography.Text>只看未指派</Typography.Text>
              </Space>
              <Button type="primary" onClick={() => void loadRows()}>
                查询
              </Button>
              <Button onClick={resetFilters}>重置</Button>
              <Button icon={<UserSwitchOutlined />} onClick={() => setAssignOpen(true)} disabled={!canAssign || !selectedKeys.length}>
                批量指派（{selectedKeys.length}）
              </Button>
              {HANDLE_STATUS.map((status) => (
                <Button
                  key={status}
                  disabled={!selectedKeys.length || !rows.filter((row) => selectedKeys.includes(row.id)).every(canOperateRow)}
                  onClick={() => void markStatus(selectedKeys.map(Number), status)}
                >
                  标记{status}
                </Button>
              ))}
            </Space>
          </Col>
        </Row>
      </Card>

      <div ref={tableWrapRef} style={{ flex: 1, minHeight: 0 }}>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns as any}
        dataSource={rows}
        scroll={{ x: 'max-content', y: tableScrollY }}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
            void loadRows({ page: nextPage, pageSize: nextSize });
          },
        }}
      />
      </div>

      <Modal
        title="指派负责人"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={() => void submitAssign()}
        confirmLoading={saving}
        okText="确定指派"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            将 {selectedKeys.length} 行指派给（同时写入售后责任人表，供每日售后订单继承）：
          </Typography.Text>
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder="选择售后人员"
            value={assignUserId ?? undefined}
            onChange={(value) => setAssignUserId(Number(value))}
            options={users.map((user) => ({
              label: user.nickname || user.username || String(user.id),
              value: user.id,
            }))}
            filterOption={(input, option) =>
              String(option?.label || '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Space>
      </Modal>

      <Modal
        title={
          requestModal
            ? `${requestEditing ? (requestModal.request ? '编辑' : '创建') : '查看'}${requestModal.type === 'refund' ? '退款申请（折扣保留）' : '补寄申请（补寄保留）'}`
            : ''
        }
        open={Boolean(requestModal)}
        onCancel={() => setRequestModal(null)}
        confirmLoading={saving}
        footer={
          requestModal && !requestEditing && requestModal.request
            ? [
                <Button key="close" onClick={() => setRequestModal(null)}>关闭</Button>,
                requestModal.request.request_status === '待审核' ? (
                  <Button key="edit" type="primary" onClick={() => setRequestEditing(true)}>编辑</Button>
                ) : null,
              ]
            : [
                <Button key="cancel" onClick={() => setRequestModal(null)}>取消</Button>,
                <Button key="save" type="primary" loading={saving} onClick={() => void saveRequest()}>
                  {requestModal?.request ? '保存修改' : '确认创建'}
                </Button>,
              ]
        }
        width={620}
        destroyOnClose
      >
        <Typography.Text type="secondary">
          {requestModal?.type === 'refund'
            ? '创建后写入退款申请表，状态会回写到当前退货申请行。'
            : '创建后写入补寄申请表，状态会回写到当前退货申请行。'}
        </Typography.Text>
        {requestLoading ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : requestModal && !requestEditing && requestModal.request ? (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="状态">{requestModal.request.request_status || '-'}</Descriptions.Item>
            <Descriptions.Item label="平台订单号">{requestModal.request.platform_order_id || '-'}</Descriptions.Item>
            {requestModal.type === 'refund' ? (
              <>
                <Descriptions.Item label="退款金额">
                  {requestModal.request.refund_amount ?? '-'} {requestModal.request.refund_currency || ''}
                </Descriptions.Item>
                <Descriptions.Item label="库存 SKU">{requestModal.request.stock_sku || '-'}</Descriptions.Item>
              </>
            ) : (
              <>
                <Descriptions.Item label="补寄类型">{requestModal.request.reship_type || '-'}</Descriptions.Item>
                <Descriptions.Item label="补寄 SKU">{requestModal.request.reship_item_sku || '-'}</Descriptions.Item>
                <Descriptions.Item label="数量">{requestModal.request.quantity ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="库存 SKU">{requestModal.request.stock_sku || '-'}</Descriptions.Item>
              </>
            )}
            <Descriptions.Item label="平台 SKU" span={2}>{requestModal.request.platform_sku || '-'}</Descriptions.Item>
            <Descriptions.Item label="原因" span={2}>{requestModal.request.reason || '-'}</Descriptions.Item>
            <Descriptions.Item label="申请单号" span={2}>#{requestModal.request.id}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Form form={requestForm} layout="vertical">
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="平台订单编号">
                  <Input value={requestModal?.row?.order_id || ''} disabled />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="sub_order_id" label="子订单编号">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="platform_sku" label="平台 SKU">
                  <Input disabled />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="stock_sku" label="库存 SKU">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="tracking_number" label="运单号">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="store_name" label="店铺">
                  <Input value={requestModal?.row?.seller_name || ''} disabled />
                </Form.Item>
              </Col>
            </Row>
            {requestModal?.type === 'refund' ? (
              <>
                <Form.Item name="refund_amount" label="退款金额" rules={[{ required: true, message: '请填写退款金额' }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
                </Form.Item>
                <Form.Item name="refund_currency" label="币种" rules={[{ required: true }]}>
                  <Select options={['USD', 'CNY', 'EUR', 'GBP'].map((value) => ({ label: value, value }))} />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item name="reship_type" label="补寄类型" rules={[{ required: true }]}>
                  <Select options={['新箱', '部件'].map((value) => ({ label: value, value }))} />
                </Form.Item>
                <Form.Item name="reship_item_sku" label="补寄物品 SKU" rules={[{ required: true, message: '请填写补寄物品 SKU' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="reship_item_name" label="补寄物品名称">
                  <Input />
                </Form.Item>
                <Form.Item name="quantity" label="数量" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={1} step={1} />
                </Form.Item>
              </>
            )}
            <Form.Item name="reason" label="原因">
              <Input.TextArea rows={3} />
            </Form.Item>
            {requestModal?.type === 'refund' ? (
              <Form.Item name="refund_photos" label="问题图片（最多 3 张）">
                <AttachmentField ctx={ctx} label="问题图片" maxCount={3} />
              </Form.Item>
            ) : (
              <Form.Item name="buyer_photos" label="问题图片（最多 5 张）">
                <AttachmentField ctx={ctx} label="问题图片" maxCount={5} />
              </Form.Item>
            )}
          </Form>
        )}
      </Modal>

      <Modal
        title="创建或关联工单"
        open={Boolean(workOrderState)}
        onCancel={() => setWorkOrderState(null)}
        footer={null}
        width={700}
      >
        {!workOrderState ? null : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              关联已有工单只做绑定；创建工单会写入「售后工单工作台」并回填工单号。
            </Typography.Text>
            <Space size={24} wrap>
              <Typography.Text type="secondary">平台订单编号：{workOrderState.row.order_id}</Typography.Text>
              <Typography.Text type="secondary">退货请求日期：{workOrderState.row.return_date || '-'}</Typography.Text>
              <Typography.Text type="secondary">当前登录人：{currentUser.name || '-'}</Typography.Text>
            </Space>

            {workOrderState.mode === 'view' && workOrderState.linked ? (
              <>
                <Descriptions column={2} size="small" bordered>
                  <Descriptions.Item label="工单号">{workOrderState.linked.work_order_serial || '-'}</Descriptions.Item>
                  <Descriptions.Item label="创建方式">{workOrderState.linked.creation_source || '-'}</Descriptions.Item>
                  <Descriptions.Item label="平台订单编号">{workOrderState.linked.order_id || '-'}</Descriptions.Item>
                  <Descriptions.Item label="问题类型">{workOrderState.linked.buyer_issue_type || '-'}</Descriptions.Item>
                  <Descriptions.Item label="负责人">{workOrderState.linked.owner_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{workOrderState.linked.created_at || '-'}</Descriptions.Item>
                  <Descriptions.Item label="指南" span={2}>{workOrderState.linked.guide_serial || '未生成'}</Descriptions.Item>
                </Descriptions>
                <Space>
                  <Button onClick={() => setWorkOrderState(null)}>关闭</Button>
                  <Button onClick={() => setWorkOrderState({ ...workOrderState, mode: 'link' })}>关联其他工单</Button>
                </Space>
              </>
            ) : (
              <>
                <Space>
                  <Button
                    type={workOrderState.mode === 'link' ? 'primary' : 'default'}
                    onClick={() => setWorkOrderState({ ...workOrderState, mode: 'link' })}
                  >
                    关联工单
                  </Button>
                  <Button
                    type={workOrderState.mode === 'create' ? 'primary' : 'default'}
                    onClick={() => setWorkOrderState({ ...workOrderState, mode: 'create' })}
                  >
                    创建工单
                  </Button>
                </Space>

                {workOrderState.mode === 'link' ? (
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Typography.Text type="secondary">
                      填入「售后工单工作台」已有的工单号，只绑定，不新建工单。
                    </Typography.Text>
                    <Input
                      value={linkSerial}
                      onChange={(event) => setLinkSerial(event.target.value)}
                      placeholder="请输入 AfterSalesWorkOrderV2 工单号"
                    />
                    {workOrderState.candidates?.length ? (
                      <Select
                        style={{ width: '100%' }}
                        placeholder="或从该订单已有工单中选择"
                        value={undefined}
                        onChange={(value) => setLinkSerial(String(value))}
                        options={workOrderState.candidates.map((item) => ({
                          label: `${item.work_order_serial}（${item.buyer_issue_type || '-'}）`,
                          value: item.work_order_serial,
                        }))}
                      />
                    ) : null}
                    <Space>
                      <Button onClick={() => setWorkOrderState(null)}>取消</Button>
                      <Button type="primary" loading={saving} onClick={() => void submitWorkOrderLink()}>
                        保存关联
                      </Button>
                    </Space>
                  </Space>
                ) : (
                  <Form form={workOrderForm} layout="vertical">
                    <Form.Item name="reply_greeting" label="邮件抬头" rules={[{ required: true }]}>
                      <Select
                        showSearch
                        options={['Hi', 'Hello', 'Dear Buyer', 'Dear Customer', 'Hi Customer', 'Hi Buyer', 'Hello Customer', 'Hello Buyer']
                          .map((value) => ({ label: value, value }))}
                      />
                    </Form.Item>
                    <Form.Item name="buyer_issue_type" label="买家问题类型">
                      <Input placeholder="默认：退货申请" />
                    </Form.Item>
                    <Form.Item name="additional_context" label="相关信息补充">
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Form.Item name="tone_and_language" label="语气和语言要求">
                      <Input />
                    </Form.Item>
                    <Form.Item name="reply_preference" label="回复倾向">
                      <Input placeholder="例如：优先补寄 / 优先退款" />
                    </Form.Item>
                    <Form.Item name="email_length" label="邮件篇幅">
                      <Input />
                    </Form.Item>
                    <Form.Item name="case_template_path" label="标准参考案例模板路径">
                      <Input />
                    </Form.Item>
                    <Space>
                      <Button onClick={() => setWorkOrderState(null)}>取消</Button>
                      <Button type="primary" loading={saving} onClick={() => void submitWorkOrderCreate()}>
                        创建工单
                      </Button>
                    </Space>
                  </Form>
                )}
              </>
            )}
          </Space>
        )}
      </Modal>

      <Modal
        title="发起退货快递跟踪"
        open={Boolean(trackingModal)}
        onCancel={() => setTrackingModal(null)}
        footer={[
          <Button key="close" onClick={() => setTrackingModal(null)}>取消</Button>,
          <Button key="save" type="primary" loading={saving} onClick={() => void submitTracking()}>
            发起退货快递跟踪
          </Button>,
        ]}
        width={760}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">
            填写退货清单后提交，记录会进入「退货快递跟踪」页面，并按承运商自动查询物流状态。
          </Typography.Text>
          {trackingModal ? (
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="平台订单编号">{trackingModal.row.order_id || '-'}</Descriptions.Item>
              <Descriptions.Item label="平台 SKU">{trackingModal.row.seller_sku || '-'}</Descriptions.Item>
              <Descriptions.Item label="退货请求日期" span={2}>{trackingModal.row.return_date || '-'}</Descriptions.Item>
            </Descriptions>
          ) : null}
          <Card size="small" title="退货清单">
            {trackingDraft.map((item, index) => (
              <Row gutter={8} key={`tracking-row-${index}`} style={{ marginBottom: 8 }}>
                <Col span={8}>
                  <Input
                    placeholder="库存 SKU"
                    value={item.stockSku}
                    onChange={(event) =>
                      setTrackingDraft((rows) =>
                        rows.map((row, i) => (i === index ? { ...row, stockSku: event.target.value } : row)),
                      )
                    }
                  />
                </Col>
                <Col span={12}>
                  <Input
                    placeholder="退货快递单号"
                    value={item.trackingNo}
                    onChange={(event) =>
                      setTrackingDraft((rows) =>
                        rows.map((row, i) => (i === index ? { ...row, trackingNo: event.target.value } : row)),
                      )
                    }
                  />
                </Col>
                <Col span={4}>
                  <Button
                    danger
                    type="text"
                    disabled={trackingDraft.length <= 1}
                    onClick={() => setTrackingDraft((rows) => rows.filter((_, i) => i !== index))}
                  >
                    删除
                  </Button>
                </Col>
              </Row>
            ))}
            <Space>
              <Button
                onClick={() =>
                  setTrackingDraft((rows) => [
                    ...rows,
                    { stockSku: trackingModal?.row?.local_sku || '', trackingNo: '' },
                  ])
                }
              >
                + 添加一行
              </Button>
            </Space>
          </Card>
          <Card size="small" title="备注">
            <Input.TextArea
              rows={3}
              value={trackingRemark}
              onChange={(event) => setTrackingRemark(event.target.value)}
              placeholder="人工填写说明，例如：分 3 箱退回、已与客户确认等（可选）"
            />
          </Card>
        </Space>
      </Modal>

      <Drawer
        title="今日分派与工作量"
        open={workloadOpen}
        width={760}
        onClose={() => setWorkloadOpen(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Row gutter={16}>
            <Col span={8}>
              <Statistic title="我的待办" value={Number(stats?.myTodo) || 0} suffix="条" />
            </Col>
            <Col span={8}>
              <Statistic
                title="今日分派"
                value={(stats?.todayAssign || []).reduce((sum: number, item: any) => sum + Number(item.n || 0), 0)}
                suffix="条"
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="未完结总量"
                value={(stats?.workload || []).reduce((sum: number, item: any) => sum + Number(item.open_count || 0), 0)}
                suffix="条"
              />
            </Col>
          </Row>
          <Card size="small" title="按人分派与工作量（点击负责人可筛选列表）">
            <Table
              size="small"
              rowKey="owner_id"
              pagination={false}
              dataSource={workloadRows}
              onRow={(record) => ({
                onClick: () => {
                  setOwnerFilter(record.owner_id);
                  setPage(1);
                  setWorkloadOpen(false);
                },
                style: { cursor: 'pointer' },
              })}
              columns={[
                { title: '负责人', dataIndex: 'owner_name', render: (value: string) => value || '未指派' },
                { title: '今日分派', dataIndex: 'today' },
                { title: '未完结', dataIndex: 'open' },
                { title: '总计', dataIndex: 'total' },
              ]}
              locale={{ emptyText: <Empty description="暂无分派数据" /> }}
            />
          </Card>
        </Space>
      </Drawer>
    </div>
  );
}
