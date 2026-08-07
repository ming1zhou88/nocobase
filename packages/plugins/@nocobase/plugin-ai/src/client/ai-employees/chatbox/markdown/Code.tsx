/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useState } from 'react';
import { Card, Typography, Button, App, Space, Tooltip } from 'antd';
import { CodeOutlined, CopyOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { lazy, useToken } from '@nocobase/client';
import { useT } from '../../../locale';
import { isSupportLanguage } from '../../built-in/utils';
import { Code as AICoding } from '../../ai-coding/markdown/Code';
import { useChat } from '../hooks/useChat';
import { useChatConversationsStore } from '../stores/chat-conversations';
import { copyToClipboard } from '../utils';

const { CodeHighlight } = lazy(() => import('../../common/CodeHighlight'), 'CodeHighlight');

export const CodeInternal: React.FC<{
  language: string;
  value: string;
  height?: string;
  showLineNumbers?: boolean;
}> = ({ language, value, height, showLineNumbers, ...rest }) => (
  <CodeHighlight {...rest} language={language} value={value} height={height} showLineNumbers={showLineNumbers} />
);

export const CodeBasic: React.FC<{
  children?: React.ReactNode;
  className?: string;
}> = (props: any) => {
  const { children, className, node, message, ...rest } = props;
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const { token } = useToken();
  const t = useT();
  const value = String(children).replace(/\n$/, '');
  const lineCount = value.split('\n').length;
  const collapsible = lineCount > 50;
  const [expanded, setExpanded] = useState(!collapsible);
  const { message: antdMessage } = App.useApp();
  const copy = () => {
    copyToClipboard(value);
    antdMessage.success(t('Copied'));
  };

  return match ? (
    <Card
      size="small"
      title={
        <Space size={6}>
          <CodeOutlined style={{ color: token.colorPrimary }} />
          <span>{language}</span>
        </Space>
      }
      styles={{
        title: {
          fontSize: token.fontSize,
          fontWeight: 400,
        },
        body: {
          width: '100%',
          fontSize: token.fontSizeSM,
          background: token.colorFillQuaternary,
        },
      }}
      extra={
        <Space size={4}>
          {collapsible ? (
            <Tooltip title={expanded ? t('Collapse') : t('Expand')}>
              <Button
                type="text"
                size="small"
                aria-label={expanded ? t('Collapse') : t('Expand')}
                onClick={() => setExpanded((value) => !value)}
                icon={expanded ? <UpOutlined /> : <DownOutlined />}
              />
            </Tooltip>
          ) : null}
          <Tooltip title={t('Copy')}>
            <Button type="text" size="small" onClick={copy} icon={<CopyOutlined />} aria-label={t('Copy')} />
          </Tooltip>
        </Space>
      }
    >
      <CodeInternal
        {...rest}
        language={language}
        value={value}
        height={collapsible && !expanded ? '420px' : undefined}
        showLineNumbers
      />
    </Card>
  ) : (
    <Typography.Text code {...rest} className={className}>
      {children}
    </Typography.Text>
  );
};

export const Code = (props: any) => {
  const { className } = props;
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const currentConversation = useChatConversationsStore.use.currentConversation();
  const chat = useChat(currentConversation);

  const editorRefMap = chat.use.editorRef();
  const currentEditorRefUid = chat.use.currentEditorRefUid();
  const hasEditorRef = !!editorRefMap[currentEditorRefUid];

  return hasEditorRef && isSupportLanguage(language) ? <AICoding {...props} /> : <CodeBasic {...props} />;
};
