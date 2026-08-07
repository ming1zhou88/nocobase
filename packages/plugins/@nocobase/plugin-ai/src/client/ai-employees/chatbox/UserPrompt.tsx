/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useEffect, useState } from 'react';
import { useAPIClient, useMobileLayout, useToken } from '@nocobase/client';
import { useT } from '../../locale';
import {
  Alert,
  Button,
  Popover,
  Card,
  App,
  Typography,
  Tooltip,
  Input,
  Space,
  Modal,
  Tabs,
  Select,
  Switch,
  Flex,
} from 'antd';
import { DeleteOutlined, InfoCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useChatBoxStore } from './stores/chat-box';
import { useAIConfigRepository } from '../../repositories/hooks/useAIConfigRepository';
import type { PromptTemplate, PromptTemplateField, PromptTemplateFieldType } from '../types';

export const UserPrompt: React.FC = () => {
  const t = useT();
  const { token } = useToken();
  const { isMobileLayout } = useMobileLayout();
  const { message } = App.useApp();
  const api = useAPIClient();
  const currentEmployee = useChatBoxStore.use.currentEmployee();
  const setCurrentEmployee = useChatBoxStore.use.setCurrentEmployee();
  const aiConfigRepository = useAIConfigRepository();
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);

  const open = isMobileLayout ? mobileOpen : desktopOpen;

  useEffect(() => {
    if (open) {
      setPrompt(currentEmployee?.userConfig?.prompt ?? '');
      setPromptTemplates(currentEmployee?.userConfig?.promptTemplates ?? []);
    }
  }, [open, currentEmployee?.userConfig?.prompt, currentEmployee?.userConfig?.promptTemplates]);

  const updateTemplate = (id: string, values: Partial<PromptTemplate>) => {
    setPromptTemplates((templates) =>
      templates.map((template) => (template.id === id ? { ...template, ...values } : template)),
    );
  };

  const updateTemplateField = (templateId: string, fieldKey: string, values: Partial<PromptTemplateField>) => {
    setPromptTemplates((templates) =>
      templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              fields: template.fields.map((field) => (field.key === fieldKey ? { ...field, ...values } : field)),
            }
          : template,
      ),
    );
  };

  const addTemplate = () => {
    const id = `prompt-${Date.now()}`;
    setPromptTemplates((templates) => [
      ...templates,
      {
        id,
        name: t('New prompt template'),
        shortcut: '',
        description: '',
        content: '',
        fields: [],
      },
    ]);
  };

  const addTemplateField = (templateId: string) => {
    const key = `field_${Date.now()}`;
    setPromptTemplates((templates) =>
      templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              fields: [...template.fields, { key, label: t('New field'), type: 'text' }],
            }
          : template,
      ),
    );
  };

  const closeEditor = () => {
    if (isMobileLayout) {
      setMobileOpen(false);
      return;
    }
    setDesktopOpen(false);
  };

  const savePrompt = async () => {
    if (!currentEmployee) {
      return;
    }
    const invalidTemplate = promptTemplates.find(
      (template) =>
        !template.name.trim() ||
        !template.content.trim() ||
        template.fields.some((field) => !field.key.trim() || !field.label.trim()) ||
        new Set(template.fields.map((field) => field.key.trim())).size !== template.fields.length,
    );
    const shortcuts = promptTemplates.map((template) => template.shortcut?.trim()).filter(Boolean);
    if (invalidTemplate || new Set(shortcuts).size !== shortcuts.length) {
      message.error(t('Complete the template and ensure field keys are unique'));
      return;
    }
    setSaving(true);
    try {
      await api.resource('aiEmployees').updateUserPrompt({
        values: {
          aiEmployee: currentEmployee.username,
          prompt,
          promptTemplates,
        },
      });
      await aiConfigRepository.refreshAIEmployees();
      setCurrentEmployee((prev) => ({
        ...prev,
        userConfig: {
          ...prev.userConfig,
          prompt,
          promptTemplates,
        },
      }));
      message.success(t('Saved successfully'));
      closeEditor();
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : t('Request failed'));
    } finally {
      setSaving(false);
    }
  };

  const editorCard = (
    <Card
      variant="borderless"
      size="small"
      styles={{
        body: {
          width: isMobileLayout ? 'auto' : '680px',
          maxWidth: 'calc(100vw - 32px)',
          padding: '16px',
        },
      }}
    >
      <Typography.Title
        level={5}
        style={{
          margin: 0,
          marginBottom: 12,
          fontSize: token.fontSizeLG,
          fontWeight: 500,
        }}
      >
        {t('AI prompt settings')}
      </Typography.Title>
      <Tabs
        items={[
          {
            key: 'prompt',
            label: t('Personalized prompt'),
            children: (
              <>
                <Typography.Paragraph style={{ marginBottom: 12, color: token.colorTextSecondary }}>
                  {t('Personalized prompt description')}
                </Typography.Paragraph>
                <Input.TextArea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  placeholder={t('Personalized prompt')}
                />
              </>
            ),
          },
          {
            key: 'templates',
            label: t('Prompt templates'),
            children: (
              <Flex vertical gap={12}>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                  {t('Prompt template description')}
                </Typography.Paragraph>
                {promptTemplates.map((template) => (
                  <Card
                    key={template.id}
                    size="small"
                    title={
                      <Input
                        value={template.name}
                        aria-label={t('Template name')}
                        onChange={(event) => updateTemplate(template.id, { name: event.target.value })}
                      />
                    }
                    extra={
                      <Button
                        type="text"
                        danger
                        aria-label={t('Delete template')}
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setPromptTemplates((templates) => templates.filter((item) => item.id !== template.id))
                        }
                      />
                    }
                  >
                    <Flex vertical gap={10}>
                      <Input
                        addonBefore="/"
                        value={template.shortcut}
                        placeholder={t('Slash command')}
                        onChange={(event) =>
                          updateTemplate(template.id, {
                            shortcut: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toLocaleLowerCase(),
                          })
                        }
                      />
                      <Input
                        value={template.description}
                        placeholder={t('Template description')}
                        onChange={(event) => updateTemplate(template.id, { description: event.target.value })}
                      />
                      <Input.TextArea
                        value={template.content}
                        autoSize={{ minRows: 3, maxRows: 8 }}
                        placeholder={t('Use [] to define editable slots in fixed text')}
                        onChange={(event) => updateTemplate(template.id, { content: event.target.value })}
                      />
                      {template.content.includes('[]') ? (
                        <Alert
                          type="info"
                          showIcon
                          message={t('Inline editable slots detected', {
                            count: template.content.split('[]').length - 1,
                          })}
                          description={t(
                            'Only text inside square brackets can be edited after inserting this template',
                          )}
                        />
                      ) : (
                        <>
                          {template.fields.map((field) => (
                            <Flex key={field.key} gap={6} align="center" wrap>
                              <Input
                                style={{ width: 110 }}
                                value={field.key}
                                placeholder={t('Field key')}
                                onChange={(event) =>
                                  updateTemplateField(template.id, field.key, { key: event.target.value })
                                }
                              />
                              <Input
                                style={{ width: 130 }}
                                value={field.label}
                                placeholder={t('Field label')}
                                onChange={(event) =>
                                  updateTemplateField(template.id, field.key, { label: event.target.value })
                                }
                              />
                              <Select<PromptTemplateFieldType>
                                style={{ width: 110 }}
                                value={field.type}
                                options={(['text', 'textarea', 'number', 'select', 'boolean'] as const).map((type) => ({
                                  value: type,
                                  label: t(type),
                                }))}
                                onChange={(type) => updateTemplateField(template.id, field.key, { type })}
                              />
                              {field.type === 'select' ? (
                                <Input
                                  style={{ width: 160 }}
                                  value={(field.options ?? []).join(',')}
                                  placeholder={t('Options separated by commas')}
                                  onChange={(event) =>
                                    updateTemplateField(template.id, field.key, {
                                      options: event.target.value
                                        .split(',')
                                        .map((option) => option.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                />
                              ) : null}
                              {field.type !== 'boolean' ? (
                                <Input
                                  style={{ width: 150 }}
                                  value={field.defaultValue === undefined ? '' : String(field.defaultValue)}
                                  placeholder={t('Default value')}
                                  onChange={(event) =>
                                    updateTemplateField(template.id, field.key, {
                                      defaultValue:
                                        field.type === 'number' && event.target.value !== ''
                                          ? Number(event.target.value)
                                          : event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <Tooltip title={t('Default value')}>
                                  <Switch
                                    checked={Boolean(field.defaultValue)}
                                    onChange={(defaultValue) =>
                                      updateTemplateField(template.id, field.key, { defaultValue })
                                    }
                                  />
                                </Tooltip>
                              )}
                              <Input
                                style={{ width: 150 }}
                                value={field.placeholder}
                                placeholder={t('Field placeholder')}
                                onChange={(event) =>
                                  updateTemplateField(template.id, field.key, { placeholder: event.target.value })
                                }
                              />
                              <Tooltip title={t('Required field')}>
                                <Switch
                                  checked={field.required}
                                  onChange={(required) => updateTemplateField(template.id, field.key, { required })}
                                />
                              </Tooltip>
                              <Button
                                type="text"
                                danger
                                aria-label={t('Delete field')}
                                icon={<DeleteOutlined />}
                                onClick={() =>
                                  updateTemplate(template.id, {
                                    fields: template.fields.filter((item) => item.key !== field.key),
                                  })
                                }
                              />
                            </Flex>
                          ))}
                          <Button icon={<PlusOutlined />} onClick={() => addTemplateField(template.id)}>
                            {t('Add field')}
                          </Button>
                        </>
                      )}
                    </Flex>
                  </Card>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={addTemplate}>
                  {t('Add prompt template')}
                </Button>
              </Flex>
            ),
          },
        ]}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 12,
        }}
      >
        <Space>
          <Button onClick={closeEditor}>{t('Cancel')}</Button>
          <Button type="primary" loading={saving} onClick={savePrompt}>
            {t('Submit')}
          </Button>
        </Space>
      </div>
    </Card>
  );

  return (
    <>
      {isMobileLayout ? (
        <Tooltip arrow={false} title={t('Personalized prompt')}>
          <Button icon={<InfoCircleOutlined />} type="text" onClick={() => setMobileOpen(true)} />
        </Tooltip>
      ) : (
        <Tooltip arrow={false} title={t('Personalized prompt')}>
          <Popover
            zIndex={1101}
            placement="bottomRight"
            open={desktopOpen}
            onOpenChange={setDesktopOpen}
            trigger="click"
            styles={{
              body: {
                padding: 0,
                marginRight: '8px',
              },
            }}
            arrow={false}
            content={editorCard}
          >
            <Button icon={<InfoCircleOutlined />} type="text" />
          </Popover>
        </Tooltip>
      )}
      <Modal
        open={isMobileLayout && mobileOpen}
        onCancel={closeEditor}
        footer={null}
        centered
        width="calc(100vw - 32px)"
        styles={{ body: { padding: 0 } }}
        destroyOnClose
      >
        {editorCard}
      </Modal>
    </>
  );
};
