import { CalendarOutlined } from '@ant-design/icons';
import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button, DatePicker, Modal, Select, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';

let memoryScope: 'all' | 'mine' = 'all';
let memoryStatus = 'all';
let memoryRange: [string, string] | null = null;

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '待处理', value: '待处理' },
  { label: '持续跟踪', value: '持续跟踪' },
  { label: '已处理', value: '已处理' },
];

const DATE_FORMAT = 'YYYY-MM-DD HH:mm';

function DailyScopeFilter({ model }: { model: DailyScopeFilterActionModel }) {
  const ctx = useFlowContext();
  const [scope, setScope] = useState<'all' | 'mine'>(memoryScope);
  const [status, setStatus] = useState(memoryStatus);
  const [range, setRange] = useState<[string, string] | null>(memoryRange);
  const [dateOpen, setDateOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<string | null>(memoryRange?.[0] || null);
  const [draftEnd, setDraftEnd] = useState<string | null>(memoryRange?.[1] || null);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    const parent = (ctx.model as any)?.parent;
    return parent?.resource ? parent : context.blockModel || parent;
  }

  async function apply(nextScope: 'all' | 'mine', nextStatus: string, nextRange: [string, string] | null) {
    const blockModel = getBlockModel();
    const resource = blockModel?.resource;
    if (!resource) return;
    try {
      resource.removeFilterGroup?.('daily-scope');
      const filter: Record<string, any> = {};
      const userId = Number((ctx as any).user?.id);
      if (nextScope === 'mine' && Number.isInteger(userId)) {
        filter.owner_id = { $eq: userId };
      }
      if (nextStatus !== 'all') {
        filter.handle_status = { $eq: nextStatus };
      }
      if (nextRange?.[0] && nextRange?.[1]) {
        filter.last_received_time = { $gte: nextRange[0], $lte: nextRange[1] };
      }
      if (Object.keys(filter).length) {
        resource.addFilterGroup?.('daily-scope', filter);
      } else {
        resource.setFilter?.({});
      }
      await resource.refresh?.();
    } catch {
      // 筛选失败时保持当前页面状态，避免整页报错
    }
  }

  function resetAll() {
    memoryScope = 'all';
    memoryStatus = 'all';
    memoryRange = null;
    setScope('all');
    setStatus('all');
    setRange(null);
    void apply('all', 'all', null);
  }

  function openDate() {
    setDraftStart(range?.[0] || null);
    setDraftEnd(range?.[1] || null);
    setDateOpen(true);
  }

  function quickRange(days: number) {
    const end = dayjs();
    const start = end.subtract(days - 1, 'day').startOf('day');
    setDraftStart(start.format(DATE_FORMAT));
    setDraftEnd(end.format(DATE_FORMAT));
  }

  function confirmDate() {
    if (!draftStart || !draftEnd) {
      memoryRange = null;
      setRange(null);
      setDateOpen(false);
      void apply(scope, status, null);
      return;
    }
    if (dayjs(draftEnd).isBefore(dayjs(draftStart))) {
      return;
    }
    const next: [string, string] = [draftStart, draftEnd];
    memoryRange = next;
    setRange(next);
    setDateOpen(false);
    void apply(scope, status, next);
  }

  function clearDate() {
    setDraftStart(null);
    setDraftEnd(null);
  }

  const rangeLabel = range
    ? `${dayjs(range[0]).format('MM-DD HH:mm')} ~ ${dayjs(range[1]).format('MM-DD HH:mm')}`
    : '收件时间';

  return (
    <>
      <Space size="small" wrap>
        <Button
          type={scope === 'all' ? 'primary' : 'default'}
          onClick={() => {
            memoryScope = 'all';
            setScope('all');
            void apply('all', status, range);
          }}
        >
          全部数据
        </Button>
        <Button
          type={scope === 'mine' ? 'primary' : 'default'}
          onClick={() => {
            memoryScope = 'mine';
            setScope('mine');
            void apply('mine', status, range);
          }}
        >
          我的数据
        </Button>
        <Select
          value={status}
          style={{ width: 130 }}
          options={STATUS_OPTIONS}
          onChange={(value) => {
            memoryStatus = value;
            setStatus(value);
            void apply(scope, value, range);
          }}
        />
        <Button icon={<CalendarOutlined />} onClick={openDate}>
          {rangeLabel}
        </Button>
        <Button onClick={resetAll}>重置</Button>
      </Space>
      <Modal
        open={dateOpen}
        title="按最新收件时间筛选"
        okText="确定"
        cancelText="取消"
        onCancel={() => setDateOpen(false)}
        onOk={confirmDate}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">开始时间</Typography.Text>
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format={DATE_FORMAT}
              minuteStep={30}
              style={{ width: '100%', marginTop: 4 }}
              value={draftStart ? dayjs(draftStart) : null}
              onChange={(value) => setDraftStart(value ? value.format(DATE_FORMAT) : null)}
            />
          </div>
          <div>
            <Typography.Text type="secondary">结束时间</Typography.Text>
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format={DATE_FORMAT}
              minuteStep={30}
              style={{ width: '100%', marginTop: 4 }}
              value={draftEnd ? dayjs(draftEnd) : null}
              onChange={(value) => setDraftEnd(value ? value.format(DATE_FORMAT) : null)}
            />
          </div>
          <Space wrap>
            <Button size="small" onClick={() => quickRange(1)}>
              今天
            </Button>
            <Button size="small" onClick={() => quickRange(7)}>
              近 7 天
            </Button>
            <Button size="small" onClick={() => quickRange(30)}>
              近 30 天
            </Button>
            <Button size="small" onClick={clearDate}>
              清空
            </Button>
          </Space>
          {draftStart && draftEnd && dayjs(draftEnd).isBefore(dayjs(draftStart)) ? (
            <Typography.Text type="danger">结束时间不能早于开始时间</Typography.Text>
          ) : null}
        </Space>
      </Modal>
    </>
  );
}

export class DailyScopeFilterActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;

  render() {
    return <DailyScopeFilter model={this} />;
  }
}

DailyScopeFilterActionModel.define({ label: '数据范围与状态筛选' });
