/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Input, InputNumber, Modal, Select, Switch, Typography, Button, Empty, Flex, Divider } from 'antd';
import { FormOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import { useApp, useToken } from '@nocobase/client';
import type { ConversationTemplate, PromptTemplate, PromptTemplateField } from '../types';
import { useT } from '../../locale';
import { useChatBoxStore } from './stores/chat-box';
import { buildPromptTemplateSlotValue, getPromptTemplateSlotParts } from './prompt-template-slots';

const renderField = (field: PromptTemplateField) => {
  switch (field.type) {
    case 'textarea':
      return <Input.TextArea rows={4} placeholder={field.placeholder} />;
    case 'number':
      return <InputNumber style={{ width: '100%' }} placeholder={field.placeholder} />;
    case 'select':
      return <Select options={(field.options ?? []).map((option) => ({ label: option, value: option }))} />;
    case 'boolean':
      return <Switch />;
    default:
      return <Input placeholder={field.placeholder} />;
  }
};

export const fillPromptTemplate = (template: PromptTemplate, values: Record<string, unknown>) => {
  let content = template.content;
  template.fields.forEach((field) => {
    const rawValue = values[field.key] ?? field.defaultValue ?? '';
    const value = typeof rawValue === 'boolean' ? (rawValue ? 'Yes' : 'No') : String(rawValue);
    content = content.replaceAll(`{{${field.key}}}`, value).replaceAll(`[[${field.key}]]`, value);
  });
  return content.replace(/\n{3,}/g, '\n\n').trim();
};

export const PromptCommandMenu: React.FC<{
  value: string;
  onApply: (value: string, slotParts?: string[]) => void;
  onSelectConversationTemplate?: (template: ConversationTemplate) => void;
}> = ({ value, onApply, onSelectConversationTemplate }) => {
  const t = useT();
  const { token } = useToken();
  const app = useApp();
  const hasConfigPermission = app.pluginSettingsManager.has('ai.employees');
  const currentEmployee = useChatBoxStore.use.currentEmployee();
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [form] = Form.useForm<Record<string, unknown>>();

  const promptTemplates = useMemo(
    () => currentEmployee?.userConfig?.promptTemplates ?? [],
    [currentEmployee?.userConfig?.promptTemplates],
  );
  const conversationTemplates = useMemo(
    () => currentEmployee?.chatSettings?.conversationTemplates ?? [],
    [currentEmployee?.chatSettings?.conversationTemplates],
  );
  const command = value.startsWith('/') && !value.includes('\n') ? value.slice(1).trim().toLocaleLowerCase() : null;

  const matchedPromptTemplates = useMemo(
    () =>
      command === null
        ? []
        : promptTemplates.filter((template) =>
            `${template.shortcut ?? ''} ${template.name} ${template.description ?? ''}`
              .toLocaleLowerCase()
              .includes(command),
          ),
    [command, promptTemplates],
  );
  const matchedConversationTemplates = useMemo(
    () =>
      command === null
        ? []
        : conversationTemplates.filter((template) =>
            `${template.title} ${template.description ?? ''}`.toLocaleLowerCase().includes(command),
          ),
    [command, conversationTemplates],
  );
  const matches = matchedPromptTemplates.length + matchedConversationTemplates.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [command]);

  const choosePromptTemplate = useCallback(
    (template: PromptTemplate) => {
      const slotParts = getPromptTemplateSlotParts(template.content);
      if (slotParts) {
        onApply(buildPromptTemplateSlotValue(slotParts), slotParts);
        return;
      }
      setSelectedTemplate(template);
      form.setFieldsValue(Object.fromEntries(template.fields.map((field) => [field.key, field.defaultValue])));
    },
    [form, onApply],
  );

  const chooseConversationTemplate = useCallback(
    (template: ConversationTemplate) => {
      onSelectConversationTemplate?.(template);
    },
    [onSelectConversationTemplate],
  );

  const chooseByIndex = useCallback(
    (index: number) => {
      if (index < matchedPromptTemplates.length) {
        choosePromptTemplate(matchedPromptTemplates[index]);
      } else {
        chooseConversationTemplate(matchedConversationTemplates[index - matchedPromptTemplates.length]);
      }
    },
    [choosePromptTemplate, chooseConversationTemplate, matchedPromptTemplates, matchedConversationTemplates],
  );

  useEffect(() => {
    if (command === null || selectedTemplate || matches === 0) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((index) => (index + offset + matches) % matches);
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        chooseByIndex(activeIndex);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeIndex, chooseByIndex, command, matches, selectedTemplate]);

  const applyTemplate = async () => {
    if (!selectedTemplate) {
      return;
    }
    const values = await form.validateFields();
    onApply(fillPromptTemplate(selectedTemplate, values));
    setSelectedTemplate(null);
    form.resetFields();
  };

  return (
    <>
      {command !== null ? (
        <div
          role="listbox"
          aria-label={t('Prompt templates')}
          style={{
            position: 'absolute',
            zIndex: 10,
            left: 0,
            right: 0,
            bottom: 'calc(100% + 8px)',
            maxHeight: 280,
            overflowY: 'auto',
            padding: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            background: token.colorBgElevated,
            boxShadow: token.boxShadowSecondary,
          }}
        >
          {matches === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No matching prompt templates')} />
          ) : (
            <Flex vertical gap={4}>
              {matchedPromptTemplates.map((template, idx) => (
                <Button
                  key={template.id}
                  type="text"
                  role="option"
                  aria-selected={idx === activeIndex}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => choosePromptTemplate(template)}
                  style={{
                    height: 'auto',
                    padding: '8px 10px',
                    textAlign: 'left',
                    background: idx === activeIndex ? token.colorPrimaryBg : undefined,
                  }}
                >
                  <Flex gap={10} align="flex-start">
                    <FormOutlined style={{ marginTop: 4, color: token.colorPrimary }} />
                    <div>
                      <Typography.Text strong>{template.name}</Typography.Text>
                      {template.shortcut ? (
                        <Typography.Text code style={{ marginLeft: 8 }}>
                          /{template.shortcut}
                        </Typography.Text>
                      ) : null}
                      {template.description ? (
                        <Typography.Text type="secondary" style={{ display: 'block', whiteSpace: 'normal' }}>
                          {template.description}
                        </Typography.Text>
                      ) : null}
                    </div>
                  </Flex>
                </Button>
              ))}
              {matchedPromptTemplates.length > 0 && matchedConversationTemplates.length > 0 ? (
                <Divider style={{ margin: '4px 0' }} />
              ) : null}
              {matchedConversationTemplates.map((template, idx) => {
                const index = matchedPromptTemplates.length + idx;
                return (
                  <Button
                    key={template.id}
                    type="text"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseConversationTemplate(template)}
                    style={{
                      height: 'auto',
                      padding: '8px 10px',
                      textAlign: 'left',
                      background: index === activeIndex ? token.colorPrimaryBg : undefined,
                    }}
                  >
                    <Flex gap={10} align="flex-start">
                      <MessageOutlined style={{ marginTop: 4, color: token.colorSuccess }} />
                      <div>
                        <Typography.Text strong>{template.title}</Typography.Text>
                        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          {t('Conversation template')}
                        </Typography.Text>
                        {template.description ? (
                          <Typography.Text type="secondary" style={{ display: 'block', whiteSpace: 'normal' }}>
                            {template.description}
                          </Typography.Text>
                        ) : null}
                      </div>
                    </Flex>
                  </Button>
                );
              })}
            </Flex>
          )}
          {hasConfigPermission ? (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <Button
                type="text"
                block
                icon={<PlusOutlined />}
                onClick={() => {
                  const path = app.pluginSettingsManager.getRoutePath('ai.employees');
                  window.open(path, '_blank');
                }}
                style={{ textAlign: 'left' }}
              >
                {t('Add conversation template')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <Modal
        open={!!selectedTemplate}
        title={selectedTemplate?.name}
        okText={t('Insert')}
        cancelText={t('Cancel')}
        onOk={applyTemplate}
        onCancel={() => setSelectedTemplate(null)}
        destroyOnClose
      >
        {selectedTemplate?.description ? (
          <Typography.Paragraph type="secondary">{selectedTemplate.description}</Typography.Paragraph>
        ) : null}
        <Form form={form} layout="vertical" preserve={false}>
          {selectedTemplate?.fields.map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={field.label}
              valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
              rules={field.required ? [{ required: true, message: t('This field is required') }] : undefined}
            >
              {renderField(field)}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </>
  );
};
