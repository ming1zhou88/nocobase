/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { normalizeMarkdownContent } from '../../ai-employees/chatbox/markdown/Markdown';

describe('AI chat markdown content', () => {
  it('normalizes excessive blank lines without changing markdown tables', () => {
    expect(normalizeMarkdownContent('  # Result\r\n\r\n\r\n| A | B |\r\n| - | - |\r\n| 1 | 2 |  ')).toBe(
      '# Result\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    );
  });
});
