import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button, Typography } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useEffect, useState } from 'react';

const RETURN_WORKBENCH_PATH = '/v/admin/return-request/workbench';

function DailyReturnRequestButton() {
  const ctx = useFlowContext();
  const record: any = (ctx.model?.context as any)?.record || {};
  const orderId = String(record.order_id ?? record.get?.('order_id') ?? '').trim();
  const [flag, setFlag] = useState<{ open?: boolean; total?: number; lastReturnDate?: string } | null>(null);

  useEffect(() => {
    if (!orderId) return undefined;
    let active = true;
    ctx.api
      .request({
        url: 'returnRequestWorkbench:orderFlag',
        method: 'get',
        params: { order_id: orderId },
      })
      .then((response: any) => {
        if (!active) return;
        const body = response?.data ?? response;
        const flags = body?.flags ?? body?.data?.flags ?? {};
        setFlag(flags[orderId] || null);
      })
      .catch(() => {
        if (active) setFlag(null);
      });
    return () => {
      active = false;
    };
  }, [ctx, orderId]);

  if (!orderId) return null;

  if (flag?.open) {
    return (
      <Button
        type="link"
        size="small"
        style={{ color: '#52c41a', padding: 0 }}
        title={flag.lastReturnDate ? `最近退货申请：${flag.lastReturnDate}` : '存在未完结退货申请'}
        onClick={() => {
          window.location.href = `${RETURN_WORKBENCH_PATH}?order_id=${encodeURIComponent(orderId)}`;
        }}
      >
        退货申请
      </Button>
    );
  }

  return (
    <Typography.Text type="secondary" style={{ color: '#bfbfbf' }}>
      退货申请
    </Typography.Text>
  );
}

/**
 * 每日售后订单「退货申请」列：
 *   该平台订单在 LxReturnOrder 有未完结行 → 绿色可点，跳转退货工作台并带入订单号；
 *   否则 → 灰色不可点。
 */
export class DailyReturnRequestActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;

  defaultProps: ButtonProps = { children: '退货申请', type: 'link' };

  render() {
    return <DailyReturnRequestButton />;
  }
}

DailyReturnRequestActionModel.define({
  label: '退货申请',
});
