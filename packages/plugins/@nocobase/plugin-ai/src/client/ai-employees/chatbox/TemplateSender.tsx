/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Flex, Input, InputNumber, Select, Switch, Tooltip, Typography } from 'antd';
import { CloseOutlined, SendOutlined } from '@ant-design/icons';
import { css } from '@emotion/css';
import { useToken } from '@nocobase/client';
import { useT } from '../../locale';
import type { ConversationTemplate, PromptTemplateField } from '../types';

const { Text } = Typography;

/**
 * Parse template content into segments of fixed text and editable fields.
 * Supports any characters in field keys (Chinese, spaces, etc.) by using a
 * permissive regex. Placeholders without a matching field config automatically
 * become inline text inputs so the template is always usable.
 */
type Segment = { type: 'text'; value: string } | { type: 'field'; field: PromptTemplateField };

const PLACEHOLDER_REGEX = /\{\{([^{}]+)\}\}/g;

const parseTemplate = (content: string, fields: PromptTemplateField[]): Segment[] => {
  if (!content) return [];
  const fieldMap = new Map(fields.map((f) => [f.key, f]));
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const seenKeys = new Set<string>();

  while ((match = PLACEHOLDER_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    const rawKey = match[1];
    const fieldKey = rawKey.trim();
    seenKeys.add(fieldKey);
    const field = fieldMap.get(fieldKey);
    if (field) {
      segments.push({ type: 'field', field });
    } else {
      // Auto-create a text field for placeholders without explicit config
      segments.push({
        type: 'field',
        field: {
          key: fieldKey,
          label: fieldKey,
          type: 'text',
          placeholder: fieldKey,
        },
      });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return segments;
};

const renderFieldInput = (
  field: PromptTemplateField,
  value: unknown,
  onChange: (value: unknown) => void,
): React.ReactNode => {
  const placeholder = field.placeholder ?? field.label ?? field.key;
  const strValue = typeof value === 'string' ? value : '';
  // Dynamic width based on current value length, clamped to reasonable bounds
  const dynamicWidth = Math.max(Math.min(Math.max(strValue.length, placeholder.length) * 8 + 32, 320), 80);

  switch (field.type) {
    case 'textarea':
      return (
        <Input.TextArea
          rows={1}
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={value as string}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ display: 'inline-flex', width: `${dynamicWidth}px`, verticalAlign: 'middle' }}
        />
      );
    case 'number':
      return (
        <InputNumber
          value={value as number}
          placeholder={placeholder}
          onChange={(v) => onChange(v)}
          style={{ width: `${Math.max(dynamicWidth, 100)}px` }}
        />
      );
    case 'select':
      return (
        <Select
          value={value as string}
          placeholder={placeholder}
          options={(field.options ?? []).map((o) => ({ label: o, value: o }))}
          onChange={(v) => onChange(v)}
          style={{ minWidth: `${dynamicWidth}px` }}
        />
      );
    case 'boolean':
      return <Switch checked={value as boolean} onChange={(checked) => onChange(checked)} />;
    default:
      return (
        <Input
          value={value as string}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ display: 'inline-flex', width: `${dynamicWidth}px`, verticalAlign: 'middle' }}
        />
      );
  }
};

export const TemplateSender: React.FC<{
  template: ConversationTemplate;
  onSubmit: (content: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}> = ({ template, onSubmit, onCancel, disabled }) => {
  const t = useT();
  const { token } = useToken();
  const segments = useMemo(() => parseTemplate(template.content, template.fields), [template.content, template.fields]);

  // Collect all fields including auto-detected ones from segments
  const allFields = useMemo(() => {
    const seen = new Set<string>();
    const result: PromptTemplateField[] = [];
    segments.forEach((seg) => {
      if (seg.type === 'field' && !seen.has(seg.field.key)) {
        seen.add(seg.field.key);
        result.push(seg.field);
      }
    });
    // Also include fields from config that aren't in the content (edge case)
    template.fields.forEach((f) => {
      if (!seen.has(f.key)) {
        seen.add(f.key);
        result.push(f);
      }
    });
    return result;
  }, [segments, template.fields]);

  const initialValues = useMemo(() => {
    const vals: Record<string, unknown> = {};
    allFields.forEach((f) => {
      vals[f.key] = f.defaultValue ?? (f.type === 'boolean' ? false : '');
    });
    return vals;
  }, [allFields]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);

  // Reset values when template changes
  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const composeMessage = useCallback(() => {
    let result = template.content;
    allFields.forEach((f) => {
      const raw = values[f.key] ?? f.defaultValue ?? '';
      const val = f.type === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw);
      // Use regex replaceAll to handle all occurrences, including trimmed keys
      const escapedKey = f.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g'), val);
    });
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }, [template, allFields, values]);

  const requiredFields = allFields.filter((f) => f.required);
  const isComplete = requiredFields.every((f) => {
    const val = values[f.key];
    return val !== undefined && val !== '' && val !== null;
  });

  const handleSubmit = () => {
    if (!isComplete || disabled) return;
    const message = composeMessage();
    if (message) {
      onSubmit(message);
      setValues(initialValues);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const containerClass = css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    padding: 12px 16px;
    background: ${token.colorBgContainer};
    margin: 8px 16px;
    position: relative;
  `;

  const fixedTextClass = css`
    color: ${token.colorTextSecondary};
    white-space: pre-wrap;
    word-break: break-word;
    line-height: ${token.controlHeight}px;
  `;

  return (
    <div className={containerClass} onKeyDown={handleKeyDown}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {template.title}
        </Text>
        <Tooltip title={t('Cancel')}>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onCancel} disabled={disabled} />
        </Tooltip>
      </Flex>

      <div style={{ lineHeight: 1.8 }}>
        {segments.map((seg, index) => {
          if (seg.type === 'text') {
            return (
              <span key={index} className={fixedTextClass}>
                {seg.value}
              </span>
            );
          }
          const field = seg.field;
          const fieldValue = values[field.key];
          const fieldError = field.required && (fieldValue === undefined || fieldValue === '' || fieldValue === null);
          return (
            <span
              key={index}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                margin: '0 4px',
                borderBottom: fieldError ? `1px dashed ${token.colorError}` : 'none',
              }}
            >
              {renderFieldInput(field, fieldValue, (val) => handleChange(field.key, val))}
            </span>
          );
        })}
      </div>

      <Flex justify="flex-end" align="center" style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM, marginRight: 8 }}>
          {isComplete ? t('Press Enter to send') : t('Fill in required fields')}
        </Text>
        <Button
          type="primary"
          size="small"
          icon={<SendOutlined />}
          onClick={handleSubmit}
          disabled={!isComplete || disabled}
        >
          {t('Send')}
        </Button>
      </Flex>
    </div>
  );
};
