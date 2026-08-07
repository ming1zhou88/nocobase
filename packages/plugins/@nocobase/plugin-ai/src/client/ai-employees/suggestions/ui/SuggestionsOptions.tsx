/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { CSSProperties, useState } from 'react';
import { useChat } from '../../chatbox/hooks/useChat';
import { Button, Flex, Spin, Space, ButtonProps } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useT } from '../../../locale';
import { ToolsUIProperties } from '@nocobase/client';
import { useChatBoxStore } from '../../chatbox/stores/chat-box';
import { useChatConversationsStore } from '../../chatbox/stores/chat-conversations';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { css } from '@emotion/css';
import { useToken } from '@nocobase/client';

export const SuggestionsOptions: React.FC<
  ToolsUIProperties<{
    options: string[];
  }>
> = ({ messageId, toolCall, decisions }) => {
  const t = useT();
  const { token } = useToken();
  const currentConversation = useChatConversationsStore.use.currentConversation();
  const chat = useChat(currentConversation);
  const responseLoading = chat.use.responseLoading();
  const messages = chat.use.messages();
  const [disabled, setDisabled] = useState(false);
  const [selected, setSelected] = useState(null);
  const generating = responseLoading && messages[messages.length - 1]?.content.messageId === messageId;
  const readonly = useChatBoxStore.use.readonly();

  const optionClassName = css`
    min-width: 160px;
    max-width: 360px;
    padding: 10px 14px;
    border-radius: ${token.borderRadiusLG}px;
    transition:
      transform ${token.motionDurationMid},
      box-shadow ${token.motionDurationMid},
      border-color ${token.motionDurationMid};

    &:not(:disabled):hover,
    &:not(:disabled):focus-visible {
      transform: translateY(-2px);
      border-color: ${token.colorPrimaryBorderHover};
      box-shadow: 0 6px 18px ${token.colorFillSecondary};
    }

    .ai-suggestion-markdown > :first-child {
      margin-top: 0;
    }

    .ai-suggestion-markdown > :last-child {
      margin-bottom: 0;
    }
  `;
  const btnStyle: CSSProperties = {
    whiteSpace: 'normal',
    textAlign: 'left',
    height: 'auto',
    borderWidth: 1,
    background: `linear-gradient(135deg, ${token.colorBgContainer}, ${token.colorFillQuaternary})`,
  };
  const defaultBtnProps: ButtonProps = {
    style: {
      ...btnStyle,
    },
    color: 'default',
    variant: 'outlined',
  };
  const selectedBtnProps: ButtonProps = {
    style: {
      ...btnStyle,
      borderWidth: 2,
    },
    color: 'default',
    variant: 'dashed',
  };
  const btnProps = (option: string): ButtonProps =>
    toolCall.selectedSuggestion === option || selected === option ? selectedBtnProps : defaultBtnProps;

  const optionsInArgs: unknown = toolCall.args?.options ?? [];
  let options = [];
  if (typeof optionsInArgs === 'string') {
    try {
      options = JSON.parse(optionsInArgs);
    } catch (e) {
      console.log(`fail to convert args from tool call ${toolCall.name}`, toolCall.args);
    }
  } else {
    options = optionsInArgs as string[];
  }

  return generating ? (
    <Space>
      <Spin indicator={<LoadingOutlined spin />} size="small" /> {t('Generating...')}
    </Space>
  ) : (
    <Flex align="flex-start" gap="middle" wrap={true}>
      {options.map((option, index) => (
        <Button
          key={index}
          className={optionClassName}
          disabled={toolCall.invokeStatus !== 'interrupted' || disabled || readonly}
          {...btnProps(option)}
          onClick={() => {
            if (disabled) {
              return;
            }
            setDisabled(true);
            setSelected(option);
            decisions.edit({ ...(toolCall.args ?? {}), option });
          }}
        >
          <div className="ai-suggestion-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{option}</ReactMarkdown>
          </div>
        </Button>
      ))}
    </Flex>
  );
};
