/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import type {
  DocumentSegmentedWithScore,
  KnowledgeBase,
  KnowledgeBaseFeature,
  KnowledgeBaseGroup,
  SearchOptions,
} from '@nocobase/plugin-ai';
import type PluginAiKnowledgeBaseServer from '../plugin';

type KnowledgeBaseRecord = {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  vectorStore?: { key: string };
};

export class KnowledgeBaseFeatureImpl implements KnowledgeBaseFeature {
  constructor(private readonly plugin: PluginAiKnowledgeBaseServer) {}

  async getKnowledgeBase(keys: string[]): Promise<KnowledgeBase[]> {
    if (!keys.length) {
      return [];
    }
    const records = (await this.plugin.db.getRepository('aiKnowledgeBases').find({
      filter: { key: { $in: keys }, enabled: true },
      appends: ['vectorStore'],
    })) as KnowledgeBaseRecord[];
    return records
      .filter((record) => record.vectorStore?.key)
      .map((record) => ({
        knowledgeBaseType: 'LOCAL',
        knowledgeBaseOuterId: record.id,
        key: record.key,
        name: record.name,
        description: record.description ?? '',
        vectorStoreProvider: 'pgvector',
        vectorStoreConfigKey: record.vectorStore?.key,
        enabled: record.enabled,
      }));
  }

  async getKnowledgeBaseGroup(keys: string[]): Promise<KnowledgeBaseGroup[]> {
    const knowledgeBases = await this.getKnowledgeBase(keys);
    return Object.values(
      knowledgeBases.reduce<Record<string, KnowledgeBaseGroup>>((groups, knowledgeBase) => {
        const key = knowledgeBase.vectorStoreConfigKey ?? '';
        const group = groups[key] ?? {
          knowledgeBaseType: 'LOCAL',
          vectorStoreConfig: { vectorStoreProvider: 'pgvector', vectorStoreConfigKey: key },
          knowledgeBaseList: [],
        };
        group.knowledgeBaseList.push(knowledgeBase);
        groups[key] = group;
        return groups;
      }, {}),
    );
  }

  async search(options: SearchOptions): Promise<DocumentSegmentedWithScore[]> {
    const knowledgeBases = await this.getKnowledgeBase(options.knowledgeBaseKeys);
    const results = await Promise.all(
      knowledgeBases.map(async (knowledgeBase) => {
        const matches = await this.plugin.knowledgeSearch.search({
          knowledgeBaseId: knowledgeBase.knowledgeBaseOuterId,
          query: options.query,
          topK: options.topK,
        });
        return matches.map((match) => ({
          content: match.content,
          score: match.score,
          metadata: {
            documentId: match.documentId,
            title: match.title,
            chunkIndex: match.chunkIndex,
            knowledgeBaseKey: knowledgeBase.key,
          },
        }));
      }),
    );
    return results
      .flat()
      .sort((left, right) => right.score - left.score)
      .slice(0, options.topK ?? 5);
  }
}
