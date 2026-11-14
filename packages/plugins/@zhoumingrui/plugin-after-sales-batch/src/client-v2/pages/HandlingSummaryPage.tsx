import { App, Button, Card, Col, DatePicker, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const COLLECTION = 'v_TrackingExceptionActionSummary';
const FIELDS = [
  'action_id',
  'exception_id',
  'action_date',
  'action_type',
  'action_status',
  'action_at',
  'action_note',
  'operator_name',
  'refund_amount',
  'refund_currency',
  'resend_tracking_number',
  'claim_record_no',
  'store_name',
  'order_id',
  'tracking_number',
  'handler_name',
  'handle_status',
  'handle_result',
];

type Row = Record<string, any>;
type Filters = { startDate: string; endDate: string; store: string; handler: string; actionType: string };

const ACTION_OPTIONS = [
  { label: '全部行动', value: 'all' },
  { label: '跟踪', value: 'tracking' },
  { label: '联系仓库', value: 'contacted_warehouse' },
  { label: '补寄', value: 'reship' },
  { label: '退款', value: 'refund' },
  { label: '关闭', value: 'close' },
  { label: '其他', value: 'other' },
];

function formatTime(value: unknown) {
  if (!value) return '-';
  const date = dayjs(String(value));
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : String(value);
}

export default function HandlingSummaryPage() {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    startDate: '',
    endDate: '',
    store: '',
    handler: '',
    actionType: 'all',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await ctx.api.request({
        url: `${COLLECTION}:list`,
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params: { pageSize: 2000, sort: ['-action_at', '-action_id'], fields: FIELDS.join(',') },
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
    return rows.filter((row) => {
      const actionAt = row.action_at ? dayjs(row.action_at) : null;
      if (filters.startDate && (!actionAt || actionAt.isBefore(dayjs(filters.startDate).startOf('day')))) return false;
      if (filters.endDate && (!actionAt || actionAt.isAfter(dayjs(filters.endDate).endOf('day')))) return false;
      if (
        filters.store &&
        !String(row.store_name || '')
          .toLowerCase()
          .includes(filters.store.toLowerCase())
      )
        return false;
      if (
        filters.handler &&
        !String(row.handler_name || '')
          .toLowerCase()
          .includes(filters.handler.toLowerCase())
      ) {
        return false;
      }
      if (filters.actionType !== 'all' && row.action_type !== filters.actionType) return false;
      return true;
    });
  }, [filters, rows]);

  const summary = useMemo(() => {
    let reship = 0;
    let refund = 0;
    let closed = 0;
    let claims = 0;
    const refundAmounts = new Map<string, number>();
    for (const row of filteredRows) {
      if (row.action_type === 'reship' || row.resend_tracking_number) reship += 1;
      if (row.action_type === 'refund' || String(row.handle_result || '').includes('退款')) refund += 1;
      if (row.action_type === 'close') closed += 1;
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
        .map(([c, n]) => `${c} ${n.toFixed(2)}`)
        .join(' / '),
    };
  }, [filteredRows]);

  const summaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        date: string;
        store: string;
        total: number;
        reship: number;
        refund: number;
        closed: number;
        claims: number;
      }
    >();
    for (const row of filteredRows) {
      const date = String(row.action_date || '').slice(0, 10) || '-';
      const store = String(row.store_name || '-');
      const key = `${date}|${store}`;
      if (!map.has(key)) map.set(key, { key, date, store, total: 0, reship: 0, refund: 0, closed: 0, claims: 0 });
      const item = map.get(key)!;
      item.total += 1;
      if (row.action_type === 'reship' || row.resend_tracking_number) item.reship += 1;
      if (row.action_type === 'refund' || String(row.handle_result || '').includes('退款')) item.refund += 1;
      if (row.action_type === 'close') item.closed += 1;
      if (row.claim_record_no) item.claims += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date) || a.store.localeCompare(b.store));
  }, [filteredRows]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div style={{ padding: 24, boxSizing: 'border-box' }}>
      <Space align="center" wrap style={{ marginBottom: 12 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          快递异常处理汇总
        </Typography.Title>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          刷新
        </Button>
        <Button onClick={() => window.open('/v/admin/tracking-exception/workbench', '_self')}>
          返回快递异常工作台
        </Button>
      </Space>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <DatePicker.RangePicker
            value={[
              filters.startDate ? dayjs(filters.startDate) : null,
              filters.endDate ? dayjs(filters.endDate) : null,
            ]}
            onChange={(values) => {
              setFilter('startDate', values?.[0] ? values[0].format('YYYY-MM-DD') : '');
              setFilter('endDate', values?.[1] ? values[1].format('YYYY-MM-DD') : '');
            }}
            placeholder={['行动开始日期', '行动结束日期']}
          />
          <Input
            allowClear
            value={filters.store}
            onChange={(e) => setFilter('store', e.target.value)}
            placeholder="店铺"
            style={{ width: 140 }}
          />
          <Input
            allowClear
            value={filters.handler}
            onChange={(e) => setFilter('handler', e.target.value)}
            placeholder="处理人"
            style={{ width: 130 }}
          />
          <Select
            value={filters.actionType}
            onChange={(value) => setFilter('actionType', value)}
            options={ACTION_OPTIONS}
            style={{ width: 130 }}
          />
          <Button onClick={() => setFilters({ startDate: '', endDate: '', store: '', handler: '', actionType: 'all' })}>
            重置
          </Button>
        </Space>
      </Card>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={4}>
          <Card size="small">
            <Statistic title="行动记录" value={filteredRows.length} />
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
      <Card title="按日期 / 店铺汇总" size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Table
          rowKey="key"
          size="small"
          dataSource={summaryRows}
          pagination={false}
          columns={[
            { title: '行动日期', dataIndex: 'date', width: 120 },
            { title: '店铺', dataIndex: 'store', width: 180, ellipsis: true },
            { title: '行动记录', dataIndex: 'total', width: 100 },
            { title: '补寄', dataIndex: 'reship', width: 90 },
            { title: '退款', dataIndex: 'refund', width: 90 },
            { title: '关闭', dataIndex: 'closed', width: 90 },
            { title: '索赔记录', dataIndex: 'claims', width: 100 },
          ]}
        />
      </Card>
      <Card title="行动明细" size="small" styles={{ body: { padding: 12 } }}>
        <Table
          rowKey="action_id"
          size="small"
          loading={loading}
          dataSource={filteredRows}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            { title: '行动时间', dataIndex: 'action_at', width: 155, render: formatTime },
            { title: '店铺', dataIndex: 'store_name', width: 140, ellipsis: true, render: (v: string) => v || '-' },
            {
              title: '平台订单编号',
              dataIndex: 'order_id',
              width: 180,
              ellipsis: true,
              render: (v: string) => v || '-',
            },
            {
              title: '运单号',
              dataIndex: 'tracking_number',
              width: 165,
              ellipsis: true,
              render: (v: string) => v || '-',
            },
            { title: '处理人', dataIndex: 'handler_name', width: 90, render: (v: string) => v || '-' },
            { title: '行动类型', dataIndex: 'action_type', width: 100, render: (v: string) => v || '-' },
            {
              title: '行动说明',
              dataIndex: 'action_note',
              width: 260,
              ellipsis: true,
              render: (v: string) => v || '-',
            },
            { title: '操作人', dataIndex: 'operator_name', width: 90, render: (v: string) => v || '-' },
            {
              title: '退款金额',
              dataIndex: 'refund_amount',
              width: 110,
              render: (v: number, r: Row) => (v == null ? '-' : `${r.refund_currency || ''} ${Number(v).toFixed(2)}`),
            },
            {
              title: '补寄运单号',
              dataIndex: 'resend_tracking_number',
              width: 165,
              ellipsis: true,
              render: (v: string) => v || '-',
            },
            {
              title: '索赔记录',
              dataIndex: 'claim_record_no',
              width: 130,
              ellipsis: true,
              render: (v: string) => v || '-',
            },
          ]}
        />
      </Card>
    </div>
  );
}
