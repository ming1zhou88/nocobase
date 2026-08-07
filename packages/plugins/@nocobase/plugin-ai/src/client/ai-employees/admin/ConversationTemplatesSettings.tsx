/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Flex, Input, Tabs, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useForm } from '@formily/react';
import { observer } from '@nocobase/flow-engine';
import { useT } from '../../locale';
import type { ConversationTemplate } from '../types';

const { TextArea } = Input;

const TemplateEditor: React.FC<{
  template: ConversationTemplate;
  onUpdate: (values: Partial<ConversationTemplate>) => void;
}> = ({ template, onUpdate }) => {
  const t = useT();
  return (
    <Flex vertical gap={10} style={{ padding: '4px 0' }}>
      <Input
        value={template.description}
        placeholder={t('Template description')}
        onChange={(e) => onUpdate({ description: e.target.value })}
      />
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {t('Use {{field_key}} in content to mark editable placeholders')}
        </Typography.Text>
        <TextArea
          value={template.content}
          autoSize={{ minRows: 3, maxRows: 10 }}
          placeholder={t('Template content placeholder')}
          onChange={(e) => onUpdate({ content: e.target.value })}
        />
      </div>
    </Flex>
  );
};

const TemplateTabLabel: React.FC<{
  title: string;
  active: boolean;
  onRename: (next: string) => void;
}> = ({ title, active, onRename }) => {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next);
  };

  if (editing) {
    return (
      <Input
        size="small"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onPressEnter={commit}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 160 }}
      />
    );
  }

  return (
    <Flex gap={4} align="center" style={{ maxWidth: 220 }}>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 180,
        }}
      >
        {title || t('Untitled')}
      </span>
      {active ? (
        <Tooltip title={t('Rename')}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={startEdit}
            style={{ padding: '0 2px' }}
            aria-label={t('Rename')}
          />
        </Tooltip>
      ) : null}
    </Flex>
  );
};

export const ConversationTemplatesSettings: React.FC = observer(() => {
  const t = useT();
  const form = useForm();
  const chatSettings = useMemo(() => form.values.chatSettings ?? {}, [form.values.chatSettings]);
  const templates: ConversationTemplate[] = chatSettings.conversationTemplates ?? [];
  const [activeKey, setActiveKey] = useState<string | undefined>(templates[0]?.id);

  const updateChatSettings = useCallback(
    (values: Record<string, unknown>) => {
      form.setValuesIn('chatSettings', { ...chatSettings, ...values });
    },
    [form, chatSettings],
  );

  const updateTemplates = (next: ConversationTemplate[]) => {
    updateChatSettings({ conversationTemplates: next });
  };

  const addTemplate = () => {
    const id = `tpl-${Date.now()}`;
    const next = [
      ...templates,
      { id, title: t('New conversation template'), description: '', content: '', fields: [] },
    ];
    updateTemplates(next);
    setActiveKey(id);
  };

  const updateTemplate = (id: string, values: Partial<ConversationTemplate>) => {
    updateTemplates(templates.map((tpl) => (tpl.id === id ? { ...tpl, ...values } : tpl)));
  };

  const deleteTemplate = (id: string) => {
    const next = templates.filter((tpl) => tpl.id !== id);
    updateTemplates(next);
    if (activeKey === id) {
      setActiveKey(next[0]?.id);
    }
  };

  const tabItems = templates.map((template) => ({
    key: template.id,
    label: (
      <TemplateTabLabel
        title={template.title}
        active={activeKey === template.id}
        onRename={(next) => updateTemplate(template.id, { title: next })}
      />
    ),
    children: (
      <Flex vertical gap={10}>
        <Flex justify="flex-end">
          <Button
            type="text"
            danger
            aria-label={t('Delete template')}
            icon={<DeleteOutlined />}
            onClick={() => deleteTemplate(template.id)}
          >
            {t('Delete template')}
          </Button>
        </Flex>
        <TemplateEditor template={template} onUpdate={(values) => updateTemplate(template.id, values)} />
      </Flex>
    ),
  }));

  return (
    <Flex vertical gap={12}>
      <Alert type="info" showIcon message={t('Conversation templates description')} />
      {templates.length > 0 ? (
        <Tabs
          type="editable-card"
          activeKey={activeKey}
          onChange={setActiveKey}
          onEdit={(key, action) => {
            if (action === 'add') addTemplate();
          }}
          items={tabItems}
          addIcon={
            <Tooltip title={t('Add conversation template')}>
              <PlusOutlined />
            </Tooltip>
          }
          hideAdd={false}
        />
      ) : (
        <Button type="dashed" icon={<PlusOutlined />} onClick={addTemplate}>
          {t('Add conversation template')}
        </Button>
      )}
    </Flex>
  );
});
