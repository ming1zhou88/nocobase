import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Modal, Select, Space, Typography } from 'antd';
import React, { useRef, useState } from 'react';
import { refreshSiblingDataBlocks } from './refreshSiblingDataBlocks';

const STATUS_OPTIONS = [
  { label: '待处理', value: '待处理' },
  { label: '持续跟踪', value: '持续跟踪' },
  { label: '已处理', value: '已处理' },
];

const OVERRIDE_ROLES = ['root', 'admin'];

function readValue(row: any, key: string) {
  return row?.[key] ?? row?.get?.(key);
}

function DailyBatchSetHandleStatusButton({ model }: { model: DailyBatchSetHandleStatusActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('已处理');
  const [saving, setSaving] = useState(false);
  const rowsRef = useRef<any[]>([]);
  const skippedRef = useRef(0);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    return context.blockModel || (ctx.model as any)?.parent;
  }

  function selectedRows(): any[] {
    const resource = getBlockModel()?.resource;
    const rows = resource?.getSelectedRows?.() || resource?.selectedRows || [];
    return Array.isArray(rows) ? rows : [];
  }

  function openStatusModal() {
    setOpen(true);
  }

  function openConfirm() {
    const roles: string[] = ((ctx as any).user?.roles || []).map((role: any) => role?.name).filter(Boolean);
    const override = OVERRIDE_ROLES.some((role) => roles.includes(role));
    const userId = Number((ctx as any).user?.id);
    const rows = selectedRows();
    if (!rows.length) {
      message.warning('请先勾选至少一行数据');
      return;
    }
    const ownRows = override ? rows : rows.filter((row) => Number(readValue(row, 'owner_id')) === userId);
    const skipped = rows.length - ownRows.length;
    rowsRef.current = ownRows;
    skippedRef.current = skipped;
    if (!ownRows.length) {
      message.warning('所选数据都不属于你，无法更新处理状态');
      return;
    }
    if (!skipped) {
      openStatusModal();
      return;
    }
    Modal.confirm({
      title: '部分数据将跳过',
      content: (
        <div>
          <div>已选 {rows.length} 行</div>
          <div>
            其中 {ownRows.length} 行属于你，{skipped} 行属于其他人
          </div>
          <div style={{ marginTop: 8 }}>只会更新属于你的 {ownRows.length} 行，其余自动跳过。</div>
        </div>
      ),
      okText: '继续',
      cancelText: '取消',
      onOk: openStatusModal,
    });
  }

  async function submit() {
    const rowIds = rowsRef.current
      .map((row) => Number(readValue(row, 'id')))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!rowIds.length) {
      message.warning('没有可更新的行');
      return;
    }
    setSaving(true);
    try {
      const response = await ctx.api.request({
        url: 'dailyAfterSales:batchSetHandleStatus',
        method: 'post',
        data: { rowIds, status },
      });
      const result = response?.data?.data ?? response?.data ?? {};
      const updated = Number(result.updated ?? rowIds.length);
      const skipped = Number(result.skipped ?? skippedRef.current);
      message.success(`已更新 ${updated} 行${skipped ? `，自动跳过 ${skipped} 行非本人数据` : ''}`);
      setOpen(false);
      const blockModel = getBlockModel();
      await blockModel?.resource?.refresh?.();
      await refreshSiblingDataBlocks(blockModel);
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '批量更新处理状态失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button type={(model.props?.type as any) || 'default'} onClick={openConfirm}>
        {model.props?.title || '批量更新状态'}
      </Button>
      <Modal
        open={open}
        title="批量更新处理状态"
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            将更新 {rowsRef.current.length} 行{skippedRef.current ? `，跳过 ${skippedRef.current} 行非本人数据` : ''}
          </Typography.Text>
          <Select value={status} options={STATUS_OPTIONS} onChange={setStatus} style={{ width: '100%' }} />
        </Space>
      </Modal>
    </>
  );
}

export class DailyBatchSetHandleStatusActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;

  defaultProps: ButtonProps = { children: '批量更新状态', type: 'default' };

  render() {
    return <DailyBatchSetHandleStatusButton model={this} />;
  }
}

DailyBatchSetHandleStatusActionModel.define({ label: '批量更新处理状态' });
