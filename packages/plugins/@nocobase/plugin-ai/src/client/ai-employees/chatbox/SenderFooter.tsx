/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useEffect, useRef } from 'react';
import { Button, Divider, Dropdown, Flex, GetRef, Typography } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { Upload } from './Upload';
import { AddContextButton } from '../AddContextButton';
import { useChat } from './hooks/useChat';
import { useChatBoxStore } from './stores/chat-box';
import { useChatConversationsStore } from './stores/chat-conversations';
import { useT } from '../../locale';
import _ from 'lodash';
import { SearchSwitch } from './SearchSwitch';
import { ModelSwitcher } from './ModelSwitcher';
import { AIEmployeeSwitcher } from './AIEmployeeSwitch';

export const SenderFooter: React.FC<{
  components: any;
  handleSubmit: (content: string) => void;
}> = ({ components, handleSubmit }) => {
  const t = useT();
  const { SendButton, LoadingButton } = components;
  const senderButtonRef = useRef<GetRef<typeof Button> | null>(null);
  const currentEmployee = useChatBoxStore.use.currentEmployee?.();
  const currentConversation = useChatConversationsStore.use.currentConversation();
  const chat = useChat(currentConversation);
  const readonly = useChatBoxStore.use.readonly();
  const setActiveTemplateId = useChatBoxStore.use.setActiveTemplateId();

  const loading = chat.use.responseLoading();
  const addContextItems = chat.addContextItems;
  const removeContextItem = chat.removeContextItem;

  const senderValue = useChatBoxStore.use.senderValue();
  const contextItems = chat.use.contextItems();
  const handleEmptySubmit = () => {
    if (_.isEmpty(senderValue) && contextItems.length) {
      handleSubmit('');
    }
  };

  const senderRef = useChatBoxStore.use.senderRef();
  useEffect(() => {
    if (senderRef?.current?.nativeElement) {
      senderRef.current.nativeElement.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (_.isEmpty(senderValue) && contextItems.length) {
            senderButtonRef.current?.click();
          }
        }
      };
    }
  }, [senderRef, senderValue, contextItems]);

  const disabled = !currentEmployee || readonly;
  const conversationTemplates = currentEmployee?.chatSettings?.conversationTemplates ?? [];

  const templateMenuItems = conversationTemplates.map((tpl) => ({
    key: tpl.id,
    label: (
      <div>
        <Typography.Text strong>{tpl.title}</Typography.Text>
        {tpl.description ? (
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, whiteSpace: 'normal' }}>
            {tpl.description}
          </Typography.Text>
        ) : null}
      </div>
    ),
    onClick: () => setActiveTemplateId(tpl.id),
  }));

  return (
    <Flex justify="space-between" align="center" gap="small">
      <Flex gap="middle" align="center" style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <AddContextButton
          onAdd={addContextItems}
          onRemove={removeContextItem}
          disabled={disabled}
          ignore={(key) => key === 'flow-model.variable'}
        />
        <Upload disabled={disabled} />
        <SearchSwitch disabled={disabled} />
        {conversationTemplates.length > 0 ? (
          <Dropdown menu={{ items: templateMenuItems }} trigger={['click']} placement="topLeft">
            <Button
              type="text"
              icon={<MessageOutlined />}
              disabled={disabled}
              aria-label={t('Conversation templates')}
            />
          </Dropdown>
        ) : null}
        <AIEmployeeSwitcher disabled={readonly} />
        <ModelSwitcher disabled={disabled} />
      </Flex>
      <Flex align="center" gap="middle" style={{ flex: 'none' }}>
        {loading ? (
          <LoadingButton type="default" />
        ) : (
          <SendButton ref={senderButtonRef} type="primary" disabled={false} onClick={handleEmptySubmit} />
        )}
      </Flex>
    </Flex>
  );
};
