/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Client } from 'pg';
import type PluginAiKnowledgeBaseServer from '../plugin';

type KnowledgeBaseRecord = {
  id: string;
  key: string;
  topK: number;
  enabled: boolean;
  vectorStore?: {
    id: string;
    key: string;
    dimensions: number;
    indexTable?: string;
    llmServiceName: string;
    embeddingModel: string;
    vectorDatabase?: { host: string; port: number; database: string; username: string };
  };
};

export type KnowledgeSearchResult = {
  content: string;
  score: number;
  documentId: string;
  title: string;
  chunkIndex: number;
};

export class KnowledgeSearchService {
  constructor(private readonly plugin: PluginAiKnowledgeBaseServer) {}

  async search(input: { knowledgeBaseId: string; query: string; topK?: number }): Promise<KnowledgeSearchResult[]> {
    if (!input.query.trim()) throw new Error('Search query cannot be empty.');
    const base = (await this.plugin.db.getRepository('aiKnowledgeBases').findOne({
      filterByTk: input.knowledgeBaseId,
      appends: ['vectorStore', 'vectorStore.vectorDatabase'],
    })) as KnowledgeBaseRecord | null;
    const store = base?.vectorStore;
    if (!base?.enabled || !store?.vectorDatabase || !store.indexTable)
      throw new Error('Knowledge base is unavailable.');
    const embedding = await this.plugin.vectorStoreBootstrap.createEmbedding(store);
    const vector = await embedding.embedQuery(input.query);
    if (vector.length !== store.dimensions) throw new Error('Embedding dimensions do not match the vector store.');
    const client = new Client({
      host: store.vectorDatabase.host,
      port: store.vectorDatabase.port,
      database: store.vectorDatabase.database,
      user: store.vectorDatabase.username,
      password: process.env.KB_PGVECTOR_PASSWORD ?? process.env.DB_PASSWORD,
    });
    try {
      await client.connect();
      const result = await client.query<{
        content: string;
        score: number;
        metadata: { documentId?: string; title?: string; chunkIndex?: number };
      }>(
        `SELECT content, 1 - (embedding <=> $1::vector) AS score, metadata FROM ${store.indexTable} WHERE knowledge_base_key = $2 ORDER BY embedding <=> $1::vector LIMIT $3`,
        [JSON.stringify(vector), base.key, Math.min(Math.max(input.topK ?? base.topK, 1), 50)],
      );
      return result.rows.map((row) => ({
        content: row.content,
        score: Number(row.score),
        documentId: row.metadata.documentId ?? '',
        title: row.metadata.title ?? '',
        chunkIndex: row.metadata.chunkIndex ?? 0,
      }));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
