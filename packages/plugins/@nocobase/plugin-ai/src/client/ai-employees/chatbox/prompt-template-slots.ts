/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type PromptTemplateSlotRange = {
  start: number;
  end: number;
};

export const getPromptTemplateSlotParts = (template: string): string[] | null => {
  if (!template.includes('[]')) {
    return null;
  }
  return template.split('[]');
};

export const buildPromptTemplateSlotValue = (parts: string[], values?: string[]): string =>
  parts.map((part, index) => `${part}${index < parts.length - 1 ? `[${values?.[index] ?? ''}]` : ''}`).join('');

export const parsePromptTemplateSlotValues = (parts: string[], value: string): string[] | null => {
  if (parts.length < 2) {
    return null;
  }
  const pattern = parts.map(escapeRegExp).join('\\[([\\s\\S]*?)\\]');
  const match = new RegExp(`^${pattern}$`).exec(value);
  return match ? match.slice(1) : null;
};

export const getPromptTemplateSlotRanges = (parts: string[], values: string[]): PromptTemplateSlotRange[] => {
  const ranges: PromptTemplateSlotRange[] = [];
  let cursor = parts[0].length;
  values.forEach((value, index) => {
    const start = cursor + 1;
    const end = start + value.length;
    ranges.push({ start, end });
    cursor = end + 1 + parts[index + 1].length;
  });
  return ranges;
};
