import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Form, Input, Modal, Select } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useEffect, useRef, useState } from 'react';

const DAILY_DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const GREETINGS = [
  'Hi',
  'Hello',
  'Dear Buyer',
  'Dear Customer',
  'Hi Customer',
  'Hi Buyer',
  'Hello Customer',
  'Hello Buyer',
];

function DailyCreateWorkOrderButton({ model }: { model: DailyCreateWorkOrderActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingValues = useRef<Record<string, unknown>>({});
  const [savingDraft, setSavingDraft] = useState(false);
  const record = (ctx.model?.context as any)?.record || {};
  // 列表接口已带回草稿字段时（外部数据源字段元数据 + 角色字段白名单都齐）直接用行数据，
  // 不再逐行请求 listDraftStates；旧环境缺字段时仍回退到逐行查询。
  const listHasDraftInfo =
    record.has_draft !== undefined || record.draft_saved_at !== undefined || record.draft_payload !== undefined;
  const listDraftFlag = Boolean(record.has_draft) || Boolean(record.draft_saved_at) || Boolean(record.draft_payload);
  const [hasDraft, setHasDraft] = useState(listDraftFlag);
  // 打开弹窗时记下草稿版本，保存时带回去做并发校验（别人改过 → 409）
  const [draftVersion, setDraftVersion] = useState<number | undefined>(() => {
    const value = Number(record.draft_version);
    return Number.isInteger(value) ? value : undefined;
  });

  useEffect(() => {
    if (listHasDraftInfo) {
      setHasDraft(listDraftFlag);
    }
  }, [listHasDraftInfo, listDraftFlag]);

  useEffect(() => {
    if (!record.id || listHasDraftInfo) return;
    let active = true;
    ctx.api
      .request({
        url: 'dailyAfterSales:listDraftStates',
        method: 'post',
        data: { daily_order_ids: [record.id] },
      })
      .then((response: any) => {
        if (!active) return;
        const drafts = response?.data?.data?.drafts ?? response?.data?.drafts ?? {};
        const state = drafts[String(record.id)];
        if (state) setHasDraft(Boolean(state.has_draft));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ctx.api, record.id, listHasDraftInfo]);

  async function openModal() {
    const ownerId = Number(record.owner_id);
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      message.warning('请先指派售后负责人，再发起售后工单');
      return;
    }
    let greeting = '';
    let ownerName = record.owner_name || '';
    try {
      const response = await ctx.api.request({
        url: `users:get?filterByTk=${ownerId}`,
        method: 'get',
      });
      const user = response?.data?.data ?? response?.data ?? {};
      greeting = user.replyGreeting || user.reply_greeting || '';
      ownerName = user.nickname || user.username || ownerName;
    } catch {
      greeting = '';
    }
    if (!greeting) {
      message.warning(`负责人${ownerName ? `「${ownerName}」` : ''}未配置个人邮件抬头`);
    }
    let draft: Record<string, unknown> = {};
    try {
      const draftResponse = await ctx.api.request({
        url: 'dailyAfterSales:getDraft',
        method: 'post',
        data: { daily_order_id: record.id },
      });
      const draftData = draftResponse?.data?.data ?? draftResponse?.data ?? {};
      const savedDraft = draftData.draft ?? record.draft_payload;
      draft = savedDraft ? (typeof savedDraft === 'string' ? JSON.parse(savedDraft) : savedDraft) : {};
      const versionFromServer = Number(draftData.version);
      if (Number.isInteger(versionFromServer)) setDraftVersion(versionFromServer);
    } catch {
      draft = {};
    }
    const nextValues = {
      order_id: record.order_id || '',
      buyer_email: record.buyer_email || '',
      buyer_issue_type: record.issue_type || '',
      reply_greeting: greeting,
      ...draft,
    };
    pendingValues.current = nextValues;
    setOpen(true);
  }

  async function saveDraft() {
    if (!record.id) return;
    setSavingDraft(true);
    try {
      const values = form.getFieldsValue(true);
      const response = await ctx.api.request({
        url: 'dailyAfterSales:saveDraft',
        method: 'post',
        data: {
          daily_order_id: record.id,
          payload: values,
          ...(draftVersion !== undefined ? { expected_version: draftVersion } : {}),
        },
      });
      const savedVersion = Number(response?.data?.data?.version);
      if (Number.isInteger(savedVersion)) setDraftVersion(savedVersion);
      message.success('草稿已保存');
      setHasDraft(true);
      setOpen(false);
      const blockModel = (ctx.model?.context as any)?.blockModel;
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      if (status === 409) {
        message.warning(detail || '草稿已被他人更新，请重新打开后再保存');
      } else if (status === 403) {
        message.error(detail || '只能保存自己负责的每日售后订单草稿');
      } else {
        message.error(detail || '保存草稿失败');
      }
    } finally {
      setSavingDraft(false);
    }
  }

  async function submit(values: Record<string, unknown>) {
    if (!record.id) {
      message.error('当前行没有 id，无法创建工单');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'dailyAfterSales:createWorkOrder',
        method: 'post',
        data: { daily_order_id: record.id, overrides: values },
      });
      message.success('工单已创建');
      setHasDraft(false);
      await ctx.api
        .request({
          url: `DailyAfterSalesOrder:update?filterByTk=${record.id}`,
          method: 'post',
          headers: { 'x-data-source': DAILY_DATA_SOURCE_KEY },
          data: { draft_payload: null, draft_saved_at: null, draft_saved_by: null },
        })
        .catch(() => undefined);
      setOpen(false);
      const blockModel = (ctx.model?.context as any)?.blockModel;
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      message.error(error?.message || '创建工单失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button type="link" onClick={openModal}>
        {hasDraft ? '编辑草稿' : model.props.title || '发起售后工单'}
      </Button>
      <Modal
        open={open}
        title={hasDraft ? '编辑工单草稿' : '发起售后工单'}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            取消
          </Button>,
          <Button key="draft" loading={savingDraft} onClick={() => void saveDraft()}>
            保存草稿
          </Button>,
          <Button key="submit" type="primary" loading={saving} onClick={() => form.submit()}>
            确定
          </Button>,
        ]}
        forceRender
        afterOpenChange={(visible) => {
          if (visible) form.setFieldsValue(pendingValues.current);
        }}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
          <Form.Item name="order_id" label="平台订单编号">
            <Input readOnly />
          </Form.Item>
          <Form.Item name="buyer_email" label="买家邮箱">
            <Input readOnly />
          </Form.Item>
          <Form.Item name="buyer_issue_type" label="买家问题类型">
            <Input readOnly />
          </Form.Item>
          <Form.Item name="reply_greeting" label="回信抬头" rules={[{ required: true }]}>
            <Select options={GREETINGS.map((value) => ({ label: value, value }))} />
          </Form.Item>
          <Form.Item name="additional_context" label="相关信息补充">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tone_and_language" label="语气和语言要求">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="reply_preference" label="回复倾向">
            <Input />
          </Form.Item>
          <Form.Item name="email_length" label="邮件篇幅">
            <Input />
          </Form.Item>
          <Form.Item name="case_template_path" label="标准参考案例模版路径">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export class DailyCreateWorkOrderActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;

  defaultProps: ButtonProps = { children: '发起售后工单', type: 'link' };

  render() {
    return <DailyCreateWorkOrderButton model={this} />;
  }
}

DailyCreateWorkOrderActionModel.define({
  label: '发起售后工单',
});

DailyCreateWorkOrderActionModel.registerFlow({
  key: 'clickFlow',
  title: '发起售后工单',
  on: 'click',
  steps: {
    notice: {
      async handler(ctx: any) {
        ctx.message.info('发起售后工单按钮已加载');
      },
    },
  },
});
