/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useForm } from '@formily/react';
import type { ISchema } from '@formily/json-schema';
import { SchemaComponent } from '@nocobase/client';
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createVariableInputField } from './field-schema';
import { NAMESPACE, tExpr } from './locale';

interface CollectionsFieldFactoryResult {
  CollectionsTable: React.ComponentType<Record<string, unknown>>;
  addAllCollectionsSchema: ISchema;
  createCollectionsSchema: (from: string, loadCollections: (key: string) => Promise<unknown>) => ISchema;
}

interface LegacySettingsFormProps {
  CollectionsTableField: (options: {
    NAMESPACE: string;
    t: (key: string, options?: Record<string, unknown>) => string;
  }) => CollectionsFieldFactoryResult;
  loadCollections: (key: string) => Promise<unknown>;
  from: 'create' | 'edit';
}

function baseFields(from: 'create' | 'edit'): Record<string, ISchema> {
  return {
    key: {
      type: 'string',
      title: tExpr('Data source name'),
      required: true,
      'x-decorator': 'FormItem',
      'x-component': 'Input',
      'x-disabled': from === 'edit',
      description: tExpr(
        'Support letters, numbers and underscores, must start with a letter. The name cannot be changed after creation.',
      ),
      'x-validator': {
        pattern: '^[A-Za-z][A-Za-z0-9_]*$',
        message: tExpr('Data source name is invalid'),
      },
    },
    displayName: {
      type: 'string',
      title: tExpr('Data source display name'),
      required: true,
      'x-decorator': 'FormItem',
      'x-component': 'Input',
    },
  };
}

function commonTail(
  collections: CollectionsFieldFactoryResult,
  loadCollections: (key: string) => Promise<unknown>,
): Record<string, ISchema> {
  return {
    enabled: {
      type: 'boolean',
      title: tExpr('Enabled'),
      default: true,
      'x-decorator': 'FormItem',
      'x-component': 'Checkbox',
    },
    addAllCollections: collections.addAllCollectionsSchema,
    collections: collections.createCollectionsSchema('create', loadCollections),
  };
}

function SqlLegacySettingsForm(props: LegacySettingsFormProps & { dialect: 'mysql' | 'postgres' }) {
  const { CollectionsTableField, dialect, from, loadCollections } = props;
  const { t } = useTranslation([NAMESPACE, 'client'], { nsMode: 'fallback' });
  const form = useForm();
  const collectionFields = useMemo(() => CollectionsTableField({ NAMESPACE, t }), [CollectionsTableField, t]);

  useEffect(() => {
    const savedCollections = form.values?.options?.collections;
    if (Array.isArray(savedCollections) && !form.values.collections) {
      form.setValuesIn(
        'collections',
        savedCollections.map((name: string) => ({ name, selected: true })),
      );
    }
  }, [form]);

  const schema = useMemo<ISchema>(() => {
    const optionProperties: Record<string, ISchema> = {
      host: createVariableInputField('Host', { required: true }),
      port: {
        ...createVariableInputField('Port', { required: true, number: true }),
        default: dialect === 'mysql' ? 3306 : 5432,
      },
      database: createVariableInputField('Database', { required: true }),
      username: createVariableInputField('Username', { required: true }),
      password: createVariableInputField('Password', { password: true }),
      tablePrefix: createVariableInputField('Table prefix'),
    };
    if (dialect === 'postgres') {
      optionProperties.schema = {
        ...createVariableInputField('Schema'),
        default: 'public',
      };
      optionProperties.ssl = {
        type: 'object',
        properties: {
          sslMode: {
            type: 'string',
            title: tExpr('SSL mode'),
            default: 'disable',
            enum: ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].map((value) => ({
              value,
              label: value,
            })),
            'x-decorator': 'FormItem',
            'x-component': 'Select',
          },
        },
      };
    }
    optionProperties.connectionTimeoutMs = {
      ...createVariableInputField('Connection timeout (ms)', { number: true }),
      default: 10000,
    };
    optionProperties.poolMax = {
      ...createVariableInputField('Maximum pool connections', { number: true }),
      default: 10,
    };
    optionProperties.readOnly = {
      type: 'boolean',
      title: tExpr('Read only'),
      default: true,
      'x-decorator': 'FormItem',
      'x-component': 'Checkbox',
      description: tExpr('Disable this only when remote write operations are explicitly required.'),
    };
    optionProperties.addAllCollections = {
      type: 'boolean',
      default: true,
      'x-display': 'hidden',
    };

    return {
      type: 'object',
      properties: {
        ...baseFields(from),
        options: {
          type: 'object',
          properties: optionProperties,
        },
        ...commonTail(collectionFields, loadCollections),
      },
    };
  }, [collectionFields, dialect, from, loadCollections]);

  return <SchemaComponent schema={schema} components={{ CollectionsTable: collectionFields.CollectionsTable }} />;
}

export function MySQLLegacySettingsForm(props: LegacySettingsFormProps) {
  return <SqlLegacySettingsForm {...props} dialect="mysql" />;
}

export function PostgreSQLLegacySettingsForm(props: LegacySettingsFormProps) {
  return <SqlLegacySettingsForm {...props} dialect="postgres" />;
}

export function NocoBaseLegacySettingsForm(props: LegacySettingsFormProps) {
  const { CollectionsTableField, from, loadCollections } = props;
  const { t } = useTranslation([NAMESPACE, 'client'], { nsMode: 'fallback' });
  const form = useForm();
  const collectionFields = useMemo(() => CollectionsTableField({ NAMESPACE, t }), [CollectionsTableField, t]);

  useEffect(() => {
    const savedCollections = form.values?.options?.collections;
    if (Array.isArray(savedCollections) && !form.values.collections) {
      form.setValuesIn(
        'collections',
        savedCollections.map((name: string) => ({ name, selected: true })),
      );
    }
  }, [form]);

  const schema = useMemo<ISchema>(
    () => ({
      type: 'object',
      properties: {
        ...baseFields(from),
        options: {
          type: 'object',
          properties: {
            baseUrl: {
              type: 'string',
              title: tExpr('NocoBase base URL'),
              required: true,
              'x-decorator': 'FormItem',
              'x-component': 'Input.URL',
            },
            apiPath: {
              ...createVariableInputField('API path'),
              default: '/api',
            },
            apiToken: createVariableInputField('API token', { required: true, password: true }),
            dataSourceKey: {
              ...createVariableInputField('Remote data source key'),
              default: 'main',
            },
            roleName: createVariableInputField('Remote role'),
            requestTimeoutMs: {
              ...createVariableInputField('Request timeout (ms)', { number: true }),
              default: 15000,
            },
            readOnly: {
              type: 'boolean',
              title: tExpr('Read only'),
              default: true,
              'x-decorator': 'FormItem',
              'x-component': 'Checkbox',
              description: tExpr('Disable this only when remote write operations are explicitly required.'),
            },
            addAllCollections: {
              type: 'boolean',
              default: true,
              'x-display': 'hidden',
            },
          },
        },
        ...commonTail(collectionFields, loadCollections),
      },
    }),
    [collectionFields, from, loadCollections],
  );

  return <SchemaComponent schema={schema} components={{ CollectionsTable: collectionFields.CollectionsTable }} />;
}
