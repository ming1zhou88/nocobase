/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import React from 'react';
import { App as AntdApp } from 'antd';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeBaseEntry } from '../KnowledgeBaseEntry';
import { VectorDatabaseEntry } from '../VectorDatabaseEntry';
import { VectorStoreEntry } from '../VectorStoreEntry';

const requestState = vi.hoisted(() => ({
  data: { data: { data: [] as unknown[] } },
}));

vi.mock('@nocobase/client', () => ({
  useAPIClient: () => ({
    request: vi.fn(),
    resource: vi.fn(),
  }),
  useRequest: () => ({
    data: requestState.data,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../locale', () => ({
  useT: () => (key: string) => key,
}));

const renderPage = (page: React.ReactNode) => render(<AntdApp>{page}</AntdApp>);

describe('AI knowledge base legacy settings pages', () => {
  beforeEach(() => {
    requestState.data = { data: { data: [] } };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the vector database password and connection actions in a vertical form', () => {
    requestState.data = {
      data: {
        data: [
          {
            id: 'database-1',
            key: 'main',
            name: 'Main database',
            host: '127.0.0.1',
            port: 5432,
            database: 'nocobase_kb',
            username: 'nocobase',
            enabled: true,
          },
        ],
      },
    };
    const { container } = renderPage(<VectorDatabaseEntry />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getAllByRole('button', { name: 'Test connection' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(container.querySelector('form.ant-form-vertical')).toBeInTheDocument();
    expect(container.querySelector('form.ant-form-inline')).not.toBeInTheDocument();
  });

  it('renders labeled knowledge base fields with descriptions in vertical forms', () => {
    const { container } = renderPage(<KnowledgeBaseEntry />);

    expect(screen.getByLabelText('Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByText('A display name shown when selecting the knowledge base.')).toBeInTheDocument();
    expect(container.querySelectorAll('form.ant-form-vertical').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('form.ant-form-inline')).not.toBeInTheDocument();
  });

  it('renders every vector store setting in a vertical form', () => {
    const { container } = renderPage(<VectorStoreEntry />);

    expect(screen.getByLabelText('Vector database')).toBeInTheDocument();
    expect(screen.getByLabelText('Embedding provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Embedding model')).toBeInTheDocument();
    expect(screen.getByLabelText('Dimensions')).toBeInTheDocument();
    expect(container.querySelector('form.ant-form-vertical')).toBeInTheDocument();
    expect(container.querySelector('form.ant-form-inline')).not.toBeInTheDocument();
  });
});
