/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

const USER_CONFIG_TYPE = 'nocobase-ai-user-config';

export type AIUserConfig = {
  prompt: string;
  promptTemplates: unknown[];
};

export const decodeAIUserConfig = (value: unknown): AIUserConfig => {
  if (typeof value !== 'string') {
    return { prompt: '', promptTemplates: [] };
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === USER_CONFIG_TYPE) {
      return {
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
        promptTemplates: Array.isArray(parsed.promptTemplates) ? parsed.promptTemplates : [],
      };
    }
  } catch {
    // Existing personalized prompts are plain text, not JSON.
  }
  return { prompt: value, promptTemplates: [] };
};

export const encodeAIUserConfig = (prompt: unknown, promptTemplates: unknown): string => {
  const normalizedPrompt = typeof prompt === 'string' ? prompt : '';
  if (!Array.isArray(promptTemplates) || promptTemplates.length === 0) {
    return normalizedPrompt;
  }
  return JSON.stringify({
    type: USER_CONFIG_TYPE,
    prompt: normalizedPrompt,
    promptTemplates,
  });
};
