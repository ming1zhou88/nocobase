import { App, Button, Card, Col, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const COLLECTION = 'v_TrackingExceptionHandlingDetail';
const FIELDS = [
  'id',
  'store_name',
  'order_id',
  'sub_order_id',
  'tracking_number',
  'carrier',
  'handler_name',
  'handle_status',
  'handle_result',
  'action_type',
  'action_note',
  'action_at',
  'result_at',
  'delivered_at',
  'closed_at',
  'premature_label',
  'recovery_days',
  'contact_target',
  'refund_amount',
  'refund_currency',
  'resend_tracking_number',
  'claim_record_no',
];

type Row = Record<string, any>;

type DetailFilters = {
  carrier: string;
  premature: string;
  handler: string;
  actionType: string;
  status: string;
  keyword: string;
  exceptionId: string;
};

const CARRIER_OPTIONS = [
  { label: '全部物流商', value: 'all' },
  { label: 'FedEx', value: 'FedEx' },
  { label: 'UPS', value: 'UPS' },
  { label: '其他', value: '其他' },
];

const PREMATURE_OPTIONS = [
  { label: '全部处理判定', value: 'all' },
  { label: '正常', value: '正常' },
  { label: '过早处理', value: '过早处理' },
];

const ACTION_OPTIONS = [
  { label: '全部行动', value: 'all' },
  { label: '跟踪', value: 'tracking' },
  { label: '联系仓库', value: 'contacted_warehouse' },
  { label: '补寄', value: 'reship' },
  { label: '退款', value: 'refund' },
  { label: '关闭', value: 'close' },
  { label: '其他', value: 'other' },
];

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: 'pending', value: 'pending' },
  { label: 'closed', value: 'closed' },
  { label: '跟踪中', value: '跟踪中' },
];

function initialFilters(): DetailFilters {
  const query = new URLSearchParams(window.location.search);
  const tracking = query.get('tracking_number') || '';
  const order = query.get('order_id') || '';
  return {
    carrier: query.get('carrier') || 'all',
    premature: query.get('premature_label') || 'all',
    handler: query.get('handler_name') || '',
    actionType: query.get('action_type') || 'all',
    status: query.get('handle_status') || 'all',
    keyword: tracking || order,
    exceptionId: query.get('exception_id') || '',
  };
}

function formatTime(value: unknown) {
  if (!value) return '-';
  const text = String(value);
  return dayjs(text).isValid() ? dayjs(text).format('YYYY-MM-DD HH:mm:ss') : text;
}

