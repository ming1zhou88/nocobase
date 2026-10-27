import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

function SecondReplySendButton({ model }: { model: SecondReplySendActionModel }) {
  const ctx = useFlowContext();
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const record = (ctx.model?.context as any)?.record || {};
  const e3Id = Number(record.id ?? record.get?.('id'));
  const orderId = record['order-id'] ?? record.order_id ?? record.get?.('order-id') ?? record.get?.('order_id');

  function confirmSend() {
    if (!Number.isInteger(e3Id) || e3Id <= 0) {
      message.error('当前行没有 id，无法发送');
      return;
    }
    modal.confirm({
      title: '发送二次回复邮件',
      content: `确认向订单「${orderId || '-'}」的买家发送二次回复？发送后不可再次发送。`,
      okText: '确认发送',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          await ctx.api.request({
            url: 'secondReply:send',
            method: 'post',
            data: { e3Id, dry_run: false },
          });
          message.success('二次回复已发送');
          const blockModel = (ctx.model?.context as any)?.blockModel || (ctx.model as any)?.parent;
          await blockModel?.resource?.refresh?.();
        } catch (error: any) {
          const detail =
            error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
          message.error(detail || '发送失败');
        } finally {
          setLoading(false);
        }
      },
    });
  }

  return (
    <Button type={(model.props?.type as any) || 'link'} size="small" loading={loading} onClick={confirmSend}>
      {model.props?.title || '发送二次回复'}
    </Button>
  );
}

export class SecondReplySendActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;
  defaultProps: ButtonProps = { children: '发送二次回复', type: 'link' };

  render() {
    return <SecondReplySendButton model={this} />;
  }
}

SecondReplySendActionModel.define({ label: '发送二次回复' });
