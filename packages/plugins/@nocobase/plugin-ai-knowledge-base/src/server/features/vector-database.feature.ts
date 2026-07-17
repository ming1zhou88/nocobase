/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { VectorDatabaseFeature, VectorDatabaseInfo } from '@nocobase/plugin-ai';

export class VectorDatabaseFeatureImpl implements VectorDatabaseFeature {
  async getVectorDatabaseInfo(id: string): Promise<VectorDatabaseInfo> {
    const vectorDatabase = await this.plugin.db.getRepository('aiKnowledgeVectorDatabases').findOne({ filterByTk: id });
    if (!vectorDatabase) throw new Error('Vector database not found.');
    return {
      id: String(vectorDatabase.id),
      name: vectorDatabase.name,
      databaseSpec: 'pgvector',
      provider: 'pgvector',
      connectProps: {},
      enabled: vectorDatabase.enabled,
    };
  }

  async listVectorDatabasesInfo(): Promise<VectorDatabaseInfo[]> {
    const vectorDatabases = await this.plugin.db
      .getRepository('aiKnowledgeVectorDatabases')
      .find({ filter: { enabled: true } });
    return vectorDatabases.map((vectorDatabase) => ({
      id: String(vectorDatabase.id),
      name: vectorDatabase.name,
      databaseSpec: 'pgvector',
      provider: 'pgvector',
      connectProps: {},
      enabled: vectorDatabase.enabled,
    }));
  }

  constructor(private readonly plugin: import('../plugin').default) {}
}
