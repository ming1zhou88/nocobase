/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Sender as AntSender } from '@ant-design/x';
import { GetRef } from 'antd';
import { css } from '@emotion/css';
import { useT } from '../../locale';
import { SenderFooter } from './SenderFooter';
import { SenderHeader } from './SenderHeader';
import { useChatConversationsStore } from './stores/chat-conversations';
import { useChat } from './hooks/useChat';
import { useChatMessageActions } from './hooks/useChatMessageActions';
import { useChatBoxStore } from './stores/chat-box';
import { useChatBoxActions } from './hooks/useChatBoxActions';
import { useUploadFiles } from './hooks/useUploadFiles';
import { useAIConfigRepository } from '../../repositories/hooks/useAIConfigRepository';
import _ from 'lodash';
import { PromptCommandMenu } from './PromptCommandMenu';
import { TemplateSender } from './TemplateSender';

const useSendMessage = () => {
  const currentEmployee = useChatBoxStore.use.currentEmployee();
  const isEditingMessage = useChatBoxStore.use.isEditingMessage();
  const editingMessageId = useChatBoxStore.use.editingMessageId();
  const setShowSenderHint = useChatBoxStore.use.setShowSenderHint();

  const currentConversation = useChatConversationsStore.use.currentConversation();
  const chat = useChat(currentConversation);
  const webSearch = useChatConversationsStore.use.webSearch();

  const attachments = chat.use.attachments();
  const contextItems = chat.use.contextItems();
  const systemMessage = chat.use.systemMessage();
  const skillSettings = chat.use.skillSettings();

  const { finishEditingMessage } = useChatMessageActions();

  const { send } = useChatBoxActions();
  const handleSubmit = (content: string) => {
    setShowSenderHint(false);
    send({
      sessionId: currentConversation,
      aiEmployee: currentEmployee,
      systemMessage,
      messages: [
        {
          type: 'text',
          content,
        },
      ],
      attachments: attachments.filter((x) => x.status === 'done'),
      workContext: contextItems,
      editingMessageId: isEditingMessage ? editingMessageId : undefined,
      skillSettings,
      webSearch,
    });

    if (isEditingMessage) {
      finishEditingMessage();
    }
  };

  return [handleSubmit];
};

export const Sender: React.FC = () => {
  const t = useT();
  const senderClassName = css`
    .ant-sender-content {
      padding: 16px;
    }
  `;
  const [handleSubmit] = useSendMessage();
  const senderRef = useRef<GetRef<typeof AntSender> | null>(null);

  const senderValue = useChatBoxStore.use.senderValue();
  const setSenderValue = useChatBoxStore.use.setSenderValue();
  const currentEmployee = useChatBoxStore.use.currentEmployee();
  const currentConversation = useChatConversationsStore.use.currentConversation();
  const chat = useChat(currentConversation);
  const setShowSenderHint = useChatBoxStore.use.setShowSenderHint();
  const setSenderRef = useChatBoxStore.use.setSenderRef();
  const readonly = useChatBoxStore.use.readonly();
  const activeTemplateId = useChatBoxStore.use.activeTemplateId();
  const setActiveTemplateId = useChatBoxStore.use.setActiveTemplateId();
  const setCurrentEmployee = useChatBoxStore.use.setCurrentEmployee();
  const aiConfigRepository = useAIConfigRepository();

  const setAttachments = chat.setAttachments;
  const uploadProps = useUploadFiles();

  const responseLoading = chat.use.responseLoading();

  const { cancelRequest } = useChatMessageActions();

  const [value, setValue] = useState(senderValue);

  useEffect(() => {
    setSenderRef(senderRef);
  }, [setSenderRef]);

  useEffect(() => {
    if (value !== senderValue) {
      setSenderValue(value);
    }
  }, [senderValue, setSenderValue, value]);

  useEffect(() => {
    setValue(senderValue);
  }, [senderValue]);

  const submitMessage = (content: string) => {
    handleSubmit(content);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let file = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        file = items[i].getAsFile();
        break;
      }
    }

    if (!file) {
      return;
    }
    e.preventDefault();

    const uid = Date.now().toString();
    const rawFile = file;
    const uploadFile = {
      uid,
      name: rawFile.name,
      status: 'uploading',
      originFileObj: rawFile,
      percent: 0,
      type: rawFile.type,
      size: rawFile.size,
    };

    setAttachments((prev) => [...prev, uploadFile]);
    const { customRequest, data, headers, action } = uploadProps;

    if (customRequest) {
      customRequest({
        file: rawFile,
        filename: 'file',
        data,
        headers,
        action,
        onProgress: ({ percent }) => {
          setAttachments((prev) =>
            prev.map((item) => {
              if (item.uid === uid) {
                return { ...item, percent };
              }
              return item;
            }),
          );
        },
        onSuccess: (response, xhr) => {
          const fileData = response?.data;
          setAttachments((prev) =>
            prev.map((item) => {
              if (item.uid === uid) {
                if (!fileData) {
                  return {
                    ...item,
                    status: 'done',
                    response,
                  };
                }
                return {
                  ...fileData,
                  status: 'done',
                };
              }
              return item;
            }),
          );
        },
        onError: (err) => {
          setAttachments((prev) =>
            prev.map((item) => {
              if (item.uid === uid) {
                return { ...item, status: 'error', error: err };
              }
              return item;
            }),
          );
        },
      });
    }
  };

  const activeTemplate = activeTemplateId
    ? currentEmployee?.chatSettings?.conversationTemplates?.find((tpl) => tpl.id === activeTemplateId)
    : null;

  if (activeTemplate) {
    return (
      <TemplateSender
        template={activeTemplate}
        onSubmit={(content) => {
          submitMessage(content);
          setActiveTemplateId(null);
        }}
        onCancel={() => setActiveTemplateId(null)}
        disabled={responseLoading}
      />
    );
  }

  return (
    <div
      style={{
        margin: '8px 16px',
        position: 'relative',
      }}
    >
      <PromptCommandMenu
        value={value}
        onSelectConversationTemplate={async (tpl) => {
          setValue('');
          // Refresh employee data to ensure template content is up-to-date
          if (currentEmployee?.username) {
            const employees = await aiConfigRepository.refreshAIEmployees();
            const fresh = employees.find((e) => e.username === currentEmployee.username);
            if (fresh) {
              setCurrentEmployee(fresh);
            }
          }
          setActiveTemplateId(tpl.id);
        }}
      />
      <AntSender
        // components={{
        //   input: VariableInput,
        // }}
        className={senderClassName}
        value={value}
        ref={senderRef}
        onChange={setValue}
        onPaste={handlePaste}
        onSubmit={submitMessage}
        onCancel={cancelRequest}
        onBlur={() => {
          setShowSenderHint(false);
        }}
        header={<SenderHeader />}
        loading={responseLoading}
        footer={({ components }) => <SenderFooter components={components} handleSubmit={submitMessage} />}
        disabled={!currentEmployee || readonly}
        placeholder={t('Enter your question or type / for templates')}
        actions={false}
        autoSize={{ minRows: 2, maxRows: 8 }}
      />
    </div>
  );
};
