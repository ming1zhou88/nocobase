/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Typography, Button, Empty, Flex, Divider } from 'antd';
import { MessageOutlined, PlusOutlined } from '@ant-design/icons';
import { useApp, useToken } from '@nocobase/client';
import type { ConversationTemplate } from '../types';
import { useT } from '../../locale';
import { useChatBoxStore } from './stores/chat-box';

export const PromptCommandMenu: React.FC<{
  value: string;
  onSelectConversationTemplate?: (template: ConversationTemplate) => void;
}> = ({ value, onSelectConversationTemplate }) => {
  const t = useT();
  const { token } = useToken();
  const app = useApp();
  const hasConfigPermission = app.pluginSettingsManager.has('ai.employees');
  const currentEmployee = useChatBoxStore.use.currentEmployee?.();
  const [activeIndex, setActiveIndex] = useState(0);
  const conversationTemplates = useMemo(
    () => currentEmployee?.chatSettings?.conversationTemplates ?? [],
    [currentEmployee?.chatSettings?.conversationTemplates],
  );
  const command = value.startsWith('/') && !value.includes('\n') ? value.slice(1).trim().toLocaleLowerCase() : null;
  const matchedConversationTemplates = useMemo(
    () =>
      command === null
        ? []
        : conversationTemplates.filter((template) =>
            `${template.title} ${template.description ?? ''}`.toLocaleLowerCase().includes(command),
          ),
    [command, conversationTemplates],
  );
  const matches = matchedConversationTemplates.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [command]);

  const chooseConversationTemplate = useCallback(
    (template: ConversationTemplate) => {
      onSelectConversationTemplate?.(template);
    },
    [onSelectConversationTemplate],
  );

  const chooseByIndex = useCallback(
    (index: number) => {
      chooseConversationTemplate(matchedConversationTemplates[index]);
    },
    [chooseConversationTemplate, matchedConversationTemplates],
  );

  useEffect(() => {
    if (command === null || matches === 0) {
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
  }, [activeIndex, chooseByIndex, command, matches]);

  return command !== null ? (
    <div
      role="listbox"
      aria-label={t('Conversation templates')}
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
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No matching conversation templates')} />
      ) : (
        <Flex vertical gap={4}>
          {matchedConversationTemplates.map((template, index) => (
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
          ))}
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
            style={{ height: 'auto', textAlign: 'left' }}
          >
            <Flex vertical align="flex-start" gap={0}>
              <span>{t('Add conversation template')}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
                {t(
                  'This opens AI employees settings. Select the target employee and switch to the Conversation templates tab to add or edit templates.',
                )}
              </Typography.Text>
            </Flex>
          </Button>
        </>
      ) : null}
    </div>
  ) : null;
};
