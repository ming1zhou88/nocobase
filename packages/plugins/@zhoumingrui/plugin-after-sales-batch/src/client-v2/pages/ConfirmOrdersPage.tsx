import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

/**
 * 确认订单工作台
 *
 * 数据表：外部 MySQL `OrderInfoToConfirm`（7E4 的“任务化附表”，原表不动）
 * 接口：orderConfirm:list / assign / updateTask / importRows（见 server/actions-order-confirm.ts）
 *
 * 页面能力：
 *  - 筛：平台订单编号、子订单编号、下单时间、导入时间、处理状态、处理标记、负责人；
 *  - 派：值班人员/售后主管把任务指派给具体的人（单个/批量）；
 *  - 跟：处理状态（未处理/待跟踪/已处理）+ 6 种处理标记 + 备注；
 *  - 导：每天上传 Excel（按子订单号幂等 upsert，不覆盖指派与处理结果）。
 */

const HANDLE_STATUS_OPTIONS = ['未处理', '待跟踪', '已处理'];
const HANDLE_MARK_OPTIONS = [
  '已发手工咨询',
  '顾客已确认原样发货',
  '顾客已确认修改发货',
  '确认未果原样发货',
  '确认未果修改发货',
  '取消订单',
];

const STATUS_COLOR: Record<string, string> = {
  未处理: 'orange',
  待跟踪: 'blue',
  已处理: 'green',
};

/** Excel 表头 → 字段名（做过去空格/下划线/连字符/括号的宽容匹配） */
const HEADER_ALIASES: Record<string, string[]> = {
  biz_key: ['业务键', 'bizkey'],
  platform_order_id: [
    '平台订单编号',
    '平台订单号',
    '订单编号',
    '主订单号',
    '平台单号',
    '销售单号',
    'orderid',
    'platformorderid',
    'salesrecordnumber',
  ],
  platform_sub_order_id: [
    '子订单编号',
    '子订单号',
    '子单号',
    '马帮子订单号',
    'platformorderid',
    'orderitemorderitemid',
  ],
  origin_order_id: ['原始平台订单号', '原始订单号', '订单原始号', 'orderitemoriginorderid'],
  shop_name: ['店铺', '店铺名称', '站点', 'storename', 'shopname'],
  order_status: ['平台订单状态', '订单状态', 'orderstatus'],
  sub_order_status: ['子订单状态', 'suborderstatus'],
  purchase_date: ['下单时间', '下单日期', '购买时间', '订单时间', 'purchasedate', 'ordertime'],
  payments_date: ['付款时间', '支付时间', 'paymentsdate'],
  buyer_email: ['买家邮箱', '买家邮箱地址', '邮箱', 'buyeremail', 'email', 'buyeremailaddress'],
  buyer_phone: ['买家电话', '联系电话', '电话', 'buyerphonenumber', 'phone'],
  recipient_name: ['收件人', '收件人名称', '收货人', 'recipientname'],
  ship_address_1: ['收件地址1', '地址1', '地址一', '详细地址', 'shipaddress1'],
  ship_address_2: ['收件地址2', '地址2', '地址二', 'shipaddress2'],
  ship_city: ['收件城市', '城市', 'shipcity', 'city'],
  ship_state: ['收件州省', '州省', '省份', '收件州', 'shipstate', 'state'],
  ship_postal_code: ['邮编', '邮政编码', 'shippostalcode', 'postalcode', 'zip'],
  sku: ['sku', 'msku', '商品sku', '卖家sku'],
  quantity_purchased: ['数量', '购买数量', 'qty', 'quantitypurchased'],
  item_price: ['商品金额', '金额', '单价', '价格', 'itemprice'],
  category: ['品类', '类目', 'category'],
  wicker_color: ['藤条颜色', 'wickercolor'],
  cushion_color: ['坐垫颜色', 'cushioncolor'],
  priority_of_shipment: ['发货优先级', '优先级', 'priorityofshipment'],
  order_remark: ['订单备注', '备注', 'note', 'remark', 'orderremark'],
};

