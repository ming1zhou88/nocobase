/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { VectorDatabaseProviderFeature } from '@nocobase/plugin-ai';

export class VectorDatabaseProviderFeatureImpl implements VectorDatabaseProviderFeature {
  register(): void {}
  validateConnectParams(): void {}
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Use the Knowledge Base pgvector connection test.' };
  }
  async beforeCreate(): Promise<{ status: number; message?: string }> {
    return { status: 400, message: 'Use the Knowledge Base pgvector configuration.' };
  }
  async createVectorStore<T>(): Promise<T> {
    throw new Error('Use the Knowledge Base pgvector vector store.');
  }
  listProviders() {
    return [];
  }
}
