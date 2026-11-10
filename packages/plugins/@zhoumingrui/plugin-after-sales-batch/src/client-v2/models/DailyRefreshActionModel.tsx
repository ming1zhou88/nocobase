import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';
import { refreshSiblingDataBlocks } from './refreshSiblingDataBlocks';

function DailyRefreshButton({ model }: { model: DailyRefreshActionModel }) {
  const ctx = useFlowContext();
  const [loading, setLoading] = useState(false);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    const parent = (ctx.model as any)?.parent;
    return parent?.resource ? parent : context.blockModel || parent;
  }

  async function refresh() {
    setLoading(true);
    try {
      const blockModel = getBlockModel();
      await blockModel?.resource?.refresh?.();
      await refreshSiblingDataBlocks(blockModel);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button loading={loading} onClick={() => void refresh()}>
      {model.props?.title || '刷新'}
    </Button>
  );
}

export class DailyRefreshActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;

  defaultProps: ButtonProps = { children: '刷新', type: 'default' };

  render() {
    return <DailyRefreshButton model={this} />;
  }
}

DailyRefreshActionModel.define({ label: '刷新' });
