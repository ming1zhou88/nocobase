import { ActionModel, ActionSceneEnum } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import { App, Button, Checkbox, Modal, Select, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ButtonProps } from 'antd';
import React, { useState } from 'react';

const FILTER_KEY = 'daily-type-label-filter';
const OPTIONS = ['快递咨询', '反馈快递问题', '反馈产品问题', '要求退款', '要求退货', '其他问题'];

function blockOf(ctx: any) {
  const context = (ctx.model?.context || {}) as any;
  return context.blockModel || (ctx.model as any)?.parent;
}

function readApplied(resource: any): { selected: string[]; exact: boolean; active: boolean } {
  const group = resource?.filterGroups?.get(FILTER_KEY);
  if (!group) return { selected: [], exact: false, active: false };
  if (group.type_label?.$eq) return { selected: [group.type_label.$eq], exact: true, active: true };
  const items = Array.isArray(group.$and) ? group.$and : [];
  const selected = items
    .map((item: any) => item?.type_label?.$includes)
    .filter((value: any) => typeof value === 'string');
  return { selected, exact: false, active: selected.length > 0 };
}

function DailyTypeLabelFilterButton({ model }: { model: DailyTypeLabelFilterActionModel }) {
  const ctx = useFlowContext();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const initial = readApplied(blockOf(ctx)?.resource);
  const [selected, setSelected] = useState<string[]>(initial.selected);
  const [exact, setExact] = useState(initial.exact);
  const [active, setActive] = useState(initial.active);

  function applyFilter() {
    const block = blockOf(ctx);
    const resource = block?.resource;
    if (!resource) {
      message.error('找不到表格资源，无法筛选');
      return;
    }

    if (typeof resource.removeFilterGroup === 'function') {
      resource.removeFilterGroup(FILTER_KEY);
    }
    if (block?.setFilterActive) block.setFilterActive(FILTER_KEY, false);

    if (!selected.length) {
      setActive(false);
      if (typeof resource.setPage === 'function') resource.setPage(1);
      resource.refresh();
      setOpen(false);
      return;
    }

    const filter =
      exact && selected.length === 1
        ? { type_label: { $eq: selected[0] } }
        : { $and: selected.map((label) => ({ type_label: { $includes: label } })) };

    if (typeof resource.addFilterGroup !== 'function') {
      message.error('当前表格资源不支持筛选组');
      return;
    }
    resource.addFilterGroup(FILTER_KEY, filter);
    if (block?.setFilterActive) block.setFilterActive(FILTER_KEY, true);
    setActive(true);
    if (typeof resource.setPage === 'function') resource.setPage(1);
    resource.refresh();
    message.success(
      exact && selected.length === 1 ? `已按完全匹配筛选：${selected[0]}` : `已筛选同时包含：${selected.join(' + ')}`,
    );
    setOpen(false);
  }

  function clearFilter() {
    const block = blockOf(ctx);
    const resource = block?.resource;
    if (resource && typeof resource.removeFilterGroup === 'function') {
      resource.removeFilterGroup(FILTER_KEY);
    }
    if (block?.setFilterActive) block.setFilterActive(FILTER_KEY, false);
    setSelected([]);
    setExact(false);
    setActive(false);
    if (resource) {
      if (typeof resource.setPage === 'function') resource.setPage(1);
      resource.refresh();
    }
  }

  return (
    <>
      <Tooltip title={active ? '点击清除问题类型筛选' : '按问题类型标识筛选'}>
        <Button
          type={(model.props?.type as any) || 'default'}
          icon={active ? <ReloadOutlined /> : undefined}
          onClick={() => {
            if (active) {
              clearFilter();
              return;
            }
            setOpen(true);
          }}
        >
          {active ? '问题类型筛选（已启用）' : model.props?.title || '问题类型筛选'}
        </Button>
      </Tooltip>
      <Modal
        open={open}
        title="按问题类型标识筛选"
        onCancel={() => setOpen(false)}
        width={560}
        footer={[
          <Button key="clear" onClick={clearFilter}>
            清空筛选
          </Button>,
          <Button key="close" onClick={() => setOpen(false)}>
            关闭
          </Button>,
          <Button key="search" type="primary" onClick={applyFilter}>
            筛选
          </Button>,
        ]}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Typography.Text type="secondary">选择多个时，只显示同时包含全部所选类型的数据行。</Typography.Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="选择一个或多个问题类型"
            options={OPTIONS.map((label) => ({ label, value: label }))}
            value={selected}
            onChange={(values) => setSelected(values)}
          />
          <Checkbox
            checked={exact}
            disabled={selected.length !== 1}
            onChange={(event) => setExact(event.target.checked)}
          >
            完全匹配（仅选中一项时可用）
          </Checkbox>
          <Typography.Text type="secondary">
            示例：选“其他问题”会包含“反馈产品问题,其他问题”；勾选完全匹配后只包含“其他问题”。
          </Typography.Text>
        </Space>
      </Modal>
    </>
  );
}

export class DailyTypeLabelFilterActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;
  defaultProps: ButtonProps = { children: '问题类型筛选', type: 'default' };
  render() {
    return <DailyTypeLabelFilterButton model={this} />;
  }
}

DailyTypeLabelFilterActionModel.define({ label: '问题类型筛选' });
