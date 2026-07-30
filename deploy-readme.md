# NocoBase 自维护源码生产部署

服务器生产环境不要运行 `yarn dev`。源码仓库可以直接部署，但必须先编译，再用生产模式启动。

当前项目服务器统一使用 Node.js 24：

```bash
nvm install 24
nvm use 24
corepack prepare yarn@1.22.22 --activate
```

## PostgreSQL 18 + pgvector Docker 部署

以下方案适用于：

- NocoBase 源码直接运行在 Linux 宿主机；
- PostgreSQL 18 与 pgvector 运行在 Docker 容器；
- PostgreSQL 只监听宿主机回环地址，不直接暴露到公网；
- `nocobase` 存放 NocoBase 主数据，`nocobase_kb` 专门存放知识库向量。

### 1. 创建 PostgreSQL 管理员环境文件

创建 `/home/application/pg18.env`，内容如下：

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=替换为强管理员密码
POSTGRES_DB=postgres
TZ=Asia/Shanghai
```

限制文件权限：

```bash
chmod 600 /home/application/pg18.env
```

管理员密码不要提交到 Git，也不要与 NocoBase 应用数据库密码相同。

### 2. 创建持久化卷并启动 pgvector

```bash
docker volume create pg18_data

docker run -d \
  --name pg18 \
  --restart unless-stopped \
  --env-file /home/application/pg18.env \
  -p 127.0.0.1:5432:5432 \
  -v pg18_data:/var/lib/postgresql \
  pgvector/pgvector:pg18
```

检查状态与日志：

```bash
docker ps --filter name=pg18
docker logs --tail 100 pg18
docker exec pg18 pg_isready -U postgres -d postgres
```

预期端口映射：

```text
127.0.0.1:5432->5432/tcp
```

> PostgreSQL 18 的官方镜像调整了数据目录布局。这里将卷挂载到 `/var/lib/postgresql`，不要沿用旧版本常见的 `/var/lib/postgresql/data`，否则可能出现数据没有按预期持久化的问题。

### 3. 创建 NocoBase 用户和两个数据库

进入容器中的 PostgreSQL：

```bash
docker exec -it pg18 psql -U postgres -d postgres
```

首次部署执行：

```sql
CREATE ROLE nocobase WITH LOGIN PASSWORD '替换为应用数据库密码';
CREATE DATABASE nocobase OWNER nocobase;
CREATE DATABASE nocobase_kb OWNER nocobase;
```

如果 `nocobase` 用户已经存在，不要重复 `CREATE ROLE`，改为：

```sql
ALTER ROLE nocobase WITH LOGIN PASSWORD '替换为应用数据库密码';
```

如果数据库已经存在，也不要重复创建，先用下面的命令确认所有者：

```sql
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname IN ('nocobase', 'nocobase_kb');
```

必要时修正数据库所有者：

```sql
ALTER DATABASE nocobase OWNER TO nocobase;
ALTER DATABASE nocobase_kb OWNER TO nocobase;
```

### 4. 配置 NocoBase 主数据库权限

仍在 `psql` 中执行：

```sql
\c nocobase

ALTER SCHEMA public OWNER TO nocobase;
GRANT USAGE, CREATE ON SCHEMA public TO nocobase;
```

验证：

```sql
SELECT
  has_schema_privilege('nocobase', 'public', 'USAGE') AS can_use,
  has_schema_privilege('nocobase', 'public', 'CREATE') AS can_create;
```

两个结果都应为 `t`。否则 `yarn nocobase install` 会出现：

```text
permission denied for schema public
```

### 5. 在知识库数据库启用 vector

pgvector 镜像只是安装了扩展文件，每个数据库仍需单独执行 `CREATE EXTENSION`：

```sql
\c nocobase_kb

CREATE EXTENSION IF NOT EXISTS vector;
ALTER SCHEMA public OWNER TO nocobase;
GRANT USAGE, CREATE ON SCHEMA public TO nocobase;

SELECT extversion
FROM pg_extension
WHERE extname = 'vector';
```

查询必须返回 pgvector 版本。退出：

```sql
\q
```

### 6. 从宿主机验证真实连接路径

如果宿主机没有 `psql` 客户端，可先安装：

```bash
sudo apt update
sudo apt install -y postgresql-client
```

验证主数据库：

```bash
psql -h 127.0.0.1 -p 5432 -U nocobase -d nocobase -W \
  -c "SELECT current_database(), current_user;"
```

验证知识库数据库和 vector 扩展：

```bash
psql -h 127.0.0.1 -p 5432 -U nocobase -d nocobase_kb -W \
  -c "SELECT current_database(), current_user, extversion FROM pg_extension WHERE extname='vector';"
