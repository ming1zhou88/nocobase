import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { LockOutlined } from '@ant-design/icons';
import { Button, Empty, Modal, Space, Tooltip, Typography } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const PHONE_PLACEHOLDERS = new Set(['', '--', '-', 'n/a', 'na', 'null', 'undefined']);

function toPositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * “海外售后 ☎️”：
 * - 有电话；
 * - 当前时间在下单时间 + 30 个太平洋日历日之前（含时间，不是只看日期）；
 * - 两者都满足才可点击；否则置灰并提示原因。
 *
 * order_ts / order_deadline_ts 由后端从 OrderInfoOfPlatform.purchase_date 计算：
 *   purchase_date 是太平洋当地时间 → America/Los_Angeles 换算为 epoch
 *   → +30 个太平洋日历日 → 两个毫秒时间戳。
 * 这样按钮只做数值比较，不受 NocoBase DATETIME 时区偏移影响。
 */
function OverseasAfterSalesButton({ model }: { model: OverseasAfterSalesActionModel }) {
  const ctx = useFlowContext();
  const record = (ctx.model?.context as any)?.record || {};
  const read = (key: string) => record?.[key] ?? record?.get?.(key);

  const phone = String(read('ship_phone_number') ?? '').trim();
  const hasPhone = Boolean(phone) && !PHONE_PLACEHOLDERS.has(phone.toLowerCase());
  const orderTs = toPositiveNumber(read('order_ts'));
  const deadlineTs = toPositiveNumber(read('order_deadline_ts'));
  const now = Date.now();
  const ownerId = Number(read('owner_id'));
  const userId = Number((ctx as any).user?.id);
  const roles: string[] = ((ctx as any).user?.roles || []).map((role: any) => role?.name).filter(Boolean);
  const canOperate =
    ['root', 'admin', 'after_sales_manager', 'after_sales_duty'].some((role) => roles.includes(role)) ||
    (Number.isInteger(ownerId) && ownerId === userId);
  const eligible = Boolean(
    canOperate && hasPhone && orderTs !== null && deadlineTs !== null && now >= orderTs && now < deadlineTs,
  );

  const [open, setOpen] = useState(false);

  let reason = '';
  let reasonType: 'permission' | 'data' = 'data';
  if (!canOperate) {
    reason = '仅负责人可操作海外售后';
    reasonType = 'permission';
  } else if (!hasPhone) {
    reason = '该订单没有联系电话';
  } else if (orderTs === null || deadlineTs === null) {
    reason = '缺少下单时间';
  } else if (now < orderTs) {
    reason = '下单时间异常';
  } else if (now >= deadlineTs) {
    reason = '下单已满 30 天';
  }

  const button = (
    <Button
      type={(model.props?.type as any) || 'link'}
      size="small"
      disabled={!eligible}
      icon={reasonType === 'permission' ? <LockOutlined /> : undefined}
      onClick={() => setOpen(true)}
    >
      {model.props?.title || '海外售后 ☎️'}
    </Button>
  );

  return (
    <>
      {reason ? (
        <Tooltip title={reason}>
          <span style={{ cursor: 'not-allowed' }}>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <Modal
        open={open}
        title="海外仓售后协同处理"
        footer={null}
        onCancel={() => setOpen(false)}
        width={720}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Text>订单号：{read('order_id') || '-'}</Typography.Text>
          <Empty description="功能建设中，后续接入海外仓售后协同处理页面" />
        </Space>
      </Modal>
    </>
  );
}

export class OverseasAfterSalesActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;

  defaultProps: ButtonProps = { children: '海外售后 ☎️', type: 'link' };

  render() {
    return <OverseasAfterSalesButton model={this} />;
  }
}

OverseasAfterSalesActionModel.define({ label: '海外售后' });
