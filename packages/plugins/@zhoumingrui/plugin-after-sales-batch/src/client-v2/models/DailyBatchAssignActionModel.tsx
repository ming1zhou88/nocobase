import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Form, Modal, Select, Space, Typography } from 'antd';
import type { ButtonProps } from 'antd';
import React, { useRef, useState } from 'react';

/** 有售后身份的角色（批量指派只对这些人有意义） */
const ASSIGNEE_ROLES = ['after_sales_agent', 'after_sales_manager'];
/** 有资格执行批量指派的角色 */
const ASSIGNER_ROLES = ['after_sales_manager', 'admin', 'root'];

type OwnerOption = { label: string; value: string };

function DailyBatchAssignButton({ model }: { model: DailyBatchAssignActionModel }) {
  const ctx = useFlowContext();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [options, setOptions] = useState<OwnerOption[]>([]);
  const [count, setCount] = useState(0);
  const rowsRef = useRef<Record<string, any>[]>([]);

  function getBlockModel() {
    const context = (ctx.model?.context || {}) as any;
    return context.blockModel || (ctx.model as any)?.parent;
  }

  function selectedRows(): Record<string, any>[] {
    const resource = getBlockModel()?.resource;
    const rows = resource?.getSelectedRows?.() || resource?.selectedRows || [];
    return Array.isArray(rows) ? rows : [];
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
        .map((user: any) => {
          const name = user.nickname || user.username;
          return { label: name, value: name };
        })
        .filter((item) => item.value);
      setOptions(list);
      if (!list.length) message.warning('未找到带售后身份的人员');
    } catch (error: any) {
      message.error(error?.message || '加载售后人员失败');
    } finally {
      setLoadingOwners(false);
    }
  }

  async function openModal() {
    const roles: string[] = ((ctx as any).user?.roles || []).map((role: any) => role?.name).filter(Boolean);
    if (roles.length && !roles.some((name) => ASSIGNER_ROLES.includes(name))) {
      message.warning('只有售后主管可以批量指派');
      return;
    }
    // 关键守卫：未勾选任何行时不弹窗
    const rows = selectedRows();
    if (!rows.length) {
      message.warning('请先勾选至少一行数据，再批量指派');
      return;
    }
    const openOwnerModal = () => {
      rowsRef.current = rows;
      setCount(rows.length);
      setOpen(true);
      if (!options.length) void loadOwners();
    };
    // 已有负责人的行：先确认是否重新指派（未指派过的直接进选择窗口）
    const assigned = rows.filter((row) => String(row.owner_name ?? row.get?.('owner_name') ?? '').trim());
    if (assigned.length) {
      const names = [...new Set(assigned.map((row) => String(row.owner_name ?? row.get?.('owner_name') ?? '').trim()))];
      modal.confirm({
        title: '确认重新指派',
        content: `所选 ${rows.length} 行中有 ${assigned.length} 行已指派${
          names.length ? `（如 ${names.slice(0, 3).join('、')}）` : ''
        }，继续会覆盖原负责人。`,
        okText: '继续指派',
        cancelText: '取消',
        onOk: openOwnerModal,
      });
      return;
    }
    openOwnerModal();
  }

  async function submit() {
    const values = await form.validateFields();
    const rowIds = rowsRef.current
      .map((row) => Number(row.id ?? row[ctx.collection?.filterTargetKey || 'id']))
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
      const blockModel = getBlockModel();
      await blockModel?.resource?.refresh?.();
    } catch (error: any) {
      const detail = error?.response?.data?.errors?.[0]?.message || error?.response?.data?.message || error?.message;
      message.error(detail || '批量指派失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type={(model.props?.type as any) || 'default'}
        icon={model.props?.icon ? undefined : undefined}
        onClick={openModal}
      >
        {model.props?.title || '批量指派'}
      </Button>
      <Modal
        open={open}
        title="批量指派"
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="确定"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            将把已勾选的 <Typography.Text strong>{count}</Typography.Text> 行指派给同一个负责人。
          </Typography.Text>
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

export class DailyBatchAssignActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;

  defaultProps: ButtonProps = { children: '批量指派', type: 'default' };

  render() {
    return <DailyBatchAssignButton model={this} />;
  }
}

DailyBatchAssignActionModel.define({
  label: '批量指派',
});
