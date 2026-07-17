/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

export type PgVectorConnection = {
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
};

export type StoredVectorDatabase = Omit<PgVectorConnection, 'password'> & {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
};
