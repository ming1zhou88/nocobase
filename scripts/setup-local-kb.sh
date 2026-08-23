#!/usr/bin/env bash
#
# 本机知识库（Knowledge Base / pgvector）一键配置脚本
#
# 作用：让 @zhoumingrui/plugin-ai-knowledge-base 使用本机 Docker 的 PostgreSQL/pgvector
#       在本机跑起所有知识库，不依赖远端 120.79.239.166。
#
# 用法：bash scripts/setup-local-kb.sh
#
# 说明：
#   - 幂等，可重复执行；
#   - 只改本机 PostgreSQL 与知识库元数据，不触碰远端；
#   - 数据库密码等从根目录 .env 读取（DB_PASSWORD / KB_PGVECTOR_PASSWORD）；
#   - 远端 -> 本机的数据导入是一次性迁移，不在本脚本范围内（本脚本负责“配置 + 校验”）。
#
# 可用环境变量覆盖（默认从 .env 读取）：
#   DB_HOST / DB_PORT / DB_DATABASE / DB_USER / DB_PASSWORD
#   KB_PGVECTOR_PASSWORD / KB_DATABASE
#   KB_OPENAI_SERVICE_NAME   本机 OpenAI 服务标识（向量 store 绑定的 embedding 服务，默认 v_sfh4fz6rlzk）

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
CONTAINER="${PG_CONTAINER:-pg18}"

# ---------- 工具函数 ----------

# 从 .env 读取 key=value（取最后一次出现的值）
env_get() {
  local key="$1"
  sed -n "s/^[[:space:]]*${key}=//p" "$ENV_FILE" | tail -n 1
}

# SQL 字符串转义（单引号翻倍），用于安全拼入 psql -c 的 '...' 中
sql_quote() {
  printf '%s' "$1" | sed "s/'/''/g"
}

# 在容器内以超级用户执行 SQL
psql_exec() {
  local db="$1"
  shift
  docker exec "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"
}

# 查询单值
psql_scalar() {
  local db="$1"
  local sql="$2"
  docker exec "$CONTAINER" psql -U postgres -d "$db" -tAc "$sql" | tr -d '[:space:]'
}

# ---------- 读取配置 ----------

DB_HOST="${DB_HOST:-$(env_get DB_HOST)}"
DB_PORT="${DB_PORT:-$(env_get DB_PORT)}"
DB_DATABASE="${DB_DATABASE:-$(env_get DB_DATABASE)}"
DB_USER="${DB_USER:-$(env_get DB_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(env_get DB_PASSWORD)}"
KB_PASSWORD="${KB_PGVECTOR_PASSWORD:-$(env_get KB_PGVECTOR_PASSWORD)}"
KB_DATABASE="${KB_DATABASE:-nocobase_kb}"
KB_OPENAI_SERVICE_NAME="${KB_OPENAI_SERVICE_NAME:-v_sfh4fz6rlzk}"

# 兜底默认值
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_DATABASE="${DB_DATABASE:-nocobase}"
DB_USER="${DB_USER:-nocobase}"
KB_PASSWORD="${KB_PASSWORD:-$DB_PASSWORD}"

if [[ -z "$DB_PASSWORD" ]]; then
  echo "错误：未读取到 DB_PASSWORD，请先在根目录 .env 中配置。" >&2
  exit 1
fi

echo "==> 使用配置：${DB_HOST}:${DB_PORT} 主库=${DB_DATABASE} 向量库=${KB_DATABASE} 用户=${DB_USER}"

# ---------- 1. 确保容器运行 ----------

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "==> 启动容器 ${CONTAINER}"
  docker start "$CONTAINER" >/dev/null
fi

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -q 2>/dev/null; then
    break
  fi
  sleep 1
done
if ! docker exec "$CONTAINER" pg_isready -U postgres -q 2>/dev/null; then
  echo "错误：容器 ${CONTAINER} 的 PostgreSQL 未就绪。" >&2
  exit 1
fi
echo "==> PostgreSQL 已就绪"

# ---------- 2. 同步角色密码 ----------

psql_exec postgres -c "ALTER ROLE \"${DB_USER}\" WITH LOGIN PASSWORD '$(sql_quote "$DB_PASSWORD")';" >/dev/null
echo "==> 角色 ${DB_USER} 密码已同步"