export default function HandlingDetailPage() {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<DetailFilters>(() => initialFilters());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await ctx.api.request({
        url: `${COLLECTION}:list`,
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params: {
          pageSize: 2000,
          sort: ['-action_at', '-id'],
          fields: FIELDS.join(','),
        },
      });
      const body = response?.data?.data ?? response?.data ?? [];
      setRows(Array.isArray(body) ? body : body?.data ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [ctx, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.exceptionId && String(row.id) !== String(filters.exceptionId)) return false;
      if (filters.carrier !== 'all' && row.carrier !== filters.carrier) return false;
      if (filters.premature !== 'all' && row.premature_label !== filters.premature) return false;
      if (filters.actionType !== 'all' && row.action_type !== filters.actionType) return false;
      if (filters.status !== 'all' && row.handle_status !== filters.status) return false;
      if (
        filters.handler &&
        !String(row.handler_name || '')
          .toLowerCase()
          .includes(filters.handler.toLowerCase())
      ) {
        return false;
      }
      if (!keyword) return true;
      return [
        row.store_name,
        row.order_id,
        row.sub_order_id,
        row.tracking_number,
        row.handler_name,
        row.action_note,
        row.close_reason,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [filters, rows]);

  const summary = useMemo(() => {
    let reship = 0;
    let refund = 0;
    let closed = 0;
    let claims = 0;
    const refundAmounts = new Map<string, number>();
    for (const row of filteredRows) {
      const actionType = String(row.action_type || '');
      const result = String(row.handle_result || '');
      if (actionType === 'reship' || result.includes('补寄') || row.resend_tracking_number) reship += 1;
      if (actionType === 'refund' || result.includes('退款')) refund += 1;
      if (actionType === 'close' || String(row.handle_status || '') === 'closed') closed += 1;
      if (row.claim_record_no) claims += 1;
      if (row.refund_amount != null && Number.isFinite(Number(row.refund_amount))) {
        const currency = String(row.refund_currency || 'CNY');
        refundAmounts.set(currency, (refundAmounts.get(currency) || 0) + Number(row.refund_amount));
      }
    }
    return {
      reship,
      refund,
      closed,
      claims,
      refundAmount: Array.from(refundAmounts.entries())
        .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
        .join(' / '),
    };
  }, [filteredRows]);

  const update = (key: keyof DetailFilters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const columns = [
    { title: '店铺', dataIndex: 'store_name', width: 120, ellipsis: true, render: (value: string) => value || '-' },
    {
      title: '平台订单编号',
      dataIndex: 'order_id',
      width: 180,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '子订单编号',
      dataIndex: 'sub_order_id',
      width: 190,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '运单号',
      dataIndex: 'tracking_number',
      width: 165,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '物流商',
      dataIndex: 'carrier',
      width: 85,
      render: (value: string) => (
        <Tag color={value === 'FedEx' ? 'blue' : value === 'UPS' ? 'purple' : 'default'}>{value || '-'}</Tag>
      ),
    },
    { title: '处理人', dataIndex: 'handler_name', width: 90, render: (value: string) => value || '-' },
    { title: '处理状态', dataIndex: 'handle_status', width: 95, render: (value: string) => value || '-' },
    { title: '处理结果', dataIndex: 'handle_result', width: 110, render: (value: string) => value || '-' },
    { title: '行动类型', dataIndex: 'action_type', width: 100, render: (value: string) => value || '-' },
    {
      title: '行动说明',
      dataIndex: 'action_note',
      width: 220,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    { title: '行动时间', dataIndex: 'action_at', width: 155, render: formatTime },
    { title: '结果时间', dataIndex: 'result_at', width: 155, render: formatTime },
    { title: '妥投时间', dataIndex: 'delivered_at', width: 155, render: formatTime },
    { title: '关闭时间', dataIndex: 'closed_at', width: 155, render: formatTime },
    {
      title: '处理判定',
      dataIndex: 'premature_label',
      width: 95,
      render: (value: string) => <Tag color={value === '过早处理' ? 'red' : 'green'}>{value || '-'}</Tag>,
    },
    {
      title: '补寄运单号',
      dataIndex: 'resend_tracking_number',
      width: 165,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '退款金额',
      dataIndex: 'refund_amount',
      width: 110,
      render: (value: number, row: Row) =>
        value == null ? '-' : `${row.refund_currency || ''} ${Number(value).toFixed(2)}`,
    },
    {
      title: '索赔记录',
      dataIndex: 'claim_record_no',
      width: 130,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '恢复天数',
      dataIndex: 'recovery_days',
      width: 90,
      render: (value: number) => (value == null ? '-' : `${value} 天`),
    },
  ];

  return (
    <div style={{ padding: 24, boxSizing: 'border-box' }}>
      <Space align="center" wrap style={{ marginBottom: 12 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          快递异常处理明细
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
        <Button onClick={() => window.open('/v/admin/tracking-exception/workbench', '_self')}>
          返回快递异常工作台
        </Button>
      </Space>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            value={filters.carrier}
            style={{ width: 130 }}
            onChange={(value) => update('carrier', value)}
            options={CARRIER_OPTIONS}
          />
          <Select
            value={filters.premature}
            style={{ width: 145 }}
            onChange={(value) => update('premature', value)}
            options={PREMATURE_OPTIONS}
          />
          <Select
            value={filters.actionType}
            style={{ width: 130 }}
            onChange={(value) => update('actionType', value)}
            options={ACTION_OPTIONS}
          />
          <Select
            value={filters.status}
            style={{ width: 120 }}
            onChange={(value) => update('status', value)}
            options={STATUS_OPTIONS}
          />
          <Input
            allowClear
            value={filters.handler}
            onChange={(event) => update('handler', event.target.value)}
            placeholder="处理人"
            style={{ width: 130 }}
          />
          <Input
            allowClear
            value={filters.keyword}
            onChange={(event) => update('keyword', event.target.value)}
            placeholder="订单号 / 运单号 / 店铺 / 行动说明"
            style={{ width: 300 }}
          />
          <Button
            onClick={() =>
              setFilters({
                carrier: 'all',
                premature: 'all',
                handler: '',
                actionType: 'all',
                status: 'all',
                keyword: '',
                exceptionId: '',
              })
            }
          >
            重置
          </Button>
        </Space>
      </Card>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="处理明细" value={filteredRows.length} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="补寄" value={summary.reship} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="退款" value={summary.refund} valueStyle={{ color: '#d46b08' }} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="关闭" value={summary.closed} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="索赔记录" value={summary.claims} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="退款金额" value={summary.refundAmount || '-'} />
          </Card>
        </Col>
      </Row>
      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={filteredRows}
          columns={columns}
          scroll={{ x: 2250 }}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 行` }}
        />
      </Card>
    </div>
  );
}