const TEMPLATE_COLUMNS = [
  ['平台订单编号', 'platform_order_id'],
  ['子订单编号', 'platform_sub_order_id'],
  ['店铺', 'shop_name'],
  ['平台订单状态', 'order_status'],
  ['子订单状态', 'sub_order_status'],
  ['下单时间', 'purchase_date'],
  ['付款时间', 'payments_date'],
  ['买家邮箱', 'buyer_email'],
  ['买家电话', 'buyer_phone'],
  ['收件人', 'recipient_name'],
  ['收件地址1', 'ship_address_1'],
  ['收件地址2', 'ship_address_2'],
  ['收件城市', 'ship_city'],
  ['收件州省', 'ship_state'],
  ['邮编', 'ship_postal_code'],
  ['SKU', 'sku'],
  ['数量', 'quantity_purchased'],
  ['商品金额', 'item_price'],
  ['品类', 'category'],
  ['藤条颜色', 'wicker_color'],
  ['坐垫颜色', 'cushion_color'],
  ['发货优先级', 'priority_of_shipment'],
  ['订单备注', 'order_remark'],
];

const IMPORT_FIELDS = new Set([
  'platform_order_id',
  'platform_sub_order_id',
  'origin_order_id',
  'shop_name',
  'order_status',
  'sub_order_status',
  'purchase_date',
  'payments_date',
  'buyer_email',
  'buyer_phone',
  'recipient_name',
  'ship_address_1',
  'ship_address_2',
  'ship_city',
  'ship_state',
  'ship_postal_code',
  'sku',
  'quantity_purchased',
  'item_price',
  'category',
  'wicker_color',
  'cushion_color',
  'priority_of_shipment',
  'order_remark',
]);

/** 已知但不需要导入的任务字段：出现在表头里时静默忽略，不提示“未识别” */
const IGNORED_HEADERS = new Set([
  '处理标记',
  '处理状态',
  '负责人',
  '指派状态',
  '指派时间',
  '指派人',
  '处理备注',
  '处理时间',
  '处理人',
  '导入批次',
  '导入时间',
  '最近导入时间',
  '创建时间',
  '更新时间',
  '业务键',
]);

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-（）()：:]/g, '');
}

