import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button } from 'antd';
import type { ButtonProps } from 'antd';
import React from 'react';

function selectedRowsOf(ctx: any): Record<string, any>[] {
  const context = (ctx.model?.context || {}) as any;
  const blockModel = context.blockModel || (ctx.model as any)?.parent;
  const resource = blockModel?.resource;
  const rows = resource?.getSelectedRows?.() || resource?.selectedRows || [];
  return Array.isArray(rows) ? rows : [];
}

function DailyBatchCopyButton({ model }: { model: DailyBatchCopyOrderIdsActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();

  async function copy() {
    const rows = selectedRowsOf(ctx);
    if (!rows.length) {
      message.warning('请先勾选至少一行数据');
      return;
    }
    const ids = [
      ...new Set(rows.map((row) => String(row.order_id ?? row.get?.('order_id') ?? '').trim()).filter(Boolean)),
    ];
    if (!ids.length) {
      message.warning('所选行没有平台订单编号');
      return;
    }
    const text = ids.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success(`已复制 ${ids.length} 个平台订单编号`);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      message.success(`已复制 ${ids.length} 个平台订单编号`);
    }
  }

  return (
    <Button type={(model.props?.type as any) || 'default'} onClick={() => void copy()}>
      {model.props?.title || '批量复制订单编号'}
    </Button>
  );
}

export class DailyBatchCopyOrderIdsActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;
  defaultProps: ButtonProps = { children: '批量复制订单编号', type: 'default' };
  render() {
    return <DailyBatchCopyButton model={this} />;
  }
}

DailyBatchCopyOrderIdsActionModel.define({ label: '批量复制订单编号' });
