/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
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
