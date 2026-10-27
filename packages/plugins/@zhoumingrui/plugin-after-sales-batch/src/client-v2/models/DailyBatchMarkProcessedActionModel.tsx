import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Modal, Select } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const OPTIONS = [
  { label: '快递/邮件通知', value: '快递/邮件通知' },
  { label: '二次回复', value: '二次回复' },
  { label: '人工处理', value: '人工处理' },
];

function selectedRowsOf(ctx: any): Record<string, any>[] {
  const context = (ctx.model?.context || {}) as any;
  const blockModel = context.blockModel || (ctx.model as any)?.parent;
  const resource = blockModel?.resource;
  const rows = resource?.getSelectedRows?.() || resource?.selectedRows || [];
  return Array.isArray(rows) ? rows : [];
}

function DailyBatchMarkButton({ model }: { model: DailyBatchMarkProcessedActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [method, setMethod] = useState('快递/邮件通知');

  function prepare() {
    const selected = selectedRowsOf(ctx);
    if (!selected.length) {
      message.warning('请先勾选至少一行数据');
      return;
    }
    setRows(selected);
    setMethod('快递/邮件通知');
    setOpen(true);
  }

  async function submit() {
    const rowIds = rows.map((row) => Number(row.id ?? row.get?.('id'))).filter((id) => Number.isInteger(id) && id > 0);
    if (!rowIds.length) {
      message.warning('没有可标记的单据（缺少行 id）');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'dailyAfterSales:batchMarkProcessMethod',
        method: 'post',
        data: { rowIds, process_method: method },
      });
      message.success(`已将 ${rowIds.length} 行标记为“${method}”`);
      setOpen(false);
      const context = (ctx.model?.context || {}) as any;
      const blockModel = context.blockModel || (ctx.model as any)?.parent;
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '批量标记失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button type={(model.props?.type as any) || 'default'} onClick={prepare}>
        {model.props?.title || '批量标记处理方式'}
      </Button>
      <Modal
        open={open}
        title="批量标记处理方式"
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="确认标记"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>已勾选 {rows.length} 行，请选择处理方式：</div>
        <Select value={method} options={OPTIONS} onChange={setMethod} style={{ width: '100%' }} />
        <div style={{ marginTop: 12, color: '#888' }}>该操作只更新处理方式，不修改处理状态。</div>
      </Modal>
    </>
  );
}

export class DailyBatchMarkProcessedActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;
  defaultProps: ButtonProps = { children: '批量标记处理方式', type: 'default' };
  render() {
    return <DailyBatchMarkButton model={this} />;
  }
}

DailyBatchMarkProcessedActionModel.define({ label: '批量标记处理方式' });
