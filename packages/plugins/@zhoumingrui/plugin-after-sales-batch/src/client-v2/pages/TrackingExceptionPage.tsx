import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useFlowContext } from '@nocobase/flow-engine';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';

/**
 * 快递异常工作台（预览版）
 *
 * 设计边界：
 *  - 不改 7D4 / D4 的查询与同步逻辑；
 *  - 只读 TrackingException7D4Full，前端计算数据质量、异常类型、已恢复标记；
 *  - 人工核实只写现有的 handle_status / handle_note / handle_updated_at，不新增字段；
 *  - 默认只显示“可用”的 12 位 FedEx 行，可疑/非 FedEx/虚拟单号需手动打开开关。
 */
const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const COLLECTION = 'TrackingException7D4Full';
const ROUTE = '/tracking-exception/workbench';
const PAGE_SIZE = 500;

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
  'handler_name',
  'handle_note',
  'handle_updated_at',
  'owner_name',
  'assign_source',
];

type Row = Record<string, any>;
type Quality = '可用' | '查询异常' | '虚拟单号' | '非FedEx' | '数据不完整' | '天数异常' | '数据过旧';
type ExceptionType = 'initial' | 'transit' | 'other';
type ExceptionState = '异常中' | '已恢复' | '待核实';

type EnrichedRow = Row & {
  _quality: Quality;
  _qualityReasons: string[];
  _type: ExceptionType;
  _state: ExceptionState;
  _startedAt?: string;
  _recoveredAt?: string;
  _ageDays: number | null;
  _isClean: boolean;
  _isRecovered: boolean;
  _needsManual: boolean;
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
  const isRecovered = delivered || noteRecovered;

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

  const startedAt = note?.startedAt;
  const recoveredAt = note?.recoveredAt || (delivered ? row.DeliveredDate : undefined);
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

  const state: ExceptionState = isRecovered ? '已恢复' : isTechnical ? '待核实' : '异常中';
  const isClean = quality === '可用' && isFedex && !isTechnical;
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
    _qualityReasons: reasons,
    _type: type,
    _state: state,
    _startedAt: startedAt,
    _recoveredAt: recoveredAt,
    _ageDays: ageDays,
    _isClean: isClean,
    _isRecovered: isRecovered,
    _needsManual: needsManual,
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
  | 'initial-3'
  | 'initial-3-7'
  | 'initial-7'
  | 'transit-3'
  | 'transit-3-7'
  | 'transit-7'
  | 'recent-30'
  | 'recovered'
  | 'manual';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'initial-3', label: '初始 3 天以上' },
  { key: 'initial-3-7', label: '初始 3–7 天' },
  { key: 'initial-7', label: '初始 7 天以上' },
  { key: 'transit-3', label: '运输 3 天以上' },
  { key: 'transit-3-7', label: '运输 3–7 天' },
  { key: 'transit-7', label: '运输 7 天以上' },
  { key: 'recent-30', label: '近 30 天' },
  { key: 'recovered', label: '已恢复' },
  { key: 'manual', label: '待人工核实' },
];

