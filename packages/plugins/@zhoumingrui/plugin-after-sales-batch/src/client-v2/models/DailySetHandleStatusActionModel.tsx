import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Modal, Select, Space, Typography } from 'antd';
import React, { useState } from 'react';
import { refreshSiblingDataBlocks } from './refreshSiblingDataBlocks';

const STATUS_OPTIONS = [
  { label: '待处理', value: '待处理' },
  { label: '持续跟踪', value: '持续跟踪' },
  { label: '已处理', value: '已处理' },
];

const OVERRIDE_ROLES = ['root', 'admin'];

function readRecordValue(record: any, key: string) {
  return record?.[key] ?? record?.get?.(key);
}

function DailySetHandleStatusButton({ model }: { model: DailySetHandleStatusActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('待处理');
  const [saving, setSaving] = useState(false);
  const record = ((ctx.model?.context || {}) as any).record || {};
  const ownerId = Number(readRecordValue(record, 'owner_id'));
  const userId = Number((ctx as any).user?.id);
  const roles: string[] = ((ctx as any).user?.roles || []).map((role: any) => role?.name).filter(Boolean);
  const canEdit =
    OVERRIDE_ROLES.some((role) => roles.includes(role)) || (Number.isInteger(ownerId) && ownerId === userId);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    return context.blockModel || (ctx.model as any)?.parent;
  }

  async function submit() {
    const rowId = Number(readRecordValue(record, 'id'));
    if (!Number.isInteger(rowId) || rowId <= 0) {
      message.error('当前行没有 id，无法更新');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'dailyAfterSales:setHandleStatus',
        method: 'post',
        data: { rowId, status },
      });
      message.success(`处理状态已更新为「${status}」`);
      setOpen(false);
      const blockModel = getBlockModel();
      await blockModel?.resource?.refresh?.();
      await refreshSiblingDataBlocks(blockModel);
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '更新处理状态失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="link"
        size="small"
        disabled={!canEdit}
        title={canEdit ? undefined : '只能更新指派给自己的订单处理状态'}
        onClick={() => {
          setStatus(String(readRecordValue(record, 'handle_status') || '待处理'));
          setOpen(true);
        }}
      >
        更新状态
      </Button>
      <Modal
        open={open}
        title="更新处理状态"
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">订单：{String(readRecordValue(record, 'order_id') || '-')}</Typography.Text>
          <Select value={status} options={STATUS_OPTIONS} onChange={setStatus} style={{ width: '100%' }} />
        </Space>
      </Modal>
    </>
  );
}

export class DailySetHandleStatusActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;

  render() {
    return <DailySetHandleStatusButton model={this} />;
  }
}

DailySetHandleStatusActionModel.define({ label: '更新处理状态' });
