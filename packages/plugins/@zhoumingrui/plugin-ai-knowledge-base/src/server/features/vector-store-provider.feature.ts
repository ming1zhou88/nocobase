/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import type { VectorStoreProvider, VectorStoreProviderFeature, VectorStoreService } from '@nocobase/plugin-ai';

export class VectorStoreProviderFeatureImpl implements VectorStoreProviderFeature {
  private readonly providers = new Map<string, VectorStoreProvider>();

  register(provider: VectorStoreProvider): void {
    this.providers.set(provider.providerName, provider);
  }

  get providerNames(): string[] {
    return Array.from(this.providers.keys());
  }

  async createVectorStoreService(providerName: string): Promise<VectorStoreService> {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Vector store provider ${providerName} is not registered.`);
    return provider.createVectorStoreService();
  }
}