```

必须从宿主机使用与 NocoBase 页面完全相同的 Host、Port、Database 和 Username 验证。只在容器内部查询成功，并不能证明宿主机连接参数正确。

### 7. NocoBase 环境变量

根目录 `.env` 至少配置：

```env
DB_DIALECT=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=nocobase
DB_USER=nocobase
DB_PASSWORD=替换为应用数据库密码

# 知识库保存连接后使用该密码访问 nocobase_kb。
# 如果与 DB_PASSWORD 相同也建议显式配置。
KB_PGVECTOR_PASSWORD=替换为应用数据库密码
```

修改 `.env` 后必须重启应用进程。

### 8. 知识库页面连接参数

在“AI Employees → 向量数据库”填写：

```text
Host: 127.0.0.1
Port: 5432
Database: nocobase_kb
Username: nocobase
Password: 应用数据库密码
```

测试成功后应显示 pgvector 版本。向量数据库连接本身不会创建 PostgreSQL 数据库，也不会自动执行 `CREATE EXTENSION vector`；向量存储初始化时才会创建 `kb_<key>` 表和 HNSW 索引。

### 9. 本次部署遇到的典型问题

#### `database "nocobase_kb" does not exist`

原因通常是：

- 只启动了 pgvector 容器，但没有在该容器内创建 `nocobase_kb`；
- 数据库创建到了另一套 PostgreSQL；
- 页面端口指向了宿主机 PostgreSQL，而不是 pgvector 容器；
- 修改 `POSTGRES_DB` 后只重启旧容器，误以为会自动创建新数据库。

`POSTGRES_USER`、`POSTGRES_PASSWORD` 和 `POSTGRES_DB` 只在空数据卷首次初始化时生效。已有 `pg18_data` 时修改环境变量不会补建用户或数据库，必须用 SQL 显式创建。

#### `permission denied for schema public`

数据库级权限不等于 schema 权限。即使用户能够登录 `nocobase`，仍需确保它拥有 `public` schema 的 `USAGE` 和 `CREATE` 权限。

#### 已安装 pgvector，但连接测试提示未启用 vector

Docker 镜像包含扩展文件不代表所有数据库自动启用。必须连接到 `nocobase_kb` 后执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

#### 宿主机和容器中的 `127.0.0.1` 含义不同

- NocoBase 直接运行在宿主机：使用 `127.0.0.1:5432`，对应 Docker 发布端口；
- NocoBase 也运行在 Docker：`127.0.0.1` 指向 NocoBase 自己的容器，两个容器应加入同一 Docker 网络，Host 填 `pg18`，Port 填容器内部端口 `5432`。

#### 保存后的连接测试与首次表单测试密码来源不同

页面新建表单中的密码只用于当前连接测试，不写入数据库。保存连接后，服务端读取 `KB_PGVECTOR_PASSWORD`，未配置时才回退到 `DB_PASSWORD`。修改环境变量后必须重启 NocoBase。

#### 不要把 PostgreSQL 直接暴露到公网

推荐保持：

```text
127.0.0.1:5432->5432/tcp
```

不要无必要地改成 `0.0.0.0:5432`。远程管理优先使用 SSH 隧道、内网或受控安全组。

## NocoBase 源码构建与启动

首次部署：

```bash
git pull
yarn install --frozen-lockfile
yarn build
```

配置根目录 `.env`：

```env
APP_ENV=production
NODE_ENV=production
APP_PORT=13000
APP_KEY=一个固定且足够长的密钥

DB_DIALECT=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=nocobase
DB_USER=nocobase
DB_PASSWORD=数据库密码
KB_PGVECTOR_PASSWORD=数据库密码
```

全新数据库仅执行一次：

```bash
yarn nocobase install
```

如果是已有数据库，绝对不要再次执行 `install`。

如果首次安装因数据库权限失败，修复权限后可重新执行普通的 `yarn nocobase install`；不要使用 `install -f`。

后台启动：

```bash
yarn start --daemon
```

常用维护命令：

```bash
yarn pm2 status
yarn pm2 logs
yarn nocobase pm2-restart
yarn nocobase pm2-stop
```

以后更新源码：

```bash
yarn nocobase pm2-stop
git pull
yarn install --frozen-lockfile
yarn build
yarn start --daemon
```

只有数据库结构或迁移发生变化时，才在启动前执行：

```bash
yarn nocobase upgrade
```

本次仅依赖修复，不需要 upgrade。

注意必须持久化并备份：

- `.env`
- `storage/`
- 数据库
- `APP_KEY`
- `APP_AES_SECRET_KEY`（如果已配置）

尤其不能随意删除 `storage/` 或更换加密密钥，否则邮件账户密码可能无法解密。

长期而言，推荐“源码由你维护，但在 CI 或构建机生成生产镜像/产物”，服务器只运行编译结果。直接在服务器编译也能用，只是占用资源较大、发布和回滚不够干净。
