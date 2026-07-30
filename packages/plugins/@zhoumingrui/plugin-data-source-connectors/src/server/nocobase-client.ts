/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import axios, { type AxiosInstance } from 'axios';
import type { NocoBaseConnectorOptions, RemoteCollectionMetadata, RemoteFieldMetadata } from './types';
import { normalizePositiveInteger } from './utils';

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('NocoBase base URL must use HTTP or HTTPS');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeApiPath(value?: string) {
  const path = (value || '/api').trim();
  if (!path || path === '/') {
    return '';
  }
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

function unwrapPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  return 'data' in record ? record.data : value;
}

function normalizeField(value: unknown): RemoteFieldMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  const options = record.options && typeof record.options === 'object' ? record.options : {};
  const merged = { ...options, ...record } as Record<string, unknown>;
  if (typeof merged.name !== 'string') {
    return;
  }
  return {
    ...merged,
    name: merged.name,
    field: typeof merged.field === 'string' ? merged.field : merged.name,
    type: typeof merged.type === 'string' ? merged.type : 'string',
    rawType: typeof merged.rawType === 'string' ? merged.rawType : String(merged.type || 'string'),
  } as RemoteFieldMetadata;
}

function normalizeCollection(value: unknown): RemoteCollectionMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  const options = record.options && typeof record.options === 'object' ? record.options : {};
  const merged = { ...options, ...record } as Record<string, unknown>;
  if (typeof merged.name !== 'string') {
    return;
  }
  const fieldsValue = Array.isArray(merged.fields) ? merged.fields : [];
  return {
    ...merged,
    name: merged.name,
    tableName: typeof merged.tableName === 'string' ? merged.tableName : merged.name,
    fields: fieldsValue.map(normalizeField).filter((field): field is RemoteFieldMetadata => Boolean(field)),
  } as RemoteCollectionMetadata;
}

export interface RemoteListResult {
  rows: Record<string, unknown>[];
  count: number;
}

export class NocoBaseRemoteClient {
  private readonly http: AxiosInstance;
  private readonly dataSourceKey: string;

  constructor(options: NocoBaseConnectorOptions) {
    const baseUrl = `${normalizeBaseUrl(options.baseUrl)}${normalizeApiPath(options.apiPath)}`;
    const timeout = normalizePositiveInteger(options.requestTimeoutMs, 15_000, 120_000);
    this.dataSourceKey = options.dataSourceKey || 'main';
    this.http = axios.create({
      baseURL: baseUrl,
      timeout,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        Accept: 'application/json',
        ...(options.roleName ? { 'X-Role': options.roleName } : {}),
        ...(this.dataSourceKey !== 'main' ? { 'X-Data-Source': this.dataSourceKey } : {}),
      },
    });
  }

  async getCollections() {
    const path =
      this.dataSourceKey === 'main'
        ? '/collections:list'
        : `/dataSources/${encodeURIComponent(this.dataSourceKey)}/collections:list`;
    const response = await this.http.get(path, {
      params: {
        paginate: false,
        appends: 'fields',
      },
    });
    const payload = unwrapPayload(response.data);
    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).rows)
        ? ((payload as Record<string, unknown>).rows as unknown[])
        : [];
    return rows
      .map(normalizeCollection)
      .filter((collection): collection is RemoteCollectionMetadata => Boolean(collection));
  }

  async testConnection() {
    await this.getCollections();
    return true;
  }

  async createCollection(values: Record<string, unknown>) {
    const path =
      this.dataSourceKey === 'main'
        ? '/collections:create'
        : `/dataSources/${encodeURIComponent(this.dataSourceKey)}/collections:create`;
    const response = await this.http.post(path, { values });
    return unwrapPayload(response.data);
  }

  async destroyCollections(filterByTk: string | string[], cascade = false) {
    const path =
      this.dataSourceKey === 'main'
        ? '/collections:destroy'
        : `/dataSources/${encodeURIComponent(this.dataSourceKey)}/collections:destroy`;
    const response = await this.http.post(path, { filterByTk, cascade });
    return unwrapPayload(response.data);
  }

  async list(collectionName: string, params: Record<string, unknown>): Promise<RemoteListResult> {
    const response = await this.http.get(`/${encodeURIComponent(collectionName)}:list`, { params });
    const body = response.data as Record<string, unknown>;
    const payload = unwrapPayload(body);
    const dataRecord = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(dataRecord?.rows)
        ? (dataRecord.rows as Record<string, unknown>[])
        : [];
    const meta = body?.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : undefined;
    const countValue = meta?.count ?? dataRecord?.count ?? rows.length;
    return {
      rows,
      count: typeof countValue === 'number' ? countValue : Number(countValue) || rows.length,
    };
  }

  async get(collectionName: string, params: Record<string, unknown>) {
    const response = await this.http.get(`/${encodeURIComponent(collectionName)}:get`, { params });
    return unwrapPayload(response.data) as Record<string, unknown>;
  }

  async create(collectionName: string, params: Record<string, unknown>) {
    const response = await this.http.post(`/${encodeURIComponent(collectionName)}:create`, params);
    return unwrapPayload(response.data) as Record<string, unknown>;
  }

  async update(collectionName: string, params: Record<string, unknown>) {
    const response = await this.http.post(`/${encodeURIComponent(collectionName)}:update`, params);
    return unwrapPayload(response.data) as Record<string, unknown>;
  }

  async destroy(collectionName: string, params: Record<string, unknown>) {
    const response = await this.http.post(`/${encodeURIComponent(collectionName)}:destroy`, params);
    return unwrapPayload(response.data);
  }
}
