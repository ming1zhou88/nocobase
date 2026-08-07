/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { css } from '@emotion/css';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Message } from '../../types';
import { lazy, useToken } from '@nocobase/client';
import { Code } from './Code';
import { Form } from './Form';
import { App, Button, Tooltip } from 'antd';
import { BulbOutlined, CopyOutlined } from '@ant-design/icons';
import { useT } from '../../../locale';
import { copyToClipboard } from '../utils';

const { Echarts } = lazy(() => import('./ECharts'), 'Echarts');

const CopyableSummary: React.FC<React.BlockquoteHTMLAttributes<HTMLQuoteElement>> = ({ children, ...props }) => {
  const t = useT();
  const { token } = useToken();
  const { message } = App.useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const copy = async () => {
    await copyToClipboard(contentRef.current?.innerText ?? '');
    message.success(t('Copied'));
  };

  return (
    <blockquote
      {...props}
      style={{
        position: 'relative',
        display: 'flex',
        gap: 10,
        padding: '12px 44px 12px 14px',
        border: `1px solid ${token.colorInfoBorder}`,
        borderLeft: `4px solid ${token.colorInfo}`,
        borderRadius: token.borderRadiusLG,
        color: token.colorText,
        background: `linear-gradient(135deg, ${token.colorInfoBg}, ${token.colorBgContainer})`,
      }}
    >
      <BulbOutlined aria-hidden="true" style={{ marginTop: 4, color: token.colorInfo, fontSize: 16 }} />
      <div ref={contentRef} style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
      <Tooltip title={t('Copy')}>
        <Button
          type="text"
          size="small"
          aria-label={t('Copy')}
          icon={<CopyOutlined />}
          onClick={copy}
          style={{ position: 'absolute', top: 6, right: 6, color: token.colorInfo }}
        />
      </Tooltip>
    </blockquote>
  );
};

export const normalizeMarkdownContent = (content: string): string => {
  if (!content) return '';
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const MarkdownComponent: React.FC<{
  message: Message['content'];
}> = ({ message }) => {
  const { token } = useToken();
  const tagIndexes: Record<string, number> = {};
  const getIndex = (tagName: string): number => {
    if (!(tagName in tagIndexes)) {
      tagIndexes[tagName] = -1;
    }
    return ++tagIndexes[tagName];
  };

  return (
    <div
      className={css`
        margin-bottom: -1em;
        word-break: break-word;

        strong {
          color: ${token.colorPrimaryText};
        }

        a {
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        li::marker {
          color: ${token.colorPrimary};
          font-weight: 700;
        }

        p,
        ul,
        ol,
        blockquote,
        pre,
        table {
          margin-block: 0 12px;
        }

        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          margin-block: 18px 10px;
          line-height: 1.35;
          color: ${token.colorPrimaryText};
          border-bottom: 1px solid ${token.colorBorderSecondary};
          padding-bottom: 4px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          white-space: normal;
        }

        th,
        td {
          min-width: 96px;
          padding: 8px 10px;
          border: 1px solid rgba(5, 5, 5, 0.14);
          text-align: left;
          vertical-align: top;
        }

        th {
          color: ${token.colorPrimaryText};
          background: linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorInfoBg});
          font-weight: 600;
        }
      `}
    >
      <ReactMarkdown
        components={{
          code: (props) => <Code {...props} message={message} />,
          blockquote: CopyableSummary,
          table: ({ node, ...props }) => (
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table {...props} />
            </div>
          ),
          form: (props) => <Form {...props} message={message} />,
          // @ts-ignore
          echarts: (props) => {
            return <Echarts {...props} index={getIndex('echarts')} message={message} />;
          },
          // collections: (props) => {
          //   return <Collections {...props} message={message} />;
          // },
        }}
        rehypePlugins={[
          rehypeRaw,
          [
            rehypeSanitize,
            {
              ...defaultSchema,
              tagNames: [...defaultSchema.tagNames, 'echarts', 'form', 'collections', 'br', 'hr'],
              attributes: {
                ...defaultSchema.attributes,
                form: ['uid', 'datasource', 'collection'],
                echarts: ['option', 'style', 'class'],
              },
              clobberPrefix: '',
            },
          ],
        ]}
        remarkPlugins={[remarkGfm]}
        skipHtml={false}
      >
        {normalizeMarkdownContent(message.content as unknown as string)}
      </ReactMarkdown>
    </div>
  );
};

export const Markdown = React.memo(MarkdownComponent, (prevProps, nextProps) => {
  return (
    prevProps.message?.messageId === nextProps.message?.messageId &&
    prevProps.message?.content === nextProps.message?.content
  );
});
