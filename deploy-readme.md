服务器生产环境不要运行 `yarn dev`。你的源码仓库可以部署，但必须先编译，再用生产模式启动。

你服务器现在是 Node `24.18.0`，而仓库固定使用 Node `20.16.0`，建议先切换：

```bash
nvm install 20.16.0
nvm use 20.16.0
corepack prepare yarn@1.22.22 --activate
```

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
DB_HOST=数据库地址
DB_PORT=5432
DB_DATABASE=nocobase
DB_USER=nocobase
DB_PASSWORD=数据库密码
```

全新数据库仅执行一次：

```bash
yarn nocobase install
```

如果是已有数据库，绝对不要再次执行 `install`。

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
