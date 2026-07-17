/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

declare module 'pdf-parse' {
  export default function pdf(buffer: Buffer): Promise<{ text: string }>;
}
declare module 'mammoth' {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}
