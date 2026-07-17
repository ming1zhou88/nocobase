/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const content = text.trim();
  if (!content) return [];
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length; offset += size - overlap) {
    chunks.push(content.slice(offset, offset + size));
    if (offset + size >= content.length) break;
  }
  return chunks;
}
