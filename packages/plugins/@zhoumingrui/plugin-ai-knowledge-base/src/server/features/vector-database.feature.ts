/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
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
