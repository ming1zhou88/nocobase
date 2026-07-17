/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
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
