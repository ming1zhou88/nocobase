import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Modal, Select } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const FEEDBACK_ACTION_OPTIONS = [
  { label: '售后已顾及', value: '售后已顾及' },
  { label: '差评页审核删除', value: '差评页审核删除' },
  { label: '开 case 删除', value: '开 case 删除' },
];

const REVIEW_ACTION_OPTIONS = [
  { label: '售后已触及', value: '售后已触及' },
  { label: '前台页已回应', value: '前台页已回应' },
];

const DELETED_OPTIONS = [{ label: '已删除', value: '已删除' }];

const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const DEFAULT_COLLECTION = 'AfterSalesFeedback';

/** 行级「标记」：只弹两个下拉（行动 / 删除状态），保存即回写 AfterSalesFeedback。 */
function FeedbackMarkButton({ model }: { model: FeedbackMarkActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | undefined>(undefined);
  const [deletedStatus, setDeletedStatus] = useState<string | undefined>(undefined);
  const record = (ctx.model?.context as any)?.record || {};
  const rowId = Number(record.id ?? record.get?.('id'));
  const collection = String(model.props?.collectionName || DEFAULT_COLLECTION);
  const actionOptions =
    String(model.props?.optionsMode || '') === 'review' ? REVIEW_ACTION_OPTIONS : FEEDBACK_ACTION_OPTIONS;

  function openModal() {
    if (!Number.isInteger(rowId) || rowId <= 0) {
      message.error('当前行没有 id，无法标记');
      return;
    }
    setActionStatus(record.action_status ?? record.get?.('action_status') ?? undefined);
    setDeletedStatus(record.deleted_status ?? record.get?.('deleted_status') ?? undefined);
    setOpen(true);
  }

  async function submit() {
    setSaving(true);
    try {
      await ctx.api.request({
        url: `${collection}:update`,
        method: 'post',
        params: { filterByTk: rowId },
        headers: { 'X-Data-Source': DATA_SOURCE_KEY },
        data: {
          action_status: actionStatus || null,
          deleted_status: deletedStatus || null,
        },
      });
      message.success('已保存');
      setOpen(false);
      const blockModel = (ctx.model?.context as any)?.blockModel || (ctx.model as any)?.parent;
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button type={(model.props?.type as any) || 'link'} size="small" onClick={openModal}>
        {model.props?.title || '标记'}
      </Button>
      <Modal
        open={open}
        title="标记差评处理状态"
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>订单「{record.amazon_order_id || '-'}」：</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>行动</div>
          <Select
            allowClear
            placeholder="选择处理动作"
            value={actionStatus}
            options={actionOptions}
            onChange={setActionStatus}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 4 }}>删除状态</div>
          <Select
            allowClear
            placeholder="未删除可留空"
            value={deletedStatus}
            options={DELETED_OPTIONS}
            onChange={setDeletedStatus}
            style={{ width: '100%' }}
          />
        </div>
      </Modal>
    </>
  );
}

export class FeedbackMarkActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;
  defaultProps: ButtonProps = { children: '标记', type: 'link' };
  render() {
    return <FeedbackMarkButton model={this} />;
  }
}

FeedbackMarkActionModel.define({ label: '标记（行动/删除）' });
