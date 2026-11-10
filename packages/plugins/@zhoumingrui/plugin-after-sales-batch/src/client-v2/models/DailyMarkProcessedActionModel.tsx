import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Modal, Select } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const OVERRIDE_ROLES = ['root', 'admin'];

function readRecordValue(record: any, key: string) {
  return record?.[key] ?? record?.get?.(key);
}

const OPTIONS = [
  { label: '快递/邮件通知', value: '快递/邮件通知' },
  { label: '二次回复', value: '二次回复' },
  { label: '人工处理', value: '人工处理' },
];

function DailyMarkProcessedButton({ model }: { model: DailyMarkProcessedActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [method, setMethod] = useState('快递/邮件通知');
  const record = (ctx.model?.context as any)?.record || {};
  const rowId = Number(record.id ?? record.get?.('id'));
  const ownerId = Number(readRecordValue(record, 'owner_id'));
  const userId = Number((ctx as any).user?.id);
  const roles: string[] = ((ctx as any).user?.roles || []).map((role: any) => role?.name).filter(Boolean);
  const canEdit =
    OVERRIDE_ROLES.some((role) => roles.includes(role)) || (Number.isInteger(ownerId) && ownerId === userId);

  function confirmMark() {
    if (!Number.isInteger(rowId) || rowId <= 0) {
      message.error('当前行没有 id，无法标记');
      return;
    }
    setMethod('快递/邮件通知');
    setOpen(true);
  }

  async function submit() {
    setSaving(true);
    try {
      const response = await ctx.api.request({
        url: 'dailyAfterSales:batchMarkProcessMethod',
        method: 'post',
        data: { rowIds: [rowId], process_method: method },
      });
      const result = response?.data?.data ?? response?.data ?? {};
      const statusUpdated = Number(result.status_updated ?? 0);
      message.success(`已标记为“${method}”${statusUpdated ? '，处理状态已更新为已处理' : ''}`);
      setOpen(false);
      const blockModel = (ctx.model?.context as any)?.blockModel || (ctx.model as any)?.parent;
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '标记失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type={(model.props?.type as any) || 'link'}
        size="small"
        disabled={!canEdit}
        title={canEdit ? undefined : '只能标记指派给自己的订单处理方式'}
        onClick={confirmMark}
      >
        {model.props?.title || '标记处理方式'}
      </Button>
      <Modal
        open={open}
        title="标记处理方式"
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="确认标记"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>订单「{record.order_id || '-'}」请选择处理方式：</div>
        <Select value={method} options={OPTIONS} onChange={setMethod} style={{ width: '100%' }} />
        <div style={{ marginTop: 12, color: '#888' }}>该操作只更新处理方式，不修改处理状态。</div>
      </Modal>
    </>
  );
}

export class DailyMarkProcessedActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;
  defaultProps: ButtonProps = { children: '标记处理方式', type: 'link' };
  render() {
    return <DailyMarkProcessedButton model={this} />;
  }
}

DailyMarkProcessedActionModel.define({ label: '标记处理方式' });
