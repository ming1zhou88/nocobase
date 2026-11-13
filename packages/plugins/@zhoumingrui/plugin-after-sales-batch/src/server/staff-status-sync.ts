import mysql from 'mysql2/promise';
import type { Application, Model } from '@nocobase/server';

const DATA_SOURCE_KEY = 'd_99cwsyi7q4k';
const TABLE = 'AfterSalesStaffStatus';

type StaffRow = {
  user_id: number;
  nickname: string | null;
  username: string | null;
  employment_status: string;
  left_at: Date | string | null;
};

function toMysqlDateTime(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return value.includes('T') ? value.slice(0, 19).replace('T', ' ') : value.slice(0, 19);
  }
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

function dbConfig(app: Application) {
  const ds = (app.dataSourceManager as any).get(DATA_SOURCE_KEY);
  const options = ds?.options || {};
  if (!options.host || !options.username) throw new Error('external MySQL data source options unavailable');
  return {
    host: options.host,
    port: Number(options.port) || 3306,
    user: options.username,
    password: options.password || '',
    database: options.database,
  };
}

async function withConnection<T>(app: Application, work: (connection: mysql.Connection) => Promise<T>): Promise<T> {
  const connection = await mysql.createConnection(dbConfig(app));
  try {
    return await work(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

async function ensureTable(connection: mysql.Connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
      \`user_id\` BIGINT NOT NULL,
      \`nickname\` VARCHAR(64) DEFAULT NULL,
      \`username\` VARCHAR(64) DEFAULT NULL,
      \`employment_status\` VARCHAR(16) NOT NULL DEFAULT '在职',
      \`left_at\` DATETIME DEFAULT NULL,
      \`synced_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`user_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function rowOf(user: Model): StaffRow | null {
  const id = Number(user.get?.('id') ?? (user as any).id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    user_id: id,
    nickname: user.get?.('nickname') ?? null,
    username: user.get?.('username') ?? null,
    employment_status: String(user.get?.('employment_status') || '在职'),
    left_at: user.get?.('left_at') ?? null,
  };
}

async function upsertUser(app: Application, user: Model) {
  const row = rowOf(user);
  if (!row) return;
  await withConnection(app, async (connection) => {
    await ensureTable(connection);
    await connection.query(
      `INSERT INTO \`${TABLE}\`
         (user_id, nickname, username, employment_status, left_at, synced_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         nickname = VALUES(nickname),
         username = VALUES(username),
         employment_status = VALUES(employment_status),
         left_at = VALUES(left_at),
         synced_at = NOW()`,
      [row.user_id, row.nickname, row.username, row.employment_status, toMysqlDateTime(row.left_at)],
    );
  });
}

async function removeUser(app: Application, user: Model) {
  const id = Number(user.get?.('id') ?? (user as any).id);
  if (!Number.isInteger(id) || id <= 0) return;
  await withConnection(app, async (connection) => {
    await ensureTable(connection);
    await connection.query(`DELETE FROM \`${TABLE}\` WHERE user_id = ?`, [id]);
  });
}

async function syncAll(app: Application, log: any) {
  try {
    const repository = app.db.getRepository('users');
    const users = await repository.find({ fields: ['id', 'nickname', 'username', 'employment_status', 'left_at'] });
    const rows = (users || []).map(rowOf).filter(Boolean) as StaffRow[];
    await withConnection(app, async (connection) => {
      await ensureTable(connection);
      await connection.beginTransaction();
      try {
        for (const row of rows) {
          await connection.query(
            `INSERT INTO \`${TABLE}\`
               (user_id, nickname, username, employment_status, left_at, synced_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               nickname = VALUES(nickname),
               username = VALUES(username),
               employment_status = VALUES(employment_status),
               left_at = VALUES(left_at),
               synced_at = NOW()`,
            [row.user_id, row.nickname, row.username, row.employment_status, toMysqlDateTime(row.left_at)],
          );
        }
        const ids = rows.map((row) => row.user_id);
        if (ids.length) {
          await connection.query(
            `DELETE FROM \`${TABLE}\` WHERE user_id NOT IN (${ids.map(() => '?').join(',')})`,
            ids,
          );
        } else {
          await connection.query(`DELETE FROM \`${TABLE}\``);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });
    log?.info?.(`[staff-status] full sync: ${rows.length} users`);
  } catch (error: any) {
    log?.warn?.(`[staff-status] full sync failed: ${error?.message || error}`);
  }
}

/**
 * NocoBase users → 外部 MySQL 只读状态缓存。
 *
 * - 用户新增/修改/删除：事件同步，立即生效；
 * - 每日一次全量兜底，修复漏事件；
 * - 不做 5 分钟轮询。
 */
export function installStaffStatusSync(app: Application, log: any) {
  const handler = (user: Model) => {
    void upsertUser(app, user).catch(
      (error) => log?.warn?.(`[staff-status] upsert failed: ${error?.message || error}`),
    );
  };
  app.db.on('users.afterSave', handler);
  app.db.on('users.afterSaveWithAssociations', handler);
  app.db.on('users.afterDestroy', (user: Model) => {
    void removeUser(app, user).catch(
      (error) => log?.warn?.(`[staff-status] remove failed: ${error?.message || error}`),
    );
  });

  // 启动后补一次，随后每 24 小时全量兜底；unref 不阻止进程退出。
  const timer = setInterval(() => void syncAll(app, log), 24 * 60 * 60 * 1000);
  timer.unref?.();
  void syncAll(app, log);
}
