/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EnvVariableInput } from '@nocobase/client-v2';
import { useFlowContext } from '@nocobase/flow-engine';
import type { DataSourceSettingsFormProps } from '@nocobase/plugin-data-source-manager/client-v2';
import { Button, Checkbox, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from './locale';

interface CollectionOption {
  name: string;
  schema?: string;
}

interface ConnectorFormValues {
  key: string;
  type: 'mysql' | 'postgres' | 'nocobase';
  enabled: boolean;
  collections?: string[];
  options: {
    addAllCollections?: boolean;
    collections?: string[];
    [key: string]: unknown;
  };
}

function parseCollectionsResponse(response: unknown): CollectionOption[] {
  if (!response || typeof response !== 'object') {
    return [];
  }
  const outer = response as Record<string, unknown>;
  const body = outer.data && typeof outer.data === 'object' ? (outer.data as Record<string, unknown>) : outer;
  const payload = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  return payload
    .map((value) => {
      if (typeof value === 'string') {
        return { name: value };
      }
      if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).name === 'string') {
        const record = value as Record<string, unknown>;
        return {
          name: record.name as string,
          ...(typeof record.schema === 'string' ? { schema: record.schema } : {}),
        };
      }
      return undefined;
    })
    .filter((value): value is CollectionOption => Boolean(value));
}

function CollectionsSelector(props: Pick<DataSourceSettingsFormProps, 'initialValues' | 'mode'>) {
  const t = useT();
  const ctx = useFlowContext();
  const form = Form.useFormInstance<ConnectorFormValues>();
  const addAllCollections = Form.useWatch(['options', 'addAllCollections'], form);
  const [options, setOptions] = useState<CollectionOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedCollections = props.initialValues?.options?.collections;
    if (Array.isArray(savedCollections) && !form.getFieldValue('collections')) {
      form.setFieldValue('collections', savedCollections);
    }
  }, [form, props.initialValues]);

  const loadCollections = useCallback(async () => {
    const values = form.getFieldsValue(true);
    setLoading(true);
    try {
      const response = await ctx.api.request({
        resource: 'dataSources',
        action: 'readTables',
        params: {
          values: {
            dataSourceKey: values.key,
            dbOptions: {
              ...values.options,
              type: values.type,
            },
          },
        },
      });
      const nextOptions = parseCollectionsResponse(response);
      setOptions(nextOptions);
      if (values.options.addAllCollections) {
        form.setFieldValue(
          'collections',
          nextOptions.map((item) => item.name),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [ctx.api, form]);

  const selectOptions = useMemo(
    () =>
      options.map((item) => ({
        value: item.name,
        label: item.schema ? `${item.schema}.${item.name}` : item.name,
      })),
    [options],
  );

  return (
    <Form.Item label={t('Collections')} required={!addAllCollections}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Form.Item name={['options', 'addAllCollections']} valuePropName="checked" noStyle>
          <Checkbox>{t('Add all collections')}</Checkbox>
        </Form.Item>
        <Form.Item
          name="collections"
          noStyle
          rules={[
            {
              validator: async (_, value: string[] | undefined) => {
                if (form.getFieldValue(['options', 'addAllCollections']) || value?.length) {
                  return;
                }
                throw new Error(t('Select at least one collection'));
              },
            },
          ]}
        >
          <Select
            aria-label={t('Collections')}
            mode="multiple"
            showSearch
            disabled={Boolean(addAllCollections)}
            options={selectOptions}
            placeholder={t('Load collections before selecting')}
            optionFilterProp="label"
          />
        </Form.Item>
        <Button onClick={loadCollections} loading={loading}>
          {t('Load Collections')}
        </Button>
      </Space>
    </Form.Item>
  );
}

function CommonSettings(props: { children: React.ReactNode; formProps: DataSourceSettingsFormProps }) {
  const t = useT();
  return (
    <>
      {props.children}
      <Form.Item name={['options', 'readOnly']} label={t('Access mode')} valuePropName="checked">
        <Switch checkedChildren={t('Read only')} unCheckedChildren={t('Read/write')} />
      </Form.Item>
      <Form.Item name="enabled" label={t('Enabled')} valuePropName="checked">
        <Switch />
      </Form.Item>
      <CollectionsSelector mode={props.formProps.mode} initialValues={props.formProps.initialValues} />
    </>
  );
}

function SqlSettingsForm(props: DataSourceSettingsFormProps & { dialect: 'mysql' | 'postgres' }) {
  const t = useT();
  return (
    <CommonSettings formProps={props}>
      <Form.Item name={['options', 'host']} label={t('Host')} rules={[{ required: true }]}>
        <EnvVariableInput />
      </Form.Item>
      <Form.Item name={['options', 'port']} label={t('Port')} rules={[{ required: true }]}>
        <EnvVariableInput />
      </Form.Item>
      <Form.Item name={['options', 'database']} label={t('Database')} rules={[{ required: true }]}>
        <EnvVariableInput />
      </Form.Item>
      <Form.Item name={['options', 'username']} label={t('Username')} rules={[{ required: true }]}>
        <EnvVariableInput />
      </Form.Item>
      <Form.Item name={['options', 'password']} label={t('Password')}>
        <EnvVariableInput password />
      </Form.Item>
      <Form.Item name={['options', 'tablePrefix']} label={t('Table prefix')}>
        <EnvVariableInput />
      </Form.Item>
      {props.dialect === 'postgres' ? (
        <>
          <Form.Item name={['options', 'schema']} label={t('Schema')}>
            <EnvVariableInput />
          </Form.Item>
          <Form.Item name={['options', 'ssl', 'sslMode']} label={t('SSL mode')}>
            <Select
              options={['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
        </>
      ) : null}
      <Form.Item name={['options', 'connectionTimeoutMs']} label={t('Connection timeout (ms)')}>
        <InputNumber min={1000} max={120000} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name={['options', 'poolMax']} label={t('Maximum pool connections')}>
        <InputNumber min={1} max={50} style={{ width: '100%' }} />
      </Form.Item>
    </CommonSettings>
  );
}

export function MySQLSettingsForm(props: DataSourceSettingsFormProps) {
  return <SqlSettingsForm {...props} dialect="mysql" />;
}

export function PostgreSQLSettingsForm(props: DataSourceSettingsFormProps) {
  return <SqlSettingsForm {...props} dialect="postgres" />;
}

export function NocoBaseSettingsForm(props: DataSourceSettingsFormProps) {
  const t = useT();
  return (
    <CommonSettings formProps={props}>
      <Form.Item
        name={['options', 'baseUrl']}
        label={t('NocoBase base URL')}
        rules={[{ required: true }, { type: 'url' }]}
      >
        <Input placeholder="https://example.com" />
      </Form.Item>
      <Form.Item name={['options', 'apiPath']} label={t('API path')}>
        <Input placeholder="/api" />
      </Form.Item>
      <Form.Item name={['options', 'apiToken']} label={t('API token')} rules={[{ required: true }]}>
        <EnvVariableInput password />
      </Form.Item>
      <Form.Item name={['options', 'dataSourceKey']} label={t('Remote data source key')}>
        <Input placeholder="main" />
      </Form.Item>
      <Form.Item name={['options', 'roleName']} label={t('Remote role')}>
        <Input />
      </Form.Item>
      <Form.Item name={['options', 'requestTimeoutMs']} label={t('Request timeout (ms)')}>
        <InputNumber min={1000} max={120000} style={{ width: '100%' }} />
      </Form.Item>
    </CommonSettings>
  );
}
