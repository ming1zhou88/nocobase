/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
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
