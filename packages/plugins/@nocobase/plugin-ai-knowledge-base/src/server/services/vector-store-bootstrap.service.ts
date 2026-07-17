/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Client } from 'pg';
import type PluginAIServer from '@nocobase/plugin-ai';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import type PluginAiKnowledgeBaseServer from '../plugin';

type VectorStoreRecord = {
  id: string;
  key: string;
  embeddingModel: string;
  dimensions: number;
  llmServiceName: string;
  vectorDatabase?: { host: string; port: number; database: string; username: string };
};

const identifier = (value: string) => `kb_${value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;

export class VectorStoreBootstrapService {
  constructor(private readonly plugin: PluginAiKnowledgeBaseServer) {}

  async createEmbedding(store: VectorStoreRecord): Promise<EmbeddingsInterface> {
    const ai = this.plugin.app.pm.get('ai') as PluginAIServer;
    const service = await ai.db.getRepository('llmServices').findOne({ filter: { name: store.llmServiceName } });
    if (!service || service.enabled === false) {
      throw new Error('The selected LLM service is not enabled.');
    }
    const providerMeta = ai.aiManager.llmProviders.get(service.provider);
    if (!providerMeta?.embedding) {
      throw new Error('The selected LLM service does not support embeddings.');
    }
    return new providerMeta.embedding({
      app: this.plugin.app,
      serviceOptions: service.options,
      modelOptions: { model: store.embeddingModel },
    }).createEmbedding();
  }

  async initialize(storeId: string) {
    const store = (await this.plugin.db.getRepository('aiKnowledgeVectorStores').findOne({
      filterByTk: storeId,
      appends: ['vectorDatabase'],
    })) as VectorStoreRecord | null;
    if (!store?.vectorDatabase) {
      throw new Error('Vector store or vector database not found.');
    }
    const embeddings = await this.createEmbedding(store);
    const vector = await embeddings.embedQuery('NocoBase knowledge base connection test');
    if (vector.length !== store.dimensions) {
      throw new Error(`Embedding dimensions mismatch. Expected ${store.dimensions}, received ${vector.length}.`);
    }
    const table = identifier(store.key);
    const index = `${table}_embedding_hnsw`;
    const client = new Client({
      host: store.vectorDatabase.host,
      port: store.vectorDatabase.port,
      database: store.vectorDatabase.database,
      user: store.vectorDatabase.username,
      password: process.env.KB_PGVECTOR_PASSWORD ?? process.env.DB_PASSWORD,
    });
    try {
      await client.connect();
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${table} (id uuid PRIMARY KEY, knowledge_base_key text NOT NULL, source_id text NOT NULL, content text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, embedding vector(${store.dimensions}) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
      );
      await client.query(`CREATE INDEX IF NOT EXISTS ${index} ON ${table} USING hnsw (embedding vector_cosine_ops)`);
      await this.plugin.db.getRepository('aiKnowledgeVectorStores').update({
        filterByTk: store.id,
        values: { indexTable: table, initializedAt: new Date() },
      });
      return { dimensions: vector.length, table };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
