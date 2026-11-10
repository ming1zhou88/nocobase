import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button, Select, Space } from 'antd';
import React, { useEffect, useState } from 'react';

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '待处理', value: '待处理' },
  { label: '持续跟踪', value: '持续跟踪' },
  { label: '已处理', value: '已处理' },
];

function DailyScopeFilter({ model }: { model: DailyScopeFilterActionModel }) {
  const ctx = useFlowContext();
  const [scope, setScope] = useState<'all' | 'mine'>(() =>
    sessionStorage.getItem('daily-scope') === 'mine' ? 'mine' : 'all',
  );
  const [status, setStatus] = useState(() => sessionStorage.getItem('daily-status') || 'all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (scope !== 'all' || status !== 'all') {
      void apply(scope, status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        } else if (resource.request?.params) {
          delete resource.request.params.filter;
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
          setScope('all');
          sessionStorage.setItem('daily-scope', 'all');
          void apply('all', status);
        }}
      >
        全部数据
      </Button>
      <Button
        type={scope === 'mine' ? 'primary' : 'default'}
        onClick={() => {
          setScope('mine');
          sessionStorage.setItem('daily-scope', 'mine');
          void apply('mine', status);
        }}
      >
        我的数据
      </Button>
      <Select
        value={status}
        style={{ width: 130 }}
        options={STATUS_OPTIONS}
        onChange={(value) => {
          setStatus(value);
          sessionStorage.setItem('daily-status', value);
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
