/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { fillPromptTemplate } from '../../ai-employees/chatbox/PromptCommandMenu';
import { normalizeMarkdownContent } from '../../ai-employees/chatbox/markdown/Markdown';
import { PromptTemplate } from '../../ai-employees/types';
import {
  buildPromptTemplateSlotValue,
  getPromptTemplateSlotParts,
  getPromptTemplateSlotRanges,
  parsePromptTemplateSlotValues,
} from '../../ai-employees/chatbox/prompt-template-slots';

describe('AI chat prompt templates', () => {
  it('fills values, defaults, booleans, and skipped optional fields', () => {
    const template: PromptTemplate = {
      id: 'reply',
      name: 'Reply',
      content: 'Topic: {{topic}}\nTone: [[tone]]\nUrgent: {{urgent}}\nNotes: {{notes}}',
      fields: [
        { key: 'topic', label: 'Topic', type: 'text' },
        { key: 'tone', label: 'Tone', type: 'select', defaultValue: 'Friendly' },
        { key: 'urgent', label: 'Urgent', type: 'boolean' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    };

    expect(fillPromptTemplate(template, { topic: 'Shipping', urgent: true })).toBe(
      'Topic: Shipping\nTone: Friendly\nUrgent: Yes\nNotes:',
    );
  });

  it('normalizes excessive blank lines without changing markdown tables', () => {
    expect(normalizeMarkdownContent('  # Result\r\n\r\n\r\n| A | B |\r\n| - | - |\r\n| 1 | 2 |  ')).toBe(
      '# Result\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    );
  });

  it('keeps fixed template text while allowing bracket slot values', () => {
    const parts = getPromptTemplateSlotParts('我要查询订单，订单号：[]，邮箱：[]，商店：[]');
    if (!parts) {
      throw new Error('Expected template slots');
    }

    const value = buildPromptTemplateSlotValue(parts, ['NO-1', 'user@example.com', '上海店']);
    expect(value).toBe('我要查询订单，订单号：[NO-1]，邮箱：[user@example.com]，商店：[上海店]');
    expect(parsePromptTemplateSlotValues(parts, value)).toEqual(['NO-1', 'user@example.com', '上海店']);
    expect(parsePromptTemplateSlotValues(parts, value.replace('我要查询订单', '删除固定文字'))).toBeNull();
  });

  it('calculates slot selections for Tab navigation', () => {
    const parts = getPromptTemplateSlotParts('订单号：[]，邮箱：[]');
    if (!parts) {
      throw new Error('Expected template slots');
    }
    const values = ['NO-1', 'mail@example.com'];
    expect(getPromptTemplateSlotRanges(parts, values)).toEqual([
      { start: 5, end: 9 },
      { start: 15, end: 31 },
    ]);
  });
});
