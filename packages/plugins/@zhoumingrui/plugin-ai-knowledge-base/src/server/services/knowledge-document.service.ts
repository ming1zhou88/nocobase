/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type PluginAiKnowledgeBaseServer from '../plugin';
import { chunkText } from './text-chunker';

type KnowledgeBaseRecord = {
  id: string;
  key: string;
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

const validateEmbeddingDimensions = (vectors: number[][], dimensions: number) => {
  if (vectors.some((vector) => vector.length !== dimensions)) {
    throw new Error('Embedding dimensions do not match the vector store.');
  }
};

export class KnowledgeDocumentService {
  constructor(private readonly plugin: PluginAiKnowledgeBaseServer) {}

  async ingestText(input: { knowledgeBaseId: string; title: string; content: string; sourceType?: string }) {
    const base = (await this.plugin.db.getRepository('aiKnowledgeBases').findOne({
      filterByTk: input.knowledgeBaseId,
      appends: ['vectorStore', 'vectorStore.vectorDatabase'],
    })) as KnowledgeBaseRecord | null;
    const store = base?.vectorStore;
    if (!base || !store?.vectorDatabase || !store.indexTable)
      throw new Error('Knowledge base vector store is not initialized.');
    const chunks = chunkText(input.content);
    if (!chunks.length) throw new Error('Document content cannot be empty.');

    const document = await this.plugin.db.getRepository('aiKnowledgeDocuments').create({
      values: {
        knowledgeBaseId: base.id,
        sourceType: input.sourceType ?? 'text',
        sourceId: randomUUID(),
        title: input.title,
        content: input.content,
        status: 'processing',
      },
    });
    const documentId = String(document.id);
    const client = new Client({
      host: store.vectorDatabase.host,
      port: store.vectorDatabase.port,
      database: store.vectorDatabase.database,
      user: store.vectorDatabase.username,
      password: process.env.KB_PGVECTOR_PASSWORD ?? process.env.DB_PASSWORD,
    });
    try {
      const embeddings = await this.plugin.vectorStoreBootstrap.createEmbedding(store);
      const vectors = await embeddings.embedDocuments(chunks);
      validateEmbeddingDimensions(vectors, store.dimensions);
      await client.connect();
      await client.query('BEGIN');
      for (const [chunkIndex, content] of chunks.entries()) {
        await client.query(
          `INSERT INTO ${store.indexTable} (id, knowledge_base_key, source_id, content, metadata, embedding) VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)`,
          [
            randomUUID(),
            base.key,
            documentId,
            content,
            JSON.stringify({ documentId, title: input.title, chunkIndex, sourceType: input.sourceType ?? 'text' }),
            JSON.stringify(vectors[chunkIndex]),
          ],
        );
      }
      await client.query('COMMIT');
      await this.plugin.db
        .getRepository('aiKnowledgeDocuments')
        .update({ filterByTk: documentId, values: { chunkCount: chunks.length, status: 'completed', error: null } });
      return { documentId, chunkCount: chunks.length, status: 'completed' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.plugin.db.getRepository('aiKnowledgeDocuments').update({
        filterByTk: documentId,
        values: { status: 'failed', error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async remove(documentId: string) {
    const document = await this.plugin.db.getRepository('aiKnowledgeDocuments').findOne({
      filterByTk: documentId,
      appends: ['knowledgeBase', 'knowledgeBase.vectorStore', 'knowledgeBase.vectorStore.vectorDatabase'],
    });
    const base = document?.knowledgeBase as KnowledgeBaseRecord | undefined;
    const store = base?.vectorStore;
    if (!document || !store?.vectorDatabase || !store.indexTable)
      throw new Error('Knowledge document or vector store not found.');
    const client = new Client({
      host: store.vectorDatabase.host,
      port: store.vectorDatabase.port,
      database: store.vectorDatabase.database,
      user: store.vectorDatabase.username,
      password: process.env.KB_PGVECTOR_PASSWORD ?? process.env.DB_PASSWORD,
    });
    try {
      await client.connect();
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${store.indexTable} WHERE source_id = $1`, [documentId]);
      await this.plugin.db.getRepository('aiKnowledgeDocuments').destroy({ filterByTk: documentId });
      await client.query('COMMIT');
      return { deleted: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
