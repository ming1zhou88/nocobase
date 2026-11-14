import { App, Button, Card, Col, DatePicker, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const COLLECTION = 'v_TrackingExceptionRecoveryDetail';
const FIELDS = [
  'id',
  'store_name',
  'order_id',
  'sub_order_id',
  'tracking_number',
  'carrier',
  'handler_name',
  'handle_status',
  'exception_started_at',
  'exception_recovered_at',
  'result_at',
  'delivered_at',
  'closed_at',
  'premature_label',
  'recovery_days',
];
type Row = Record<string, any>;
type Filters = {
  startDate: string;
  endDate: string;
  carrier: string;
  premature: string;
  handler: string;
  keyword: string;
};

const CARRIER_OPTIONS = [
  { label: '全部物流商', value: 'all' },
  { label: 'FedEx', value: 'FedEx' },
  { label: 'UPS', value: 'UPS' },
  { label: '其他', value: '其他' },
];
const PREMATURE_OPTIONS = [
  { label: '全部判定', value: 'all' },
  { label: '正常', value: '正常' },
  { label: '过早处理', value: '过早处理' },
];
function time(value: unknown) {
  if (!value) return '-';
  const d = dayjs(String(value));
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value);
}

export default function RecoveryDetailPage() {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    startDate: '',
    endDate: '',
    carrier: 'all',
    premature: 'all',
    handler: '',
    keyword: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await ctx.api.request({
        url: `${COLLECTION}:list`,
        method: 'get',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        params: { pageSize: 3000, sort: ['-exception_recovered_at', '-id'], fields: FIELDS.join(',') },
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
      const recovered = row.exception_recovered_at || row.closed_at;
      if (filters.startDate && (!recovered || dayjs(recovered).isBefore(dayjs(filters.startDate).startOf('day'))))
        return false;
      if (filters.endDate && (!recovered || dayjs(recovered).isAfter(dayjs(filters.endDate).endOf('day'))))
        return false;
      if (filters.carrier !== 'all' && row.carrier !== filters.carrier) return false;
      if (filters.premature !== 'all' && row.premature_label !== filters.premature) return false;
      if (
        filters.handler &&
        !String(row.handler_name || '')
          .toLowerCase()
          .includes(filters.handler.toLowerCase())
      )
        return false;
      if (!keyword) return true;
      return [row.store_name, row.order_id, row.sub_order_id, row.tracking_number, row.handler_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [filters, rows]);

  const summary = useMemo(() => {
    const values = filteredRows.map((row) => Number(row.recovery_days)).filter((value) => Number.isFinite(value));
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return {
      average,
      premature: filteredRows.filter((row) => row.premature_label === '过早处理').length,
      short: values.filter((value) => value <= 3).length,
    };
  }, [filteredRows]);

  const setFilter = (key: keyof Filters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const columns = [
    { title: '店铺', dataIndex: 'store_name', width: 130, ellipsis: true, render: (v: string) => v || '-' },
    { title: '平台订单编号', dataIndex: 'order_id', width: 180, ellipsis: true, render: (v: string) => v || '-' },
    { title: '子订单编号', dataIndex: 'sub_order_id', width: 190, ellipsis: true, render: (v: string) => v || '-' },
    { title: '运单号', dataIndex: 'tracking_number', width: 165, ellipsis: true, render: (v: string) => v || '-' },
    {
      title: '物流商',
      dataIndex: 'carrier',
      width: 85,
      render: (v: string) => <Tag color={v === 'FedEx' ? 'blue' : v === 'UPS' ? 'purple' : 'default'}>{v || '-'}</Tag>,
    },
    { title: '处理人', dataIndex: 'handler_name', width: 90, render: (v: string) => v || '-' },
    { title: '异常开始', dataIndex: 'exception_started_at', width: 155, render: time },
    { title: '恢复时间', dataIndex: 'exception_recovered_at', width: 155, render: time },
    { title: '结果时间', dataIndex: 'result_at', width: 155, render: time },
    { title: '妥投时间', dataIndex: 'delivered_at', width: 155, render: time },
    { title: '关闭时间', dataIndex: 'closed_at', width: 155, render: time },
    {
      title: '恢复天数',
      dataIndex: 'recovery_days',
      width: 95,
      sorter: (a: Row, b: Row) => Number(a.recovery_days) - Number(b.recovery_days),
      render: (v: number) => (v == null ? '-' : `${v} 天`),
    },
    {
      title: '处理判定',
      dataIndex: 'premature_label',
      width: 100,
      render: (v: string) => <Tag color={v === '过早处理' ? 'red' : 'green'}>{v || '-'}</Tag>,
    },
  ];

  return (
    <div style={{ padding: 24, boxSizing: 'border-box' }}>
      <Space align="center" wrap style={{ marginBottom: 12 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          快递异常恢复周期
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
            placeholder={['恢复开始日期', '恢复结束日期']}
          />
          <Select
            value={filters.carrier}
            style={{ width: 130 }}
            onChange={(value) => setFilter('carrier', value)}
            options={CARRIER_OPTIONS}
          />
          <Select
            value={filters.premature}
            style={{ width: 130 }}
            onChange={(value) => setFilter('premature', value)}
            options={PREMATURE_OPTIONS}
          />
          <Input
            allowClear
            value={filters.handler}
            onChange={(e) => setFilter('handler', e.target.value)}
            placeholder="处理人"
            style={{ width: 130 }}
          />
          <Input
            allowClear
            value={filters.keyword}
            onChange={(e) => setFilter('keyword', e.target.value)}
            placeholder="订单号 / 运单号 / 店铺"
            style={{ width: 300 }}
          />
          <Button
            onClick={() =>
              setFilters({ startDate: '', endDate: '', carrier: 'all', premature: 'all', handler: '', keyword: '' })
            }
          >
            重置
          </Button>
        </Space>
      </Card>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="恢复行数" value={filteredRows.length} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="平均恢复天数" value={summary.average == null ? '-' : summary.average.toFixed(1)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="过早处理" value={summary.premature} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="3 天内恢复" value={summary.short} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
      </Row>
      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={filteredRows}
          columns={columns}
          scroll={{ x: 2100 }}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 行` }}
        />
      </Card>
    </div>
  );
}
