import {
  App,
  Button,
  Card,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { DownOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';

const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';

type RequestType = 'contact' | 'reship' | 'refund' | 'claim';
type Row = Record<string, any>;

export function AttachmentField({ value, onChange, maxCount = 5, accept = 'image/*', ctx, label }: {
  value?: any;
  onChange?: (value: any) => void;
  maxCount?: number;
  accept?: string;
  ctx: any;
  label: string;
}) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    if (Array.isArray(value)) setItems(value);
    else if (typeof value === 'string' && value.trim()) {
      try { const parsed = JSON.parse(value); setItems(Array.isArray(parsed) ? parsed : []); } catch { setItems([]); }
    } else setItems([]);
  }, [value]);

  const customRequest = async (options: any) => {
    const { file, onSuccess, onError } = options;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await ctx.api.request({ url: 'attachments:upload', method: 'post', data: formData });
      const uploaded = response?.data?.data ?? response?.data;
      if (!uploaded?.id) throw new Error('上传未返回附件信息');
      const next = [...items, {
        id: uploaded.id,
        url: uploaded.url,
        filename: uploaded.filename || file.name,
        mimetype: uploaded.mimetype,
        size: uploaded.size,
      }];
      setItems(next);
      onChange?.(next);
      onSuccess?.(uploaded);
    } catch (error: any) {
      onError?.(error);
    }
  };

  return (
    <Upload
      accept={accept}
      multiple={maxCount > 1}
      maxCount={maxCount}
      fileList={items.map((item) => ({ uid: String(item.id), name: item.filename || label, status: 'done' as const, url: item.url }))}
      customRequest={customRequest}
      onRemove={(file) => {
        const next = items.filter((item) => String(item.id) !== String(file.uid));
        setItems(next);
        onChange?.(next);
      }}
    >
      <Button icon={<UploadOutlined />}>上传{label}（最多 {maxCount} 个）</Button>
    </Upload>
  );
}

