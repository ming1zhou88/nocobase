import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

function DailyMarkProcessedButton({ model }: { model: DailyMarkProcessedActionModel }) {
  const ctx = useFlowContext();
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const record = (ctx.model?.context as any)?.record || {};
  const rowId = Number(record.id ?? record.get?.('id'));

  function confirmMark() {
    if (!Number.isInteger(rowId) || rowId <= 0) {
      message.error('当前行没有 id，无法标记');
      return;
    }
    modal.confirm({
      title: '标记为程序处理',
      content: `将当前订单「${record.order_id || '-'}」标记为“程序处理”。该操作只更新处理方式，不修改处理状态。`,
      okText: '确认标记',
      cancelText: '取消',
      onOk: async () => {
        setSaving(true);
        try {
          await ctx.api.request({
            url: 'dailyAfterSales:batchMarkProcessMethod',
            method: 'post',
            data: { rowIds: [rowId], process_method: '程序处理' },
          });
          message.success('已标记为“程序处理”');
          const blockModel = (ctx.model?.context as any)?.blockModel || (ctx.model as any)?.parent;
          await blockModel?.resource?.refresh?.();
        } catch (error: any) {
          const detail =
            error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
          message.error(detail || '标记失败');
        } finally {
          setSaving(false);
        }
      },
    });
  }

  return (
    <Button type={(model.props?.type as any) || 'link'} size="small" loading={saving} onClick={confirmMark}>
      {model.props?.title || '标记程序处理'}
    </Button>
  );
}

export class DailyMarkProcessedActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;
  defaultProps: ButtonProps = { children: '标记程序处理', type: 'link' };

  render() {
    return <DailyMarkProcessedButton model={this} />;
  }
}

DailyMarkProcessedActionModel.define({ label: '标记程序处理' });
