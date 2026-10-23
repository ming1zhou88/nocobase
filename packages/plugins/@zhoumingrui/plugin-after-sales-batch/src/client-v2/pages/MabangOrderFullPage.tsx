import { Button, Card, DatePicker, Input, Space, Table, Typography } from 'antd';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useState } from 'react';

/** 马帮完整订单（四表合一视图，字段清单见飞书《视图样表》） */
const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const COLLECTION = 'v_MabangOrderFull';
const ROUTE = '/admin/mabang-order/full';

type Row = Record<string, any>;

/** 34 个业务字段，按「订单 / 产品 / 快递」三组排列 */
const COLUMN_GROUPS: Array<Array<{ title: string; dataIndex: string; ellipsis?: boolean }>> = [
  [
    { title: '店铺', dataIndex: 'store-name' },
    { title: '平台订单号', dataIndex: 'order-id' },
    { title: '仓库子单号', dataIndex: 'order-id-in-warehouse' },
    { title: '下单/付款时间', dataIndex: 'purchase-date' },
    { title: '订单状态', dataIndex: 'order-status' },
    { title: '收货地址1', dataIndex: 'ship-address-1' },
    { title: '收货地址2', dataIndex: 'ship-address-2' },
    { title: '城市', dataIndex: 'ship-city' },
    { title: '州', dataIndex: 'ship-state' },
    { title: '邮编', dataIndex: 'ship-postal-code' },
    { title: '买家邮箱', dataIndex: 'email-address' },
    { title: '最迟发货', dataIndex: 'ship-by' },
    { title: '平台到达时间', dataIndex: 'delivery-by' },
    { title: '发货时间', dataIndex: 'operate-shipment' },
  ],
  [
    { title: 'MSKU', dataIndex: 'msku' },
    { title: 'MSKU 数量', dataIndex: 'msku-quantity' },
    { title: '库存 SKU', dataIndex: 'sku-in-stock' },
    { title: '库存 SKU 数量', dataIndex: 'sku-in-stock-quantity' },
    { title: '发货仓库', dataIndex: 'warehouse-name' },
  ],
  [
    { title: '是否全部送达', dataIndex: 'is_fully_delivered' },
    { title: '运单号', dataIndex: 'tracking-number' },
    { title: '快递发货日', dataIndex: 'ShipDate' },
    { title: '发货地', dataIndex: 'ShipperCity_State' },
    { title: '收货地', dataIndex: 'RecipientCity_State' },
    { title: '快递状态', dataIndex: 'Status' },
    { title: '状态补充', dataIndex: 'AdditionalStatus' },
    { title: '运输轨迹', dataIndex: 'TravelHistory', ellipsis: true },
    { title: '运输天数', dataIndex: 'DaysOfTransit' },
    { title: '停留天数', dataIndex: 'DaysOfStalled' },
    { title: '未上线天数', dataIndex: 'DaysBeforeOnline' },
    { title: '实际送达', dataIndex: 'DeliveredDate' },
    { title: '预计送达', dataIndex: 'ScheduledDeliveryDate' },
    { title: '预估在途前期天数', dataIndex: 'estimated_days_before_transit' },
    { title: '更新时间', dataIndex: 'UpdateTime' },
  ],
];

const columns = COLUMN_GROUPS.flat().map((col) => ({ ...col, key: col.dataIndex }));

export default function MabangOrderFullPage() {
  const ctx = useFlowContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [singleOrderId, setSingleOrderId] = useState('');
  const [multiOrderIds, setMultiOrderIds] = useState('');
  const [dateRange, setDateRange] = useState<any>(null);

  /** 三类筛选：单订单号 / 多订单号 / 下单日期区间，彼此取 OR */
  const buildFilter = useCallback(() => {
    const conditions: Row[] = [];
    if (singleOrderId.trim()) {
      conditions.push({ 'order-id': { $eq: singleOrderId.trim() } });
    }
    const ids = multiOrderIds
      .split(/[\s,，;；]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (ids.length) {
      conditions.push({ 'order-id': { $in: ids } });
    }
    if (dateRange && dateRange[0] && dateRange[1]) {
      conditions.push({
        'purchase-date': {
          $dateBetween: [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')],
        },
      });
    }
    if (!conditions.length) {
      return undefined;
    }
    return conditions.length === 1 ? conditions[0] : { $or: conditions };
  }, [singleOrderId, multiOrderIds, dateRange]);

  const load = useCallback(
    async (nextPage = page, nextPageSize = pageSize) => {
      setLoading(true);
      try {
        const filter = buildFilter();
        const response = await ctx.api.request({
          url: `${COLLECTION}:list`,
          method: 'get',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          params: {
            page: nextPage,
            pageSize: nextPageSize,
            sort: 'order-id',
            ...(filter ? { filter: JSON.stringify(filter) } : {}),
          },
        });
        const data = response?.data?.data ?? [];
        setRows(Array.isArray(data) ? data : []);
        setTotal(Number(response?.data?.meta?.count ?? 0));
      } finally {
        setLoading(false);
      }
    },
    [ctx, buildFilter, page, pageSize],
  );

  useEffect(() => {
    load(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card title="马帮完整订单" variant="borderless">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          {`路由：${ROUTE} ｜ 数据源：${DATA_SOURCE_KEY} ｜ 视图：${COLLECTION}（四表合一，已去重并剔除作废行）`}
        </Typography.Text>
        <Space wrap>
          <Input
            allowClear
            style={{ width: 260 }}
            placeholder="单个平台订单号（精确）"
            value={singleOrderId}
            onChange={(event) => setSingleOrderId(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              load(1, pageSize);
            }}
          />
          <Input
            allowClear
            style={{ width: 360 }}
            placeholder="多个订单号（逗号/空格/换行分隔，可粘贴一列）"
            value={multiOrderIds}
            onChange={(event) => setMultiOrderIds(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              load(1, pageSize);
            }}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(value) => setDateRange(value)}
            placeholder={['下单日期起', '下单日期止']}
          />
          <Button
            type="primary"
            onClick={() => {
              setPage(1);
              load(1, pageSize);
            }}
          >
            查询
          </Button>
          <Button
            onClick={() => {
              setSingleOrderId('');
              setMultiOrderIds('');
              setDateRange(null);
              setPage(1);
              load(1, pageSize);
            }}
          >
            重置
          </Button>
        </Space>
        <Table<Row>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns as any}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100'],
            showTotal: (value) => `共 ${value} 行`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
              load(nextPage, nextPageSize);
            },
          }}
        />
      </Space>
    </Card>
  );
}
