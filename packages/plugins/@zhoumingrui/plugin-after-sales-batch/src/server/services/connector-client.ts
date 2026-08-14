const DEFAULT_CONNECTOR_BASE_URL = 'http://120.79.239.166:3000';

type RequestOptions = {
  method?: 'GET' | 'POST';
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

export class ConnectorClientError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ConnectorClientError';
    this.status = status;
  }
}

export class ConnectorClient {
  private readonly baseUrl: string;

  private readonly token: string;

  constructor() {
    this.baseUrl = (process.env.AFTER_SALES_CONNECTOR_BASE_URL || DEFAULT_CONNECTOR_BASE_URL).replace(/\/$/, '');
    this.token = process.env.AFTER_SALES_BATCH_TOKEN || '';
  }

  private buildUrl(path: string, query?: Record<string, unknown>) {
    const url = new URL(`${this.baseUrl}/ai${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(this.buildUrl(path, options.query), {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'x-after-sales-batch-token': this.token } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let data: any = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        const summary = text.length > 200 ? `${text.slice(0, 200)}...` : text;
        throw new ConnectorClientError(
          `Connector returned non-JSON response (${response.status}) for /ai${path}: ${summary}`,
          response.status,
        );
      }
    }
    if (!response.ok || data?.success === false) {
      throw new ConnectorClientError(data?.message || `Connector request failed: ${response.status}`, response.status);
    }
    return data as T;
  }

  listWorkOrders(params: Record<string, unknown>) {
    return this.request<{
      success: true;
      total: number;
      page: number;
      pageSize: number;
      records: Record<string, unknown>[];
    }>('/after-sales/work-orders', { query: params });
  }

  listReplyGreetings() {
    return this.request<{
      success: true;
      count: number;
      records: { id: number; greeting: string; sort_order: number }[];
    }>('/after-sales/reply-greetings');
  }

  createWorkOrders(records: Record<string, unknown>[]) {
    return this.request<{ success: true; count: number; records: Record<string, unknown>[] }>(
      '/after-sales/work-orders',
      {
        method: 'POST',
        body: { records },
      },
    );
  }

  deleteWorkOrders(ids: number[]) {
    return this.request<{ success: true; deletedCount: number }>('/after-sales/work-orders/bulk-delete', {
      method: 'POST',
      body: { ids },
    });
  }

  updateWorkOrders(ids: number[], values: Record<string, unknown>) {
    return this.request<{ success: true; count: number; records: Record<string, unknown>[] }>(
      '/after-sales/work-orders/bulk-update',
      {
        method: 'POST',
        body: { ids, values },
      },
    );
  }

  getWorkOrdersByIds(ids: number[]) {
    return this.request<{ success: true; count: number; records: Record<string, unknown>[] }>(
      '/after-sales/work-orders/query',
      {
        method: 'POST',
        body: { ids },
      },
    );
  }

  getTrackingEmail(orderId: string) {
    return this.request<{ success: true; records: Record<string, unknown>[] }>('/tracking-email', {
      query: { orderId },
    });
  }

  createAfterSalesGuide(values: Record<string, unknown>) {
    return this.request<{ success: true; record: Record<string, unknown> }>('/after-sales/guides', {
      method: 'POST',
      body: values,
    });
  }

  refreshAfterSalesGuideDownloads(guideId: number, forceRefresh = false) {
    return this.request<{ success: true; guideId: number; links: Record<string, string> }>(
      `/after-sales-guide/${guideId}/context-snapshots`,
      {
        method: 'POST',
        body: { forceRefresh },
      },
    );
  }
}

export const connectorClient = new ConnectorClient();
