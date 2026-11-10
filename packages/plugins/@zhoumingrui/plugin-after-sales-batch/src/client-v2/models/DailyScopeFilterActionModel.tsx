import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button, Segmented, Select, Space } from 'antd';
import React, { useState } from 'react';

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '待处理', value: '待处理' },
  { label: '持续跟踪', value: '持续跟踪' },
  { label: '已处理', value: '已处理' },
];

function DailyScopeFilter({ model }: { model: DailyScopeFilterActionModel }) {
  const ctx = useFlowContext();
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    return context.blockModel || (ctx.model as any)?.parent;
  }

  async function apply(nextScope: 'all' | 'mine', nextStatus: string, refreshOnly = false) {
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
        if (Object.keys(filter).length) {
          resource.addFilterGroup?.('daily-scope', filter);
        }
      }
      await resource.refresh?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space size="small" wrap>
      <Segmented
        value={scope}
        options={[
          { label: '全部数据', value: 'all' },
          { label: '我的数据', value: 'mine' },
        ]}
        onChange={(value) => {
          const next = value as 'all' | 'mine';
          setScope(next);
          void apply(next, status);
        }}
      />
      <Select
        value={status}
        style={{ width: 130 }}
        options={STATUS_OPTIONS}
        onChange={(value) => {
          setStatus(value);
          void apply(scope, value);
        }}
      />
      <Button loading={loading} onClick={() => void apply(scope, status, true)}>
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