const CONFIG: Record<RequestType, {
  title: string;
  collection: string;
  idField: string;
  statusField: string;
  statuses: string[];
  scrollX: number;
  fields: Array<{ name: string; label: string; type?: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'json' | 'attachment'; options?: string[]; maxCount?: number; accept?: string }>;
  columns: Array<{ key: string; title: string; width?: number }>;
}> = {
  contact: {
    title: '仓库联系汇总',
    collection: 'AfterSalesWarehouseContact',
    idField: 'id',
    statusField: 'contact_status',
    statuses: ['待联系', '联系中', '待发送', '已发送', '已回复', '已关闭'],
    scrollX: 1600,
    fields: [
      { name: 'platform_order_id', label: '平台订单编号' },
      { name: 'sub_order_id', label: '子订单编号' },
      { name: 'tracking_number', label: '运单号' },
      { name: 'store_name', label: '店铺' },
      { name: 'warehouse_name', label: '仓库' },
      { name: 'issue_description', label: '问题描述', type: 'textarea' },
      { name: 'message_content', label: '联系诉求', type: 'textarea' },
      { name: 'contact_channel', label: '联系渠道', type: 'select', options: ['微信', '飞书', '仓库系统'] },
      { name: 'contact_status', label: '状态', type: 'select', options: ['待联系', '联系中', '待发送', '已发送', '已回复', '已关闭'] },
      { name: 'follow_up_at', label: '跟进时间', type: 'date' },
    ],
    columns: [
      { key: 'platform_order_id', title: '平台订单编号', width: 170 },
      { key: 'sub_order_id', title: '子订单编号', width: 170 },
      { key: 'tracking_number', title: '运单号', width: 150 },
      { key: 'store_name', title: '店铺', width: 130 },
      { key: 'platform_sku', title: '平台 SKU', width: 140 },
      { key: 'stock_sku', title: '库存 SKU', width: 130 },
      { key: 'warehouse_name', title: '仓库', width: 190 },
      { key: 'contact_channel', title: '渠道', width: 90 },
      { key: 'contact_status', title: '状态', width: 90 },
      { key: 'handler_name', title: '处理人', width: 100 },
    ],
  },
  reship: {
    title: '补寄申请',
    collection: 'AfterSalesReshipRequest',
    idField: 'id',
    statusField: 'request_status',
    statuses: ['待审核', '待复查', '已批准', '已拒绝', '执行中', '已完成', '已取消'],
    scrollX: 1500,
    fields: [
      { name: 'platform_order_id', label: '平台订单编号' },
      { name: 'sub_order_id', label: '子订单编号' },
      { name: 'tracking_number', label: '运单号' },
      { name: 'store_name', label: '店铺' },
      { name: 'reship_type', label: '补寄类型', type: 'select', options: ['新箱', '部件'] },
      { name: 'reship_item_sku', label: '补寄物品 SKU' },
      { name: 'reship_item_name', label: '补寄物品名称' },
      { name: 'quantity', label: '数量', type: 'number' },
      { name: 'reason', label: '补寄原因', type: 'textarea' },
      { name: 'buyer_photos', label: '问题图片（最多 5 张）', type: 'attachment', maxCount: 5 },
      { name: 'request_status', label: '状态', type: 'select', options: ['待审核', '待复查', '已批准', '已拒绝', '执行中', '已完成', '已取消'] },
      { name: 'reship_tracking_number', label: '补寄运单号' },
    ],
    columns: [
      { key: 'platform_order_id', title: '平台订单编号', width: 170 },
      { key: 'sub_order_id', title: '子订单编号', width: 170 },
      { key: 'reship_type', title: '补寄类型', width: 80 },
      { key: 'reship_item_sku', title: '补寄物品 SKU', width: 130 },
      { key: 'reship_item_name', title: '补寄物品名称', width: 140 },
      { key: 'quantity', title: '数量', width: 60 },
      { key: 'request_status', title: '状态', width: 90 },
      { key: 'reship_tracking_number', title: '补寄运单号', width: 150 },
      { key: 'handler_name', title: '处理人', width: 100 },
    ],
  },
  refund: {
    title: '退款申请',
    collection: 'AfterSalesRefundRequest',
    idField: 'id',
    statusField: 'request_status',
    statuses: ['待审核', '待再议', '已批准', '已拒绝', '执行中', '已完成', '已取消'],
    scrollX: 1500,
    fields: [
      { name: 'platform_order_id', label: '平台订单编号' },
      { name: 'sub_order_id', label: '子订单编号' },
      { name: 'tracking_number', label: '运单号' },
      { name: 'store_name', label: '店铺' },
      { name: 'refund_amount', label: '退款金额', type: 'number' },
      { name: 'refund_currency', label: '币种', type: 'select', options: ['USD', 'CNY', 'EUR', 'GBP'] },
      { name: 'reason', label: '退款原因', type: 'textarea' },
      { name: 'refund_photos', label: '问题图片（最多 3 张）', type: 'attachment', maxCount: 3 },
      { name: 'request_status', label: '状态', type: 'select', options: ['待审核', '待再议', '已批准', '已拒绝', '执行中', '已完成', '已取消'] },
      { name: 'refund_transaction_no', label: '退款流水号' },
    ],
    columns: [
      { key: 'platform_order_id', title: '平台订单编号', width: 170 },
      { key: 'sub_order_id', title: '子订单编号', width: 170 },
      { key: 'refund_amount', title: '退款金额', width: 100 },
      { key: 'refund_currency', title: '币种', width: 70 },
      { key: 'reason', title: '退款原因', width: 240 },
      { key: 'refund_photos', title: '问题照片', width: 180 },
      { key: 'request_status', title: '状态', width: 90 },
      { key: 'handler_name', title: '处理人', width: 100 },
    ],
  },
  claim: {
    title: '索赔申请',
    collection: 'AfterSalesClaimRequest',
    idField: 'id',
    statusField: 'claim_status',
    statuses: ['待提交', '已提交', '处理中', '已索赔', '已拒绝', '已关闭'],
    scrollX: 2300,
    fields: [
      { name: 'platform_order_id', label: '平台订单编号' },
      { name: 'sub_order_id', label: '子订单编号' },
      { name: 'tracking_number', label: '运单号' },
      { name: 'store_name', label: '店铺' },
      { name: 'claim_amount', label: '索赔金额', type: 'number' },
      { name: 'claim_currency', label: '币种', type: 'select', options: ['USD', 'CNY', 'EUR', 'GBP'] },
      { name: 'received_amount', label: '实际赔付', type: 'number' },
      { name: 'claim_reason', label: '索赔原因', type: 'textarea' },
      { name: 'claim_trigger', label: '触发类型', type: 'select', options: ['处于初始状态长期未更新', '处于运输状态长期停滞未更新', '交付异常：显示已交付，反馈未收到', '受损返仓', '异常返仓'] },
      { name: 'related_request_no', label: '关联补寄/退款单号' },
      { name: 'claim_packing_list', label: '装箱清单 PDF', type: 'attachment', maxCount: 1, accept: 'application/pdf' },
      { name: 'claim_email_evidence', label: '邮件沟通截图', type: 'attachment', maxCount: 5 },
      { name: 'claim_tracking_evidence', label: '快递异常/交付截图', type: 'attachment', maxCount: 5 },
      { name: 'claim_other_evidence', label: '其他材料', type: 'attachment', maxCount: 5 },
      { name: 'claim_status', label: '状态', type: 'select', options: ['待提交', '已提交', '处理中', '已索赔', '已拒绝', '已关闭'] },
      { name: 'warehouse_claim_no', label: '仓库索赔单号' },
    ],
    columns: [
      { key: 'platform_order_id', title: '平台订单编号', width: 170 },
      { key: 'platform_sku', title: '平台 SKU', width: 140 },
      { key: 'stock_sku', title: '库存 SKU', width: 130 },
      { key: 'source_type', title: '来源', width: 100 },
      { key: 'sub_order_id', title: '子订单编号', width: 170 },
      { key: 'tracking_number', title: '运单号', width: 150 },
      { key: 'store_name', title: '店铺', width: 130 },
      { key: 'claim_amount', title: '索赔金额', width: 100 },
      { key: 'received_amount', title: '实际赔付', width: 100 },
      { key: 'claim_reason', title: '索赔原因', width: 220 },
      { key: 'claim_trigger', title: '触发类型', width: 150 },
      { key: 'warehouse_claim_no', title: '仓库索赔单号', width: 130 },
      { key: 'claim_evidence', title: '证据附件', width: 160 },
      { key: 'handler_name', title: '处理人', width: 100 },
    ],
  },
};