function matchFilter(row: EnrichedRow, key: FilterKey) {
  if (key === 'all') return true;
  if (key === 'recovered') return row._isRecovered;
  if (key === 'manual') return row._needsManual;
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
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuspect, setShowSuspect] = useState(false);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [selected, setSelected] = useState<EnrichedRow | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all: Row[] = [];
      let page = 1;
      let total = 0;
      do {
        const response = await ctx.api.request({
          url: `${COLLECTION}:list`,
          method: 'get',
          headers: { 'x-data-source': DATA_SOURCE_KEY },
          params: {
            page,
            pageSize: PAGE_SIZE,
            sort: '-id',
            fields: FIELDS.join(','),
          },
        });
        const data = response?.data?.data ?? [];
        total = Number(response?.data?.meta?.count ?? total ?? 0);
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

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopedRows = useMemo(() => (showSuspect ? rows : rows.filter((row) => row._isClean)), [rows, showSuspect]);

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = {
      all: 0,
      'initial-3': 0,
      'initial-3-7': 0,
      'initial-7': 0,
      'transit-3': 0,
      'transit-3-7': 0,
      'transit-7': 0,
      'recent-30': 0,
      recovered: 0,
      manual: 0,
    };
    for (const row of scopedRows) {
      for (const filter of FILTERS) {
        if (filter.key === 'manual') continue;
        if (matchFilter(row, filter.key)) result[filter.key] += 1;
      }
    }
    // 待人工核实始终按全量数据计数；否则默认“只看可用数据”时按钮永远显示 0。
    result.manual = rows.filter((row) => row._needsManual).length;
    return result;
  }, [scopedRows, rows]);

  const filteredRows = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    const filtered = scopedRows.filter((row) => {
      if (!matchFilter(row, filterKey)) return false;
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
  }, [scopedRows, filterKey, qualityFilter, keyword]);

  const stats = useMemo(() => {
    const clean = rows.filter((row) => row._isClean);
    return {
      total: rows.length,
      clean: clean.length,
      active: clean.filter((row) => row._state === '异常中').length,
      recovered: clean.filter((row) => row._isRecovered).length,
      suspect: rows.length - clean.length,
    };
  }, [rows]);

  async function saveManualCheck(action: 'recovered' | 'abnormal' | 'note') {
    if (!selected) return;
    setSaving(true);
    try {
      const now = dayjs();
      const stamp = now.format('YYYY-MM-DD HH:mm');
      const actionText = action === 'recovered' ? '已核实恢复' : action === 'abnormal' ? '仍异常' : '备注';
      const line = `[人工核实 ${stamp}] ${actionText}${manualNote.trim() ? `：${manualNote.trim()}` : ''}`;
      const note = [selected.handle_note, line].filter(Boolean).join('\n');
      const status = action === 'recovered' ? '已关闭' : action === 'abnormal' ? '持续跟踪' : selected.handle_status;
      await ctx.api.request({
        url: `${COLLECTION}:update?filterByTk=${selected.id}`,
        method: 'post',
        headers: { 'x-data-source': DATA_SOURCE_KEY },
        data: {
          handle_status: status,
          handle_note: note,
          handle_updated_at: now.format('YYYY-MM-DD HH:mm:ss'),
        },
      });
      message.success('已保存人工核实记录');
      setSelected(null);
      setManualNote('');
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
      width: 120,
      render: (value: string) => value || '-',
    },
    {
      title: '平台订单',
      dataIndex: 'order-id',
      width: 170,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '子订单',
      dataIndex: 'order-id-in-warehouse',
      width: 170,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '运单号',
      dataIndex: 'tracking-number',
      width: 150,
      render: (value: string) => <Typography.Text copyable>{value || '-'}</Typography.Text>,
    },
    {
      title: '仓库',
      dataIndex: 'warehouse-name',
      width: 170,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '异常类型',
      dataIndex: '_type',
      width: 100,
      render: (value: ExceptionType) => <Tag>{TYPE_LABEL[value]}</Tag>,
    },
    {
      title: '异常开始',
      dataIndex: '_startedAt',
      width: 150,
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
        <Tag color={value === '已恢复' ? 'green' : value === '待核实' ? 'orange' : 'red'}>{value}</Tag>
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
      title: '处理人',
      dataIndex: 'handler_name',
      width: 100,
      render: (value: string) => value || '-',
    },
    {
      title: '处理状态',
      dataIndex: 'handle_status',
      width: 110,
      render: (value: string) => value || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: 'right' as const,
      render: (_: unknown, row: EnrichedRow) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setSelected(row);
            setManualNote('');
          }}
        >
          查看/核实
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="快递异常工作台（预览）"
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
      variant="borderless"
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <style>{`.tracking-exception-recovered-row > td { background: #f6ffed !important; }`}</style>
        <Alert
          type="warning"
          showIcon
          message="当前只做页面与人工流程，未修 7D4/D4/D5 查询逻辑"
          description="默认只显示数据质量=可用的 12 位 FedEx 行；虚拟单号、非 FedEx、查询异常和天数异常需打开“显示可疑数据”后查看。等待参考值/恢复周期统计在数据链路修复前不做自动决策。"
        />

        <Space size="large" wrap>
          <Statistic title="总行数" value={stats.total} />
          <Statistic title="可用 FedEx" value={stats.clean} valueStyle={{ color: '#3f8600' }} />
          <Statistic title="异常中" value={stats.active} valueStyle={{ color: '#cf1322' }} />
          <Statistic title="已恢复" value={stats.recovered} valueStyle={{ color: '#1677ff' }} />
          <Statistic title="可疑/非FedEx" value={stats.suspect} valueStyle={{ color: '#d46b08' }} />
        </Space>

        <Space wrap>
          <Switch
            checked={showSuspect}
            onChange={(checked) => {
              setShowSuspect(checked);
              if (!checked && filterKey === 'manual') setFilterKey('all');
            }}
            checkedChildren="显示可疑数据"
            unCheckedChildren="只看可用数据"
          />
          <Select
            value={qualityFilter}
            style={{ width: 150 }}
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
            placeholder="订单号 / 子订单 / 运单号 / 店铺 / 仓库 / MSKU"
            style={{ width: 360 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Typography.Text type="secondary">
            {`路由：${ROUTE} ｜ 数据源：${DATA_SOURCE_KEY} ｜ 集合：${COLLECTION}`}
          </Typography.Text>
        </Space>

        <Space wrap>
          {FILTERS.map((filter) => (
            <Badge key={filter.key} count={counts[filter.key]} size="small" overflowCount={9999}>
              <Button
                type={filterKey === filter.key ? 'primary' : 'default'}
                size="small"
                onClick={() => {
                  setFilterKey(filter.key);
                  if (filter.key === 'manual') setShowSuspect(true);
                }}
              >
                {filter.label}
              </Button>
            </Badge>
          ))}
        </Space>

        <Table<EnrichedRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={filteredRows}
          columns={columns as any}
          scroll={{ x: 1800 }}
          rowClassName={(row) => (row._isRecovered ? 'tracking-exception-recovered-row' : '')}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100'],
            showTotal: (value) => `共 ${value} 行`,
          }}
        />
      </Space>

      <Drawer open={Boolean(selected)} width={720} title="快递异常详情 / 人工核实" onClose={() => setSelected(null)}>
        {selected ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="店铺">{selected['store-name'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="仓库">{selected['warehouse-name'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="平台订单">{selected['order-id'] || '-'}</Descriptions.Item>
              <Descriptions.Item label="子订单">{selected['order-id-in-warehouse'] || '-'}</Descriptions.Item>
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
    </Card>
  );
}