const FIELD_BY_ALIAS = (() => {
  const map: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    map[normalizeHeader(field)] = field;
    for (const alias of aliases) map[normalizeHeader(alias)] = field;
  }
  return map;
})();

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function excelSerialToDateTime(value: number) {
  try {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${pad(date.m)}-${pad(date.d)} ${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
  } catch {
    return null;
  }
}

/** 把单元格值转成接口能接受的日期字符串 */
function toDateTimeCell(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
  if (typeof value === 'number') return excelSerialToDateTime(value);
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToDateTime(Number(text));
  const parsed = dayjs(text.replace(/\//g, '-'));
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : null;
}

function displayDate(value: unknown) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

type OrderRow = Record<string, any>;

export default function ConfirmOrdersPage() {
  const ctx = useFlowContext();
  const { message, modal } = App.useApp();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<OrderRow>({});
  const [me, setMe] = useState<OrderRow>({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [users, setUsers] = useState<OrderRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  // 筛选条件：draft 为表单里正在编辑的值，applied 为已生效的值
  const [draft, setDraft] = useState<OrderRow>({});
  const [applied, setApplied] = useState<OrderRow>({});

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTargets, setAssignTargets] = useState<OrderRow[]>([]);
  const [assignUserId, setAssignUserId] = useState<string | number | undefined>();
  const [assigning, setAssigning] = useState(false);

  const [detail, setDetail] = useState<OrderRow | null>(null);
  const [detailNote, setDetailNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<string>('');
  const [importRows, setImportRows] = useState<OrderRow[]>([]);
  const [importErrors, setImportErrors] = useState<Array<{ index: number; message: string }>>([]);
  const [importUnmapped, setImportUnmapped] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const canAssign = Boolean(me?.canAssign);
  const myId = Number(me?.userId) || null;

  const loadUsers = useCallback(async () => {
    try {
      const response = await ctx.api.request({ url: 'users:list', method: 'get', params: { pageSize: 200 } });
      const data = response?.data?.data ?? response?.data ?? [];
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsers([]);
    }
  }, [ctx]);

  const load = useCallback(
    async (nextPage = page, nextPageSize = pageSize, nextFilters = applied) => {
      setLoading(true);
      try {
        const response = await ctx.api.request({
          url: 'orderConfirm:list',
          method: 'post',
          data: { page: nextPage, pageSize: nextPageSize, filters: nextFilters },
        });
        const body = response?.data?.data ?? {};
        const meta = response?.data?.meta ?? {};
        const list = Array.isArray(body) ? body : body?.rows ?? [];
        setRows(Array.isArray(list) ? list : []);
        setTotal(Number(meta?.total ?? body?.total ?? 0));
        setStats(meta?.stats ?? body?.stats ?? {});
        if (meta?.me || body?.me) setMe(meta?.me ?? body?.me ?? {});
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    },
    [ctx, applied, page, pageSize, message],
  );

  useEffect(() => {
    void load(1, pageSize, {});
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 把表单里的 date range 转成接口需要的起止字符串；其余字段原样带过去 */
  const buildQuery = (source: OrderRow) => {
    const next: OrderRow = { ...source };
    const purchaseRange = next.purchaseRange;
    const importRange = next.importRange;
    delete next.purchaseRange;
    delete next.importRange;
    if (purchaseRange?.[0]) next.purchaseStart = dayjs(purchaseRange[0]).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    if (purchaseRange?.[1]) next.purchaseEnd = dayjs(purchaseRange[1]).endOf('day').format('YYYY-MM-DD HH:mm:ss');
    if (importRange?.[0]) next.importStart = dayjs(importRange[0]).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    if (importRange?.[1]) next.importEnd = dayjs(importRange[1]).endOf('day').format('YYYY-MM-DD HH:mm:ss');
    return next;
  };

  const search = () => {
    const next = buildQuery(draft);
    setPage(1);
    setApplied(next);
    setSelectedKeys([]);
    void load(1, pageSize, next);
  };

  const reset = () => {
    setDraft({});
    setApplied({});
    setPage(1);
    setSelectedKeys([]);
    void load(1, pageSize, {});
  };

  const refresh = () => {
    void load(page, pageSize, applied);
  };

  const patchRow = (id: number, patch: OrderRow) => {
    setRows((prev) => prev.map((row) => (String(row.id) === String(id) ? { ...row, ...patch } : row)));
    if (detail && String(detail.id) === String(id)) setDetail({ ...detail, ...patch });
  };

  const canEditRow = (row: OrderRow) => canAssign || (myId && Number(row.assignee_id) === myId);

  const updateTask = async (row: OrderRow, patch: OrderRow) => {
    try {
      await ctx.api.request({
        url: 'orderConfirm:updateTask',
        method: 'post',
        data: { ids: [row.id], ...patch },
      });
      patchRow(Number(row.id), patch);
      message.success('已更新');
      void load(page, pageSize, applied);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const openAssign = (targets: OrderRow[]) => {
    setAssignTargets(targets);
    setAssignUserId(undefined);
    setAssignOpen(true);
  };

  const submitAssign = async () => {
    if (!assignUserId) {
      message.warning('请选择负责人');
      return;
    }
    setAssigning(true);
    try {
      const response = await ctx.api.request({
        url: 'orderConfirm:assign',
        method: 'post',
        data: { ids: assignTargets.map((row) => row.id), assigneeId: assignUserId },
      });
      const payload = response?.data?.data ?? {};
      message.success(`已指派 ${payload.updated ?? assignTargets.length} 行给 ${payload.assigneeName ?? ''}`);
      setAssignOpen(false);
      setSelectedKeys([]);
      void load(page, pageSize, applied);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAssigning(false);
    }
  };

  const saveNote = async () => {
    if (!detail) return;
    setSavingNote(true);
    try {
      await ctx.api.request({
        url: 'orderConfirm:updateTask',
        method: 'post',
        data: { ids: [detail.id], handleNote: detailNote },
      });
      patchRow(Number(detail.id), { handle_note: detailNote });
      message.success('备注已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingNote(false);
    }
  };

  const parseImportFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, codepage: 65001 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
    if (!matrix.length) throw new Error('文件是空的');
    const headers = (matrix[0] || []) as unknown[];
    const mapped: Record<number, string> = {};
    const unmapped: string[] = [];
    headers.forEach((header, index) => {
      const label = String(header ?? '').trim();
      if (!label) return;
      const field = FIELD_BY_ALIAS[normalizeHeader(label)];
      if (field) mapped[index] = field;
      else if (!IGNORED_HEADERS.has(label)) unmapped.push(label);
    });
    const parsed: OrderRow[] = [];
    const errors: Array<{ index: number; message: string }> = [];
    for (let i = 1; i < matrix.length; i += 1) {
      const cells = matrix[i] || [];
      if (!cells.some((cell) => String(cell ?? '').trim())) continue;
      const row: OrderRow = {};
      Object.entries(mapped).forEach(([indexText, field]) => {
        const value = cells[Number(indexText)];
        if (value === undefined || value === null || value === '') return;
        row[field] = field === 'purchase_date' || field === 'payments_date' ? toDateTimeCell(value) : value;
      });
      const subOrder = String(row.platform_sub_order_id ?? '').trim();
      const orderId = String(row.platform_order_id ?? row.origin_order_id ?? '').trim();
      if (!subOrder && !orderId) {
        errors.push({ index: i + 1, message: '缺少平台订单编号/子订单编号' });
        continue;
      }
      row.biz_key = subOrder || orderId;
      parsed.push(row);
    }
    return { parsed, errors, unmapped, headers: headers.map((item) => String(item ?? '')) };
  };

  const handleFile = async (file: File) => {
    try {
      const result = await parseImportFile(file);
      if (!result.parsed.length) {
        message.error(result.errors[0]?.message || '没有解析到可导入的行');
        return false;
      }
      setImportFile(file.name);
      setImportRows(result.parsed);
      setImportErrors(result.errors);
      setImportUnmapped(result.unmapped);
      setImportOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
    return false;
  };

  const submitImport = async () => {
    if (!importRows.length) return;
    setImporting(true);
    const summary = { inserted: 0, updated: 0, skipped: 0, errors: [] as Array<{ index: number; message: string }> };
    try {
      const chunkSize = 200;
      for (let index = 0; index < importRows.length; index += chunkSize) {
        const chunk = importRows.slice(index, index + chunkSize);
        const response = await ctx.api.request({
          url: 'orderConfirm:importRows',
          method: 'post',
          data: { rows: chunk },
        });
        const payload = response?.data?.data ?? {};
        summary.inserted += Number(payload.inserted) || 0;
        summary.updated += Number(payload.updated) || 0;
        summary.skipped += Number(payload.skipped) || 0;
        if (Array.isArray(payload.errors)) summary.errors.push(...payload.errors);
      }
      setImportOpen(false);
      setImportRows([]);
      setImportErrors([]);
      message.success(`导入完成：新增 ${summary.inserted}，更新 ${summary.updated}，跳过 ${summary.skipped}`);
      if (summary.errors.length) {
        modal.warning({
          title: '部分行未能导入',
          content: summary.errors
            .slice(0, 10)
            .map((item) => `第 ${item.index} 行：${item.message}`)
            .join('\n'),
        });
      }
      void load(1, pageSize, applied);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers = TEMPLATE_COLUMNS.map(([label]) => label);
    const sample = [
      '171-1234567-1234567',
      '171-1234567-1234567-1',
      '店铺A',
      'Unshipped',
      '待发货',
      '2026-11-16 10:00:00',
      '2026-11-16 10:05:00',
      'buyer@example.com',
      '+1 555 000 0000',
      'John',
      '123 Main St',
      'Apt 4',
      'Los Angeles',
      'CA',
      '90001',
      'SKU-001',
      1,
      39.99,
      '椅子',
      '原色',
      '米白',
      '高',
      '',
    ];
    const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '确认订单');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '确认订单导入模板.xlsx';
    link.click();
  };

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.nickname || user.username || String(user.id),
      })),
    [users],
  );

  const columns: any[] = [
    {
      title: '平台订单编号',
      dataIndex: 'platform_order_id',
      width: 160,
      fixed: 'left' as const,
      render: (value: unknown) => (value ? <Typography.Text copyable>{String(value)}</Typography.Text> : '—'),
    },
    {
      title: '子订单编号',
      dataIndex: 'platform_sub_order_id',
      width: 160,
      render: (value: unknown) => (value ? <Typography.Text copyable>{String(value)}</Typography.Text> : '—'),
    },
    { title: '店铺', dataIndex: 'shop_name', width: 90, ellipsis: true },
    { title: '买家邮箱', dataIndex: 'buyer_email', width: 170, ellipsis: true },
    { title: '收件人', dataIndex: 'recipient_name', width: 90, ellipsis: true },
    { title: 'SKU', dataIndex: 'sku', width: 110, ellipsis: true },
    { title: '数量', dataIndex: 'quantity_purchased', width: 70, align: 'center' as const },
    {
      title: '下单时间',
      dataIndex: 'purchase_date',
      width: 150,
      render: (value: unknown) => displayDate(value),
    },
    {
      title: '导入时间',
      dataIndex: 'imported_at',
      width: 150,
      render: (value: unknown) => displayDate(value),
    },
    {
      title: '负责人',
      dataIndex: 'assignee_name',
      width: 90,
      render: (value: unknown, row: OrderRow) =>
        value ? (
          <Tag color={Number(row.assignee_id) === myId ? 'blue' : 'default'}>{String(value)}</Tag>
        ) : (
          <Tag>未指派</Tag>
        ),
    },
    {
      title: '处理状态',
      dataIndex: 'handle_status',
      width: 120,
      render: (value: unknown, row: OrderRow) => {
        const status = String(value || '未处理');
        const editable = canEditRow(row);
        if (!editable) return <Tag color={STATUS_COLOR[status] || 'default'}>{status}</Tag>;
        return (
          <Select
            size="small"
            value={status}
            style={{ width: 118 }}
            onChange={(next) => void updateTask(row, { handleStatus: next })}
            options={HANDLE_STATUS_OPTIONS.map((item) => ({
              value: item,
              label: (
                <Space size={4}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: item === '已处理' ? '#52c41a' : item === '待跟踪' ? '#1677ff' : '#fa8c16',
                    }}
                  />
                  {item}
                </Space>
              ),
            }))}
          />
        );
      },
    },
    {
      title: '处理标记',
      dataIndex: 'handle_mark',
      width: 170,
      render: (value: unknown, row: OrderRow) => {
        const editable = canEditRow(row);
        if (!editable) return value ? <Tag color="purple">{String(value)}</Tag> : '—';
        return (
          <Select
            size="small"
            allowClear
            placeholder="选择标记"
            value={value || undefined}
            style={{ width: 172 }}
            onChange={(next) => void updateTask(row, { handleMark: next ?? '' })}
            options={HANDLE_MARK_OPTIONS.map((item) => ({ value: item, label: item }))}
          />
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, row: OrderRow) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setDetail(row);
              setDetailNote(String(row.handle_note || ''));
            }}
          >
            详情
          </Button>
          {canAssign ? (
            <Button type="link" size="small" onClick={() => openAssign([row])}>
              指派
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: '12px 16px' } }}>
        <Row gutter={12} align="middle">
          <Col flex="auto">
            <Space size={8} align="center">
              <CheckCircleOutlined style={{ fontSize: 18, color: '#1677ff' }} />
              <Typography.Title level={4} style={{ margin: 0 }}>
                确认订单工作台
              </Typography.Title>
              <Typography.Text type="secondary">数据表 OrderInfoToConfirm（附表）· 原 7E4 表不受影响</Typography.Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Tooltip title="下载空白导入模板">
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  导入模板
                </Button>
              </Tooltip>
              <Tooltip title={canAssign ? '上传每天导出的确认订单 Excel' : '仅值班人员/售后主管可导入'}>
                <Upload
                  accept=".xlsx,.xls,.csv"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void handleFile(file as File);
                    return false;
                  }}
                  disabled={!canAssign}
                >
                  <Button type="primary" icon={<CloudUploadOutlined />} disabled={!canAssign}>
                    导入 Excel
                  </Button>
                </Upload>
              </Tooltip>
              <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        {[
          { title: '全部任务', value: stats.total ?? total, color: '#1677ff', icon: <InfoCircleOutlined /> },
          { title: '未处理', value: stats.pending ?? 0, color: '#fa8c16', icon: <ClockCircleOutlined /> },
          { title: '待跟踪', value: stats.tracking ?? 0, color: '#1677ff', icon: <WarningOutlined /> },
          { title: '已处理', value: stats.handled ?? 0, color: '#52c41a', icon: <CheckCircleOutlined /> },
          { title: '未指派', value: stats.unassigned ?? 0, color: '#8c8c8c', icon: <TeamOutlined /> },
        ].map((item) => (
          <Col key={item.title} flex="1">
            <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
              <Statistic
                title={
                  <Space size={6} style={{ color: item.color }}>
                    {item.icon}
                    {item.title}
                  </Space>
                }
                value={Number(item.value) || 0}
                valueStyle={{ color: item.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Row gutter={[8, 8]} align="middle">
          <Col>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="平台订单编号"
              style={{ width: 180 }}
              value={draft.platformOrderId}
              onChange={(event) => setDraft((prev) => ({ ...prev, platformOrderId: event.target.value }))}
              onPressEnter={search}
            />
          </Col>
          <Col>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="子订单编号"
              style={{ width: 180 }}
              value={draft.subOrderId}
              onChange={(event) => setDraft((prev) => ({ ...prev, subOrderId: event.target.value }))}
              onPressEnter={search}
            />
          </Col>
          <Col>
            <DatePicker.RangePicker
              placeholder={['下单起', '下单止']}
              value={draft.purchaseRange || null}
              onChange={(value) => setDraft((prev) => ({ ...prev, purchaseRange: value }))}
            />
          </Col>
          <Col>
            <DatePicker.RangePicker
              placeholder={['导入起', '导入止']}
              value={draft.importRange || null}
              onChange={(value) => setDraft((prev) => ({ ...prev, importRange: value }))}
            />
          </Col>
          <Col>
            <Select
              allowClear
              placeholder="处理状态"
              style={{ width: 130 }}
              value={draft.handleStatus}
              onChange={(value) => setDraft((prev) => ({ ...prev, handleStatus: value }))}
              options={HANDLE_STATUS_OPTIONS.map((item) => ({ value: item, label: item }))}
            />
          </Col>
          <Col>
            <Select
              allowClear
              placeholder="处理标记"
              style={{ width: 180 }}
              value={draft.handleMark}
              onChange={(value) => setDraft((prev) => ({ ...prev, handleMark: value }))}
              options={HANDLE_MARK_OPTIONS.map((item) => ({ value: item, label: item }))}
            />
          </Col>
          <Col>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="负责人"
              style={{ width: 140 }}
              value={draft.assigneeId}
              onChange={(value) => setDraft((prev) => ({ ...prev, assigneeId: value }))}
              options={[{ value: 'unassigned', label: '未指派' }, ...userOptions]}
            />
          </Col>
          <Col>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={search}>
                查询
              </Button>
              <Button onClick={reset}>重置</Button>
            </Space>
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              {canAssign ? (
                <Button
                  icon={<UserSwitchOutlined />}
                  disabled={!selectedKeys.length}
                  onClick={() =>
                    openAssign(selectedKeys.map((id) => rows.find((row) => String(row.id) === String(id)) || { id }))
                  }
                >
                  批量指派{selectedKeys.length ? `（${selectedKeys.length}）` : ''}
                </Button>
              ) : null}
              <Typography.Text type="secondary">
                {canAssign ? '当前账号可以分配任务' : '当前账号为处理人，只能更新指派给自己的任务'}
              </Typography.Text>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<OrderRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1630 }}
          locale={{ emptyText: <Empty description="还没有确认订单，点右上角“导入 Excel”" /> }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
            preserveSelectedRowKeys: true,
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (value) => `共 ${value} 条`,
            pageSizeOptions: [20, 50, 100, 200],
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
              void load(nextPage, nextPageSize, applied);
            },
          }}
        />
      </Card>

      <Modal
        title={`指派负责人${assignTargets.length > 1 ? `（${assignTargets.length} 行）` : ''}`}
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={submitAssign}
        confirmLoading={assigning}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          将把 {assignTargets.length} 行指派给同一个负责人；已指派的行会被覆盖。
        </Typography.Paragraph>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择负责人"
          style={{ width: '100%' }}
          value={assignUserId}
          onChange={(value) => setAssignUserId(value)}
          options={userOptions}
        />
      </Modal>

      <Drawer
        title="确认订单详情"
        width={620}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        extra={
          canAssign && detail ? (
            <Button type="primary" onClick={() => openAssign([detail])}>
              指派
            </Button>
          ) : null
        }
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="平台订单编号" span={2}>
                {detail.platform_order_id || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="子订单编号" span={2}>
                {detail.platform_sub_order_id || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="店铺">{detail.shop_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="SKU">{detail.sku || '—'}</Descriptions.Item>
              <Descriptions.Item label="数量">{detail.quantity_purchased ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="商品金额">{detail.item_price ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="下单时间">{displayDate(detail.purchase_date)}</Descriptions.Item>
              <Descriptions.Item label="导入时间">{displayDate(detail.imported_at)}</Descriptions.Item>
              <Descriptions.Item label="平台订单状态">{detail.order_status || '—'}</Descriptions.Item>
              <Descriptions.Item label="子订单状态">{detail.sub_order_status || '—'}</Descriptions.Item>
              <Descriptions.Item label="买家邮箱" span={2}>
                {detail.buyer_email || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="收件人">{detail.recipient_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="邮编">{detail.ship_postal_code || '—'}</Descriptions.Item>
              <Descriptions.Item label="地址" span={2}>
                {[detail.ship_address_1, detail.ship_address_2, detail.ship_city, detail.ship_state]
                  .filter(Boolean)
                  .join(' / ') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="负责人">{detail.assignee_name || '未指派'}</Descriptions.Item>
              <Descriptions.Item label="处理状态">{detail.handle_status || '未处理'}</Descriptions.Item>
              <Descriptions.Item label="处理标记" span={2}>
                {detail.handle_mark || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="导入批次" span={2}>
                {detail.import_batch || '—'}
              </Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Text strong>处理备注</Typography.Text>
              <Input.TextArea
                rows={4}
                style={{ marginTop: 8 }}
                placeholder="例如：已发手工咨询，等待顾客回复"
                value={detailNote}
                onChange={(event) => setDetailNote(event.target.value)}
                disabled={!canEditRow(detail)}
              />
              <Button
                style={{ marginTop: 8 }}
                type="primary"
                loading={savingNote}
                disabled={!canEditRow(detail)}
                onClick={saveNote}
              >
                保存备注
              </Button>
            </div>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="导入确认订单"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={submitImport}
        confirmLoading={importing}
        okText={`导入 ${importRows.length} 行`}
        cancelText="取消"
        width={720}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={importFile}
            description="按「子订单编号（没有则平台订单编号）」幂等：已存在的行只更新订单信息，不会覆盖负责人/处理状态/处理标记。"
          />
          {importUnmapped.length ? (
            <Alert
              type="warning"
              showIcon
              message={`有 ${importUnmapped.length} 个表头未识别，将被忽略`}
              description={importUnmapped.slice(0, 12).join('、')}
            />
          ) : null}
          {importErrors.length ? (
            <Alert
              type="error"
              showIcon
              message={`${importErrors.length} 行缺少订单编号，将被跳过`}
              description={importErrors
                .slice(0, 5)
                .map((item) => `第 ${item.index} 行：${item.message}`)
                .join('；')}
            />
          ) : null}
          <Typography.Text type="secondary">可导入 {importRows.length} 行，预览前 5 行：</Typography.Text>
          <Table
            size="small"
            rowKey={(_, index) => String(index)}
            pagination={false}
            dataSource={importRows.slice(0, 5)}
            columns={[
              { title: '平台订单编号', dataIndex: 'platform_order_id', width: 150, ellipsis: true },
              { title: '子订单编号', dataIndex: 'platform_sub_order_id', width: 150, ellipsis: true },
              { title: '下单时间', dataIndex: 'purchase_date', width: 150 },
              { title: '买家邮箱', dataIndex: 'buyer_email', width: 160, ellipsis: true },
              { title: 'SKU', dataIndex: 'sku', width: 100, ellipsis: true },
            ]}
          />
        </Space>
      </Modal>
    </div>
  );
}