function normalizeFiles(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function renderFiles(value: any) {
  const files = normalizeFiles(value);
  if (!files.length) return '-';
  return (
    <Space size={4} wrap>
      {files.map((file, index) => {
        const url = file.url || '';
        const name = file.filename || `附件${index + 1}`;
        if (file.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) {
          return <a key={`${file.id || index}`} href={url} target="_blank" rel="noreferrer"><img src={url} alt={name} style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 3, border: '1px solid #eee' }} /></a>;
        }
        return <a key={`${file.id || index}`} href={url} target="_blank" rel="noreferrer" title={name}>{name.length > 10 ? `${name.slice(0, 10)}…` : name}</a>;
      })}
    </Space>
  );
}

function statusColor(status: string) {
  if (['已完成', '已索赔', '已批准', '已回复'].includes(status)) return 'green';
  if (['已拒绝', '已取消', '已关闭'].includes(status)) return 'red';
  if (['待审核', '待提交', '待复查', '待再议', '待发送', '待联系'].includes(status)) return 'orange';
  if (status === '联系中') return 'blue';
  return 'blue';
}

export default function AfterSalesRequestsPage({ requestType: requestTypeProp }: { requestType?: RequestType }) {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const requestType: RequestType = requestTypeProp || (path.includes('warehouse-contacts') ? 'contact' : path.includes('reship-requests') ? 'reship' : path.includes('refund-requests') ? 'refund' : 'claim');
  const ctx = useFlowContext();
  const { message, modal } = App.useApp();
  const config = CONFIG[requestType];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [subSearch, setSubSearch] = useState('');
  const [trackingSearch, setTrackingSearch] = useState('');
  const [handlerSearch, setHandlerSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [batchStatus, setBatchStatus] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRow, setReviewRow] = useState<Row | null>(null);
  const [reviewNext, setReviewNext] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusRow, setStatusRow] = useState<Row | null>(null);
  const [statusNext, setStatusNext] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const prefillDone = useRef(false);

  const currentUser = (ctx as any).user ?? (ctx as any).currentUser;
  const currentName = currentUser?.nickname || currentUser?.username || '人工';

  useEffect(() => {
    const fallbackRoles = (currentUser?.roles || []).map((role: any) => role?.name).filter(Boolean);
    const fallbackCanReview = fallbackRoles.some((name: string) => ['root', 'admin', 'after_sales_manager'].includes(name));
    ctx.api.request({ url: 'roles:check' }).then((response: any) => {
      const body = response?.data?.data ?? response?.data ?? {};
      const roles = [body.role, ...(Array.isArray(body.roles) ? body.roles : [])].filter(Boolean);
      setCanReview(roles.some((name: string) => ['root', 'admin', 'after_sales_manager'].includes(name)));
    }).catch(() => setCanReview(fallbackCanReview));
  }, [ctx, currentUser]);

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 500, sort: ['-created_at'] };
      const response = await ctx.api.request({
        url: `${config.collection}:list`,
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params,
      });
      const body = response?.data?.data ?? response?.data ?? {};
      setRows(Array.isArray(body) ? body : body?.data ?? []);
    } catch (error: any) {
      message.error(error?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [config.collection]);

  useEffect(() => {
    if (prefillDone.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') !== '1') return;
    prefillDone.current = true;
    openCreate({
      platform_order_id: params.get('platform_order_id') || '',
      platform_sku: params.get('platform_sku') || '',
      stock_sku: params.get('stock_sku') || '',
      handler_name: params.get('handler_name') || '',
      sub_order_id: params.get('sub_order_id') || '',
      tracking_number: params.get('tracking_number') || '',
      store_name: params.get('store_name') || '',
      exception_id: params.get('exception_id') ? Number(params.get('exception_id')) : null,
      source_row_id: params.get('source_row_id') ? Number(params.get('source_row_id')) : null,
      source_type: params.get('source_type') || 'tracking_exception',
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const recordId = params.get('record_id');
    if (!recordId) return;
    void (async () => {
      try {
        const response = await ctx.api.request({
          url: `${config.collection}:get?filterByTk=${recordId}`,
          method: 'get',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
        });
        const record = response?.data?.data ?? response?.data;
        if (record?.id) openEdit(record);
      } catch (error: any) {
        message.error(error?.message || '加载记录失败');
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const match = (value: any, text: string) => !text.trim() || String(value || '').toLowerCase().includes(text.trim().toLowerCase());
    return rows.filter((row) => {
      if (statusFilter !== 'all' && String(row[config.statusField] || '') !== statusFilter) return false;
      if (!match(row.platform_order_id, orderSearch)) return false;
      if (!match(row.sub_order_id, subSearch)) return false;
      if (!match(row.tracking_number, trackingSearch)) return false;
      if (!match(row.handler_name, handlerSearch)) return false;
      return true;
    });
  }, [rows, orderSearch, subSearch, trackingSearch, handlerSearch, statusFilter, config.statusField]);

  function openCreate(prefill: Record<string, any> = {}) {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      source_type: 'tracking_exception',
      refund_currency: 'USD',
      claim_currency: 'USD',
      [config.statusField]: config.statuses[0],
      ...prefill,
    });
    setFormOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      ...row,
      follow_up_at: row.follow_up_at ? dayjs(row.follow_up_at) : null,
      buyer_photos: Array.isArray(row.buyer_photos) ? row.buyer_photos : [],
      refund_photos: Array.isArray(row.refund_photos) ? row.refund_photos : [],
      claim_packing_list: Array.isArray(row.claim_packing_list) ? row.claim_packing_list : [],
      claim_email_evidence: Array.isArray(row.claim_email_evidence) ? row.claim_email_evidence : [],
      claim_tracking_evidence: Array.isArray(row.claim_tracking_evidence) ? row.claim_tracking_evidence : [],
      claim_other_evidence: Array.isArray(row.claim_other_evidence) ? row.claim_other_evidence : [],
    });
    setFormOpen(true);
  }

  async function save() {
    try {
      const values = await form.validateFields();
      const data: Record<string, any> = { ...values };
      delete data.claim_attachments;
      data.created_by = data.created_by || currentName;
      if (editing) {
        await ctx.api.request({
          url: 'afterSalesRequest:update',
          method: 'post',
          data: { request_type: requestType, id: editing[config.idField], values: data },
        });
      } else {
        await ctx.api.request({
          url: 'afterSalesRequest:create',
          method: 'post',
          data: { request_type: requestType, values: data },
        });
      }
      message.success('已保存');
      setFormOpen(false);
      await load();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || '保存失败');
    }
  }

  async function updateStatus(row: Row, status: string) {
    try {
      await ctx.api.request({
        url: `${config.collection}:update?filterByTk=${row[config.idField]}`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: { [config.statusField]: status },
      });
      message.success(`状态已更新为：${status}`);
      await load();
    } catch (error: any) {
      message.error(error?.message || '状态更新失败');
    }
  }

  function exportRows() {
    const data = selectedKeys.length ? filtered.filter((row) => selectedKeys.includes(row[config.idField])) : filtered;
    if (!data.length) { message.warning('没有可导出的数据'); return; }
    const headers = config.columns.map((col) => col.title);
    const lines = data.map((row) => config.columns.map((col) => JSON.stringify(row[col.key] ?? '').slice(1, -1)).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.title}-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function batchNotify() {
    modal.info({
      title: '批量飞书发送（待接入）',
      content: `已选择 ${selectedKeys.length} 条。飞书发送接口接入后，可在此批量发送联系信息。`,
    });
  }

  function batchApi() {
    modal.info({
      title: '批量 API 创建（待接入）',
      content: `已选择 ${selectedKeys.length} 条。仓库 API 接入后，可在此批量创建工单。`,
    });
  }

  function formatRow(row: Row) {
    const lines = [
      `【${config.title}】`,
      `平台订单编号：${row.platform_order_id || '-'}`,
      `子订单编号：${row.sub_order_id || '-'}`,
      `平台 SKU：${row.platform_sku || '-'}`,
      `库存 SKU：${row.stock_sku || '-'}`,
      `运单号：${row.tracking_number || '-'}`,
      `店铺：${row.store_name || '-'}`,
      `仓库：${row.warehouse_name || '-'}`,
      `状态：${row[config.statusField] || '-'}`,
    ];
    if (requestType === 'contact') {
      lines.push(`联系渠道：${row.contact_channel || '-'}`, `问题描述：${row.issue_description || '-'}`, `联系诉求：${row.message_content || '-'}`);
    } else if (requestType === 'reship') {
      lines.push(`补寄类型：${row.reship_type || '-'}`, `补寄物品：${row.reship_item_sku || row.reship_item_name || '-'}`, `数量：${row.quantity || '-'}`, `原因：${row.reason || '-'}`);
    } else if (requestType === 'refund') {
      lines.push(`退款金额：${row.refund_amount || '-'} ${row.refund_currency || ''}`, `原因：${row.reason || '-'}`);
    } else {
      lines.push(`索赔金额：${row.claim_amount || '-'} ${row.claim_currency || ''}`, `索赔原因：${row.claim_reason || '-'}`);
    }
    return lines.join('\n');
  }

  async function copyRow(row: Row) {
    try {
      await navigator.clipboard.writeText(formatRow(row));
      message.success('行信息已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  async function copyRows() {
    const data = selectedKeys.length ? filtered.filter((row) => selectedKeys.includes(row[config.idField])) : filtered;
    if (!data.length) { message.warning('没有可复制的数据'); return; }
    try {
      await navigator.clipboard.writeText(data.map(formatRow).join('\n\n'));
      message.success(`已复制 ${data.length} 行信息`);
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  function nextStatuses(row: Row): string[] {
    const status = String(row[config.statusField] || '');
    if (requestType === 'contact') {
      if (['待发送', '待联系'].includes(status)) return ['联系中', '已发送', '已关闭'];
      if (status === '联系中') return ['已发送', '已关闭'];
      if (status === '已发送') return ['已回复', '已关闭'];
      if (status === '已回复') return ['已关闭'];
      return [];
    }
    if (requestType === 'reship') {
      if (status === '待审核') return ['待复查', '已批准', '已拒绝'];
      if (status === '待复查') return ['待审核', '已拒绝'];
      if (status === '已拒绝') return ['待审核'];
      if (status === '已批准') return ['执行中', '已取消'];
      if (status === '执行中') return ['已完成', '已取消'];
      return [];
    }
    if (requestType === 'refund') {
      if (status === '待审核') return ['待再议', '已批准', '已拒绝'];
      if (status === '待再议') return ['待审核', '已拒绝'];
      if (status === '已拒绝') return ['待审核'];
      if (status === '已批准') return ['执行中', '已取消'];
      if (status === '执行中') return ['已完成', '已取消'];
      return [];
    }
    if (status === '待提交') return ['已提交', '已拒绝', '已关闭'];
    if (status === '已提交') return ['处理中', '已拒绝', '已关闭'];
    if (status === '处理中') return ['已索赔', '已拒绝', '已关闭'];
    return [];
  }

  function openStatus(row: Row) {
    const options = nextStatuses(row);
    if (!options.length) { message.warning('当前状态没有可执行的流转'); return; }
    setStatusRow(row);
    setStatusNext(options[0]);
    setStatusNote(String(row.review_note || ''));
    setStatusOpen(true);
  }

  async function submitStatus() {
    if (!statusRow || !statusNext) return;
    setStatusSaving(true);
    try {
      const data: Record<string, any> = { [config.statusField]: statusNext, review_note: statusNote || null, reviewer_id: currentName, reviewed_at: dayjs().format('YYYY-MM-DD HH:mm:ss') };
      if (requestType === 'claim' && ['已索赔', '已拒绝', '已关闭'].includes(statusNext)) data.result_at = dayjs().format('YYYY-MM-DD HH:mm:ss');
      await ctx.api.request({ url: 'afterSalesRequest:review', method: 'post', data: { request_type: requestType, id: statusRow[config.idField], next_status: statusNext, review_note: statusNote } });
      message.success(`状态已更新为：${statusNext}`);
      setStatusOpen(false); setStatusRow(null); await load();
    } catch (error: any) { message.error(error?.message || '状态更新失败'); }
    finally { setStatusSaving(false); }
  }

  async function resubmit(row: Row) {
    if (!['已拒绝', '待复查', '待再议'].includes(String(row[config.statusField] || ''))) return;
    try {
      await ctx.api.request({ url: 'afterSalesRequest:resubmit', method: 'post', data: { request_type: requestType, id: row[config.idField] } });
      message.success('已重新提交审核');
      await load();
    } catch (error: any) { message.error(error?.message || '重新提交失败'); }
  }

  async function batchUpdateStatus(statusArg?: string) {
    const nextStatus = statusArg || batchStatus;
    if (!nextStatus) { message.warning('请先选择要修改的状态'); return; }
    if (!selectedKeys.length) { message.warning('请先选择数据行'); return; }
    try {
      await Promise.all(selectedKeys.map((id) => ctx.api.request({
        url: 'afterSalesRequest:review',
        method: 'post',
        data: { request_type: requestType, id, next_status: nextStatus, review_note: '批量修改状态' },
      })));
      message.success(`已批量更新 ${selectedKeys.length} 行`);
      setBatchStatus('');
      await load();
    } catch (error: any) {
      message.error(error?.message || '批量更新失败');
    }
  }

  const statusActions = (row: Row) => {
    const status = String(row[config.statusField] || '');
    const actions: Array<{ label: string; next: string }> = [];
    if (requestType === 'reship' || requestType === 'refund') {
      if (status === '待审核') actions.push({ label: '批准', next: '已批准' }, { label: requestType === 'reship' ? '待复查' : '待再议', next: requestType === 'reship' ? '待复查' : '待再议' });
      if (status === '已批准') actions.push({ label: '执行中', next: '执行中' });
      if (status === '执行中') actions.push({ label: '完成', next: '已完成' });
    }
    if (requestType === 'claim') {
      if (status === '待提交') actions.push({ label: '提交', next: '已提交' });
      if (['已提交', '处理中'].includes(status)) actions.push({ label: '更新结果', next: '已索赔' });
    }
    if (requestType === 'contact') {
      if (status === '待发送') actions.push({ label: '标记已发送', next: '已发送' });
      if (status === '已发送') actions.push({ label: '标记已回复', next: '已回复' });
    }
    return actions;
  };

  return (
    <div style={{ padding: 24, boxSizing: 'border-box', width: '100%', minWidth: 0 }}>
      <style>{`.after-sales-request-table td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`}</style>
      <Space align="center" wrap style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>{config.title}</Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建</Button>
        <Dropdown
          menu={{
            items: [
              { key: 'tracking', label: '快递异常工作台' },
              { key: 'daily', label: '每日售后订单' },
            ],
            onClick: ({ key }) => window.open(key === 'tracking' ? '/v/admin/tracking-exception/workbench' : '/v/admin/a6iheb4en08', '_blank'),
          }}
        >
          <Button>返回发起页面 <DownOutlined /></Button>
        </Dropdown>

        <Dropdown
          menu={{
            items: ([
              ['warehouse-contacts', '仓库联系汇总'],
              ['reship-requests', '补寄申请'],
              ['refund-requests', '退款申请'],
              ['claim-requests', '索赔申请'],
            ] as Array<[RequestType, string]>)
              .filter(([key]) => key !== requestType)
              .map(([key, label]) => ({ key, label })),
            onClick: ({ key }) => window.open(`/v/admin/after-sales/${key}`, '_blank'),
          }}
        >
          <Button>其他子页面 <DownOutlined /></Button>
        </Dropdown>
        <Button onClick={exportRows}>导出{selectedKeys.length ? `（${selectedKeys.length}）` : '当前筛选'}</Button>
        <Button onClick={() => void copyRows()}>批量复制{selectedKeys.length ? `（${selectedKeys.length}）` : ''}</Button>
        {canReview || ['warehouse-contacts', 'claim-requests'].includes(requestType) ? (
          <Dropdown
            disabled={!selectedKeys.length}
            menu={{
              items: config.statuses.map((status) => ({ key: status, label: status })),
              onClick: ({ key }) => void batchUpdateStatus(key),
            }}
          >
            <Button disabled={!selectedKeys.length}>批量修改状态 <DownOutlined /></Button>
          </Dropdown>
        ) : null}
        {requestType === 'contact' ? <Button onClick={batchNotify}>批量飞书（待接入）</Button> : null}
        {requestType === 'contact' ? <Button onClick={batchApi}>批量发起仓库查件工单（待接入）</Button> : null}
        {requestType === 'claim' ? <Button onClick={batchApi}>批量发起仓库索赔工单（待接入）</Button> : null}
        {(requestType === 'reship' || requestType === 'refund') ? <Button onClick={batchNotify}>批量飞书（可选）</Button> : null}
      </Space>

      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 10 } }}>
        <Space wrap>
          <Input allowClear prefix={<SearchOutlined />} placeholder="平台订单编号" style={{ width: 200 }} value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} />
          <Input allowClear placeholder="子订单编号" style={{ width: 200 }} value={subSearch} onChange={(event) => setSubSearch(event.target.value)} />
          <Input allowClear placeholder="运单号" style={{ width: 180 }} value={trackingSearch} onChange={(event) => setTrackingSearch(event.target.value)} />
          <Input allowClear placeholder="处理人" style={{ width: 140 }} value={handlerSearch} onChange={(event) => setHandlerSearch(event.target.value)} />
          <Select value={statusFilter} style={{ width: 130 }} onChange={setStatusFilter} options={[{ label: '全部状态', value: 'all' }, ...config.statuses.map((status) => ({ label: status, value: status }))]} />
          <Button onClick={() => { setOrderSearch(''); setSubSearch(''); setTrackingSearch(''); setHandlerSearch(''); setStatusFilter('all'); setSelectedKeys([]); }}>重置</Button>
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Table
          className="after-sales-request-table"
          rowKey={config.idField}
          loading={loading}
          dataSource={filtered}
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
          tableLayout="fixed"
          scroll={{ x: config.scrollX }}
          pagination={{ pageSize: 30, showSizeChanger: true, showTotal: (total) => `共 ${total} 行` }}
          columns={[
            ...config.columns.map((col) => ({
              title: col.title,
              dataIndex: col.key,
              width: col.width,
              render: (value: any, row: Row) => {
                if (col.key === config.statusField) return <Tag color={statusColor(String(value || ''))}>{String(value || '-')}</Tag>;
                if (col.key === 'refund_photos') return renderFiles(row.refund_photos);
                if (col.key === 'claim_evidence') return renderFiles([...(normalizeFiles(row.claim_packing_list)), ...(normalizeFiles(row.claim_email_evidence)), ...(normalizeFiles(row.claim_tracking_evidence)), ...(normalizeFiles(row.claim_other_evidence))]);
                if (col.key === 'source_type') return value === 'tracking_exception' ? '快递异常' : value === 'daily_after_sales' ? '每日售后订单' : (value ?? '-');
                if (col.key === 'created_at' && value) return dayjs(value).format('YYYY-MM-DD HH:mm');
                return <span title={String(value ?? '-')} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value ?? '-'}</span>;
              },
            })),
            {
              title: '操作', width: 320, fixed: 'right' as const,
              render: (_: any, row: Row) => (
                <Space size={2}>
                  <Button type="link" size="small" onClick={() => openEdit(row)}>编辑</Button>
                  <Button type="link" size="small" onClick={() => void copyRow(row)}>复制信息</Button>
                  {requestType === 'contact' ? (
                    <Tooltip title="相关功能待开发">
                      <span><Button type="link" size="small" disabled>发起仓库查件工单</Button></span>
                    </Tooltip>
                  ) : null}
                  {requestType === 'claim' ? (
                    <Tooltip title="相关功能待开发">
                      <span><Button type="link" size="small" disabled>发起仓库索赔工单</Button></span>
                    </Tooltip>
                  ) : null}
                  {(canReview || ['warehouse-contacts', 'claim-requests'].includes(requestType)) ? (
                    <Button type="link" size="small" disabled={!nextStatuses(row).length} onClick={() => openStatus(row)}>状态处理</Button>
                  ) : ['已拒绝', '待复查', '待再议'].includes(String(row[config.statusField] || '')) && requestType !== 'contact' ? (
                    <Button type="link" size="small" onClick={() => void resubmit(row)}>重新提交</Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={`${editing ? '编辑' : '新建'}${config.title}`} open={formOpen} onCancel={() => setFormOpen(false)} onOk={() => void save()} width={720} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="platform_order_id" label="平台订单编号" rules={[{ required: true, message: '请填写平台订单编号' }]}>
            <Input placeholder="平台订单编号" />
          </Form.Item>
          <Form.Item name="platform_sku" label="平台 SKU">
            <Input placeholder="平台 SKU" />
          </Form.Item>
          <Form.Item name="stock_sku" label="库存 SKU">
            <Input placeholder="库存 SKU" />
          </Form.Item>
          <Form.Item name="handler_name" label="处理人">
            <Input placeholder="处理人" />
          </Form.Item>
          <Form.Item name="source_type" label="来源">
            <Select options={[{ label: '快递异常', value: 'tracking_exception' }, { label: '每日售后订单', value: 'daily_after_sales' }]} />
          </Form.Item>
          {config.fields.filter((field) => !['platform_order_id', 'source_type', config.statusField].includes(field.name)).map((field) => (
            <Form.Item key={field.name} name={field.name} label={field.label}>
              {field.type === 'attachment' ? (
                <AttachmentField ctx={ctx} label={field.label} maxCount={field.maxCount} accept={field.accept} />
              ) : field.type === 'textarea' || field.type === 'json' ? (
                <Input.TextArea rows={field.type === 'json' ? 4 : 3} placeholder={field.type === 'json' ? '填写 JSON 数组或附件 URL' : undefined} />
              ) : field.type === 'number' ? (
                <InputNumber style={{ width: '100%' }} />
              ) : field.type === 'select' ? (
                <Select options={(field.options || []).map((option) => ({ label: option, value: option }))} />
              ) : field.type === 'date' ? (
                <DatePicker showTime style={{ width: '100%' }} />
              ) : (
                <Input />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <Modal
        title="状态处理"
        open={statusOpen}
        onCancel={() => { setStatusOpen(false); setStatusRow(null); }}
        onOk={() => void submitStatus()}
        confirmLoading={statusSaving}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            平台订单：{statusRow?.platform_order_id || '-'} ｜ 当前状态：{statusRow ? String(statusRow[config.statusField] || '-') : '-'}
          </Typography.Text>
          <Typography.Text>目标状态</Typography.Text>
          <Select value={statusNext || undefined} onChange={setStatusNext} style={{ width: '100%' }} options={(statusRow ? config.statuses.filter((status) => status !== String(statusRow[config.statusField] || '')) : []).map((status) => ({ label: status, value: status }))} />
          <Typography.Text>处理意见 / 退回原因</Typography.Text>
          <Input.TextArea rows={4} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="填写审核意见、退回原因或处理说明" />
        </Space>
      </Modal>

      <Modal
        title={reviewNext ? `审核操作：${reviewNext}` : '审核操作'}
        open={reviewOpen}
        onCancel={() => { setReviewOpen(false); setReviewRow(null); }}
        onOk={() => void submitReview()}
        confirmLoading={reviewing}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            平台订单：{reviewRow?.platform_order_id || '-'} ｜ 当前状态：{reviewRow ? String(reviewRow[config.statusField] || '-') : '-'}
          </Typography.Text>
          <Input.TextArea
            rows={4}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="审核意见、退回原因或处理说明"
          />
        </Space>
      </Modal>
    </div>
  );
}