# ---------- 3. 确保数据库存在并修正 owner ----------

ensure_db() {
  local db="$1"
  local exists
  exists="$(psql_scalar postgres "SELECT 1 FROM pg_database WHERE datname = '${db}'")"
  if [[ "$exists" != "1" ]]; then
    psql_exec postgres -c "CREATE DATABASE \"${db}\" OWNER \"${DB_USER}\";" >/dev/null
    echo "==> 已创建数据库 ${db}"
  fi
  psql_exec postgres -c "ALTER DATABASE \"${db}\" OWNER TO \"${DB_USER}\";" >/dev/null
}

ensure_db "$DB_DATABASE"
ensure_db "$KB_DATABASE"

# ---------- 4. 主库与向量库 schema 权限 + vector 扩展 ----------

psql_exec "$DB_DATABASE" \
  -c "ALTER SCHEMA public OWNER TO \"${DB_USER}\";" \
  -c "GRANT USAGE, CREATE ON SCHEMA public TO \"${DB_USER}\";" >/dev/null

psql_exec "$KB_DATABASE" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" \
  -c "ALTER SCHEMA public OWNER TO \"${DB_USER}\";" \
  -c "GRANT USAGE, CREATE ON SCHEMA public TO \"${DB_USER}\";" >/dev/null
echo "==> 主库/向量库 schema 权限与 vector 扩展已就绪"

# ---------- 5. 将向量数据库连接指向本机（幂等） ----------

if [[ "$(psql_scalar "$DB_DATABASE" "SELECT to_regclass('public.\"aiKnowledgeVectorDatabases\"') IS NOT NULL")" == "t" ]]; then
  psql_exec "$DB_DATABASE" -c "UPDATE \"aiKnowledgeVectorDatabases\" SET host = '${DB_HOST}', port = ${DB_PORT}, database = '${KB_DATABASE}', username = '${DB_USER}', enabled = true WHERE provider = 'pgvector';" >/dev/null
  echo "==> 向量数据库连接已指向本机 ${DB_HOST}:${DB_PORT}/${KB_DATABASE}"
else
  echo "==> 未发现 aiKnowledgeVectorDatabases 表（插件可能尚未安装/同步），跳过连接修正"
fi

# ---------- 6. 将向量 store 绑定到本机 OpenAI 服务（幂等） ----------

if [[ "$(psql_scalar "$DB_DATABASE" "SELECT to_regclass('public.\"aiKnowledgeVectorStores\"') IS NOT NULL")" == "t" ]]; then
  psql_exec "$DB_DATABASE" -c "UPDATE \"aiKnowledgeVectorStores\" SET \"llmServiceName\" = '${KB_OPENAI_SERVICE_NAME}' WHERE \"llmServiceName\" IS DISTINCT FROM '${KB_OPENAI_SERVICE_NAME}';" >/dev/null
  echo "==> 向量 store 的 embedding 服务已指向本机 OpenAI 服务 ${KB_OPENAI_SERVICE_NAME}"
else
  echo "==> 未发现 aiKnowledgeVectorStores 表，跳过服务绑定"
fi

# ---------- 7. 校验 ----------

echo
echo "==================== 校验结果 ===================="
echo "vector 扩展版本：$(psql_scalar "$KB_DATABASE" "SELECT extversion FROM pg_extension WHERE extname='vector'")"

if [[ "$(psql_scalar "$DB_DATABASE" "SELECT to_regclass('public.\"aiKnowledgeBases\"') IS NOT NULL")" == "t" ]]; then
  echo "知识库数量：$(psql_scalar "$DB_DATABASE" 'SELECT count(*) FROM "aiKnowledgeBases"')"
  echo "向量 store 数量：$(psql_scalar "$DB_DATABASE" 'SELECT count(*) FROM "aiKnowledgeVectorStores"')"
  echo "文档数量：$(psql_scalar "$DB_DATABASE" 'SELECT count(*) FROM "aiKnowledgeDocuments"')"
fi

if [[ "$(psql_scalar "$KB_DATABASE" "SELECT to_regclass('public.kb_vector_data') IS NOT NULL")" == "t" ]]; then
  echo "kb_vector_data 向量行数：$(psql_scalar "$KB_DATABASE" 'SELECT count(*) FROM kb_vector_data')"
fi
echo "=================================================="
