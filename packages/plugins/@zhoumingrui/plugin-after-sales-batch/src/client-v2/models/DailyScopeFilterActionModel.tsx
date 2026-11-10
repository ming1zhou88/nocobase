import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button, DatePicker, Select, Space } from 'antd';
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

function DailyScopeFilter({ model }: { model: DailyScopeFilterActionModel }) {
  const ctx = useFlowContext();
  const [scope, setScope] = useState<'all' | 'mine'>(memoryScope);
  const [status, setStatus] = useState(memoryStatus);
  const [range, setRange] = useState<[string, string] | null>(memoryRange);
  const [loading, setLoading] = useState(false);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    const parent = (ctx.model as any)?.parent;
    return parent?.resource ? parent : context.blockModel || parent;
  }

  async function apply(
    nextScope: 'all' | 'mine',
    nextStatus: string,
    nextRange: [string, string] | null,
    refreshOnly = false,
  ) {
    const blockModel = getBlockModel();
    const resource = blockModel?.resource;
    if (!resource) return;
    setLoading(true);
    try {
      resource.removeFilterGroup?.('daily-scope');
      if (!refreshOnly) {
        const filter: Record<string, any> = {};
        const userId = Number((ctx as any).user?.id);
        if (nextScope === 'mine' && Number.isInteger(userId)) {
          filter.owner_id = { $eq: userId };
        }
        if (nextStatus !== 'all') {
          filter.handle_status = { $eq: nextStatus };
        }
        if (nextRange?.[0] && nextRange?.[1]) {
          filter.last_received_time = {
            $gte: `${nextRange[0]} 00:00:00`,
            $lte: `${nextRange[1]} 23:59:59`,
          };
        }
        if (Object.keys(filter).length) {
          resource.addFilterGroup?.('daily-scope', filter);
        } else {
          resource.setFilter?.({});
        }
      }
      await resource.refresh?.();
    } finally {
      setLoading(false);
    }
  }

  return (
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
      <DatePicker.RangePicker
        value={range ? [dayjs(range[0]), dayjs(range[1])] : null}
        allowClear
        placeholder={['最新收件开始', '最新收件结束']}
        onChange={(values) => {
          const next: [string, string] | null =
            values?.[0] && values?.[1] ? [values[0].format('YYYY-MM-DD'), values[1].format('YYYY-MM-DD')] : null;
          memoryRange = next;
          setRange(next);
          void apply(scope, status, next);
        }}
      />
      <Button loading={loading} onClick={() => void apply(scope, status, range, true)}>
        刷新
      </Button>
    </Space>
  );
}

export class DailyScopeFilterActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;

  render() {
    return <DailyScopeFilter model={this} />;
  }
}

DailyScopeFilterActionModel.define({ label: '数据范围与状态筛选' });
