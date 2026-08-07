/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { decodeAIUserConfig, encodeAIUserConfig } from '../ai-employees/user-config';

describe('AI user config storage', () => {
  it('keeps existing plain-text prompts backward compatible', () => {
    expect(decodeAIUserConfig('Answer concisely')).toEqual({
      prompt: 'Answer concisely',
      promptTemplates: [],
    });
  });

  it('stores prompt templates in the existing prompt column', () => {
    const promptTemplates = [{ id: 'reply', name: 'Reply', content: 'Reply to {{name}}', fields: [] }];
    const encoded = encodeAIUserConfig('Answer concisely', promptTemplates);

    expect(decodeAIUserConfig(encoded)).toEqual({ prompt: 'Answer concisely', promptTemplates });
  });
});
