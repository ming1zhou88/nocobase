/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/server';
import { checkPgVectorConnection } from './services/pgvector.service';
import { VectorStoreBootstrapService } from './services/vector-store-bootstrap.service';
import { KnowledgeDocumentService } from './services/knowledge-document.service';
import { KnowledgeSearchService } from './services/knowledge-search.service';
import type PluginAIServer from '@nocobase/plugin-ai';
import { KnowledgeBaseFeatureImpl } from './features/knowledge-base.feature';
import { VectorStoreProviderFeatureImpl } from './features/vector-store-provider.feature';
import { VectorDatabaseFeatureImpl } from './features/vector-database.feature';
import { VectorDatabaseProviderFeatureImpl } from './features/vector-database-provider.feature';
import { FileTextExtractorService } from './services/file-text-extractor.service';
import type { PgVectorConnection, StoredVectorDatabase } from './types';

export class PluginAiKnowledgeBaseServer extends Plugin {
  vectorStoreBootstrap = new VectorStoreBootstrapService(this);
  knowledgeDocuments = new KnowledgeDocumentService(this);
  knowledgeSearch = new KnowledgeSearchService(this);
  fileTextExtractor = new FileTextExtractorService();
  async afterAdd() {}

  async beforeLoad() {}

  async load() {
    const ai = this.app.pm.get('ai') as PluginAIServer;
    ai.features.enableFeatures({
      knowledgeBase: new KnowledgeBaseFeatureImpl(this),
      vectorStoreProvider: new VectorStoreProviderFeatureImpl(),
      vectorDatabase: new VectorDatabaseFeatureImpl(this),
      vectorDatabaseProvider: new VectorDatabaseProviderFeatureImpl(),
    });
    this.app.resourceManager.define({
      name: 'aiKnowledgeVector',
      actions: {
        checkConnection: async (ctx, next) => {
          const body = ctx.request.body as { values?: PgVectorConnection };
          const values: PgVectorConnection = body.values ?? (ctx.request.body as PgVectorConnection);
          if (!values.password || typeof values.password !== 'string') {
            ctx.body = { connected: false, error: 'Password is required.' };
            await next();
            return;
          }
          ctx.body = await checkPgVectorConnection(values);
          await next();
        },
        testSavedConnection: async (ctx, next) => {
          const database = (await this.db.getRepository('aiKnowledgeVectorDatabases').findOne({
            filterByTk: String(ctx.action.params.filterByTk),
          })) as StoredVectorDatabase | null;
          if (!database) {
            ctx.throw(404, 'Vector database not found.');
          }
          ctx.body = await checkPgVectorConnection({
            host: database.host,
            port: database.port,
            database: database.database,
            username: database.username,
            password: process.env.KB_PGVECTOR_PASSWORD ?? process.env.DB_PASSWORD,
          });
          await next();
        },
        initializeVectorStore: async (ctx, next) => {
          ctx.body = await this.vectorStoreBootstrap.initialize(String(ctx.action.params.filterByTk));
          await next();
        },
        ingestText: async (ctx, next) => {
          const values = ctx.request.body as { knowledgeBaseId: string; title: string; content: string };
          ctx.body = await this.knowledgeDocuments.ingestText(values);
          await next();
        },
        ingestFile: async (ctx, next) => {
          const values = ctx.request.body as {
            knowledgeBaseId: string;
            filename: string;
            mimeType?: string;
            contentBase64: string;
          };
          const content = await this.fileTextExtractor.extract({
            filename: values.filename,
            mimeType: values.mimeType,
            content: Buffer.from(values.contentBase64, 'base64'),
          });
          ctx.body = await this.knowledgeDocuments.ingestText({
            knowledgeBaseId: values.knowledgeBaseId,
            title: values.filename,
            content,
            sourceType: 'file',
          });
          await next();
        },
        deleteDocument: async (ctx, next) => {
          ctx.body = await this.knowledgeDocuments.remove(String(ctx.action.params.filterByTk));
          await next();
        },
        search: async (ctx, next) => {
          const values = ctx.request.body as { knowledgeBaseId: string; query: string; topK?: number };
          ctx.body = { data: await this.knowledgeSearch.search(values) };
          await next();
        },
      },
    });
    this.app.resourceManager.define({
      name: 'aiKnowledgeBase',
      actions: {
        list: async (ctx, next) => {
          const records = await this.db.getRepository('aiKnowledgeBases').find({
            filter: { enabled: true },
            fields: ['id', 'key', 'name', 'description'],
          });
          ctx.body = records.map((record) => record.toJSON());
          await next();
        },
      },
    });

    this.app.acl.allow('aiKnowledgeVectorDatabases', '*', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVectorStores', '*', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'checkConnection', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'testSavedConnection', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'initializeVectorStore', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'ingestText', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'ingestFile', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'deleteDocument', 'loggedIn');
    this.app.acl.allow('aiKnowledgeVector', 'search', 'loggedIn');
    this.app.acl.allow('aiKnowledgeDocuments', '*', 'loggedIn');
    this.app.acl.allow('aiKnowledgeBase', 'list', 'loggedIn');
  }

  async install() {}

  async afterEnable() {}

  async afterDisable() {}

  async remove() {}
}

export default PluginAiKnowledgeBaseServer;
