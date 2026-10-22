import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Form, Modal, Select, Space, Typography } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const ASSIGNEE_ROLES = ['after_sales_agent', 'after_sales_manager'];

type OwnerOption = { label: string; value: string };

function rowOwnerName(row: Record<string, any> | null | undefined): string {
  if (!row) return '';
  const name = row.owner_name ?? row.get?.('owner_name');
  return String(name ?? '').trim();
}

function rowOwnerId(row: Record<string, any> | null | undefined): number {
  if (!row) return 0;
  const id = Number(row.owner_id ?? row.get?.('owner_id'));
  return Number.isInteger(id) ? id : 0;
}

/** 行级「指派」：已指派过的行先确认是否重新指派，再进负责人选择。 */
function DailyAssignButton({ model }: { model: DailyAssignActionModel }) {
  const ctx = useFlowContext();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [options, setOptions] = useState<OwnerOption[]>([]);
  const [count, setCount] = useState(1);
  const [targetRows, setTargetRows] = useState<Record<string, any>[]>([]);
  const record = (ctx.model?.context as any)?.record || {};

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    return context.blockModel || (ctx.model as any)?.parent;
  }

  async function loadOwners() {
    setLoadingOwners(true);
    try {
      const response = await ctx.api.request({
        url: 'users:list',
        method: 'get',
        params: { paginate: false, appends: ['roles'], fields: ['nickname', 'username', 'roles'] },
      });
      const users = response?.data?.data ?? [];
      const list: OwnerOption[] = (Array.isArray(users) ? users : [])
        .filter((user: any) => (user.roles || []).some((role: any) => ASSIGNEE_ROLES.includes(role?.name)))
        .map((user: any) => ({ label: user.nickname || user.username, value: user.nickname || user.username }))
        .filter((item) => item.value);
      setOptions(list);
      if (!list.length) message.warning('未找到带售后身份的人员');
    } catch (error: any) {
      message.error(error?.message || '加载售后人员失败');
    } finally {
      setLoadingOwners(false);
    }
  }

  function openOwnerModal(rows: Record<string, any>[]) {
    setTargetRows(rows);
    setCount(rows.length);
    setOpen(true);
    if (!options.length) void loadOwners();
  }

  async function handleAssign() {
    const roles: string[] = ((ctx as any).user?.roles || []).map((role: any) => role?.name).filter(Boolean);
    if (roles.length && !roles.some((name) => ['after_sales_manager', 'admin', 'root'].includes(name))) {
      message.warning('只有售后主管可以指派负责人');
      return;
    }
    if (!record.id) {
      message.error('当前行没有 id，无法指派');
      return;
    }
    const ownerName = rowOwnerName(record);
    const currentOwner = ownerName || (rowOwnerId(record) ? '已有负责人' : '');
    const rows = [record];
    if (currentOwner) {
      modal.confirm({
        title: '确认重新指派',
        content: `该行当前负责人为「${currentOwner}」，继续指派会覆盖原负责人，是否重新指派？`,
        okText: '继续指派',
        cancelText: '取消',
        onOk: () => openOwnerModal(rows),
      });
      return;
    }
    openOwnerModal(rows);
  }

  async function submit() {
    const values = await form.validateFields();
    const rowIds = targetRows
      .map((row) => Number(row.id ?? row.get?.('id') ?? row[ctx.collection?.filterTargetKey || 'id']))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (!rowIds.length) {
      message.warning('没有可指派的单据（缺少行 id）');
      return;
    }
    setSaving(true);
    try {
      await ctx.api.request({
        url: 'dailyAfterSales:batchAssign',
        method: 'post',
        data: { rowIds, owner_name: values.owner_name },
      });
      message.success(`已将 ${rowIds.length} 行指派给「${values.owner_name}」`);
      setOpen(false);
      form.resetFields();
      await getBlockModel()?.resource?.refresh?.();
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '指派失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button type="link" size="small" onClick={handleAssign}>
        {model.props?.title || '指派'}
      </Button>
      <Modal
        open={open}
        title="指派负责人"
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="确定"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">将把 {count} 行指派给同一个负责人。</Typography.Text>
          <Form form={form} layout="vertical">
            <Form.Item name="owner_name" label="负责人" rules={[{ required: true, message: '请选择负责人' }]}>
              <Select
                showSearch
                loading={loadingOwners}
                options={options}
                placeholder="选择售后负责人"
                optionFilterProp="label"
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
}

export class DailyAssignActionModel extends ActionModel {
  static scene = ActionSceneEnum.record;

  defaultProps: ButtonProps = { children: '指派', type: 'link' };

  render() {
    return <DailyAssignButton model={this} />;
  }
}

DailyAssignActionModel.define({
  label: '指派负责人',
});
