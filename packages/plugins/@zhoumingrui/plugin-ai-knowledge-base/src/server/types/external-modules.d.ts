/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

declare module 'pdf-parse' {
  export default function pdf(buffer: Buffer): Promise<{ text: string }>;
}
declare module 'mammoth' {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}
