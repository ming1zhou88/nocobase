/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
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
