import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { Button, Descriptions, Modal } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const FIELD_LABELS: Array<[string, string]> = [
  ['store_code', '店铺'],
  ['star', '星级'],
  ['amazon_order_id', '平台订单编号'],
  ['order_id', '平台订单编号'],
  ['feedback_date', '差评日期'],
  ['review_date', '评价日期'],
  ['feedback_content', '差评内容'],
  ['title', '标题'],
  ['content', '评价内容'],
  ['ai_type', '类型'],
  ['ai_keywords', '关键词'],
  ['action_status', '行动'],
  ['deleted_status', '删除状态'],
  ['asin', 'ASIN'],
  ['seller_sku', 'SKU'],
  ['product_title', '商品标题'],
  ['author', '买家'],
  ['review_url', '评价链接'],
  ['review_id', '评价ID'],
  ['feedback_uid', '唯一键'],
];

function valueOf(record: any, key: string): any {
  const v = record?.[key] ?? record?.get?.(key);
  return v === undefined || v === null || v === '' ? '-' : v;
}

/** 通用「查看详情」：用当前行数据弹只读详情，不依赖 NocoBase 弹窗模板。 */
function RecordDetailButton({ model }: { model: RecordDetailActionModel }) {
  const ctx = useFlowContext();
  const [open, setOpen] = useState(false);
  const record = (ctx.model?.context as any)?.record || {};

  return (
    <>
      <Button type={(model.props?.type as any) || 'link'} size="small" onClick={() => setOpen(true)}>
        {model.props?.title || '查看详情'}
      </Button>
      <Modal
        open={open}
        title={model.props?.dialogTitle || '详情'}
        onCancel={() => setOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Descriptions column={1} bordered size="small" styles={{ label: { width: 110 } }}>
          {FIELD_LABELS.filter(([key]) => record?.[key] !== undefined || record?.get?.(key) !== undefined).map(
            ([key, label]) => (
              <Descriptions.Item key={key} label={label}>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(valueOf(record, key))}</div>
              </Descriptions.Item>
            ),
          )}
        </Descriptions>
      </Modal>
    </>
  );
}

export class RecordDetailActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;
  defaultProps: ButtonProps = { children: '查看详情', type: 'link' };
  render() {
    return <RecordDetailButton model={this} />;
  }
}

RecordDetailActionModel.define({ label: '查看详情（只读弹窗）' });
