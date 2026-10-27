import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

function SecondReplyGenerateButton({ model }: { model: SecondReplyGenerateActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const record = (ctx.model?.context as any)?.record || {};
  const e3Id = Number(record.id ?? record.get?.('id'));

  async function generate() {
    if (!Number.isInteger(e3Id) || e3Id <= 0) {
      message.error('当前行没有 id，无法生成');
      return;
    }
    setLoading(true);
    try {
      await ctx.api.request({
        url: 'secondReply:generate',
        method: 'post',
        data: { e3Id },
      });
      message.success('二次回复正文已生成');
      const blockModel = (ctx.model?.context as any)?.blockModel || (ctx.model as any)?.parent;
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '生成失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type={(model.props?.type as any) || 'link'} size="small" loading={loading} onClick={generate}>
      {model.props?.title || '生成二次回复'}
    </Button>
  );
}

export class SecondReplyGenerateActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;
  defaultProps: ButtonProps = { children: '生成二次回复', type: 'link' };

  render() {
    return <SecondReplyGenerateButton model={this} />;
  }
}

SecondReplyGenerateActionModel.define({ label: '生成二次回复' });
