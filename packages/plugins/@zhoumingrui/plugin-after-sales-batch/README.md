# 售后批处理（@zhoumingrui/plugin-after-sales-batch）

阶段二「AI 驱动售后处理」的 NocoBase 侧工作台：**建单 → 勾选 → 触发 → 进度四项 → 审核 → 下载核查文件**。
编排（批次、进度、失败重试、单事务落库）全部在**连接器**侧完成，NocoBase 只负责展示与人工操作。

- 页面路由：v1 客户端 `/admin/after-sales/batch-workbench`；v2（modern）客户端 `/<APP_MODERN_CLIENT_PREFIX>/after-sales/batch-workbench`（默认 `/v/...`）
- 接口契约来源：连接器仓库 `routes/ai-gateway.js` 的「阶段二接口」段落
- 字段口径来源：《阶段二实现规格-20261011》（文档 20 字段）

## 一、架构与边界

```
NocoBase 页面（本插件）
   │  13 个 action（POST /api/afterSalesBatch:<action>）
   ▼
NocoBase 服务端（src/server/plugin.ts，纯转发 + 入参校验）
   │  HTTP
   ▼
连接器 AI 网关（routes/ai-gateway.js）
   │  原料打包（表 A/表 B/4 组物流决策树/核查文件）
   ▼
Dify《售后处理指南生成》（检索 → LLM → 解析 6 字段）
   │
   ▼
MySQL：AfterSalesWorkOrderV2 / AIAfterSalesGuideV2 / AIAfterSalesGuideArtifactV2 / AfterSalesGuideBatch
```

**写入约定（文档 L141-142）**：连接器只写自己负责的列（表 B 的 6 个 AI 字段 + ②～⑭⑰⑲⑳）；NocoBase 人工只写
⑮实际发送的卖家回信正文、⑯卖家回信日期时间、⑱审核状态。两边都**只更新传入列**，绝不整行覆盖。
"重新生成"= 先解绑旧记录（旧记录保留、此后不参与参考）再新建，因此不会丢人工填写的内容。

## 二、action ↔ 连接器接口对照

| action | 连接器接口 | 说明 |
|---|---|---|
| `listWorkOrders` | `GET /ai/after-sales/work-orders/v2` | 关键字/订单号/邮箱/是否已生成 + 分页 |
| `listReplyGreetings` | `GET /ai/after-sales/reply-greetings` | 邮件抬头 8 个候选项（建单必填项） |
| `createWorkOrders` | `POST /ai/after-sales/work-orders/v2` | 至少填订单号或买家邮箱其一 |
| `updateWorkOrders` | `POST /ai/after-sales/work-orders/v2/bulk-update` | ②～⑪ 可编辑字段 |
| `deleteWorkOrders` | `POST /ai/after-sales/work-orders/v2/bulk-delete` | 删除时自动解绑指南 |
| `inspectWorkOrders` | `POST /ai/after-sales/work-orders/v2/inspect` | 触发前检查：已有指南 → 提示「去除 / 重新生成」 |
| `startGuideBatch` | `POST /ai/after-sales/guide-batches` + `POST .../:batchSerial/run` | 创建批次（start=false）后**后台执行**，接口立即返回 |
| `listGuideBatches` | `GET /ai/after-sales/guide-batches` | 页面刷新后回显最近一次进度四项 |
| `getGuideBatch` | `GET /ai/after-sales/guide-batches/:batchSerial` | 轮询进度四项 + 失败明细 |
| `retryGuideBatch` | `POST /ai/after-sales/guide-batches/:batchSerial/retry` | 只重跑失败工单（幂等） |
| `unbindGuides` | `POST /ai/after-sales/guides/unbind` | 解绑（"去除"） |
| `getGuide` | `GET /ai/after-sales/guides/:guideSerial` | 指南 20 字段 |
| `updateGuide` | `POST /ai/after-sales/guides/:guideSerial/manual` | 人工回填/审核（白名单：⑮⑯⑱ + 人工修正的 AI 字段） |
| `getGuideArtifactUrls` | — | 由插件按**本机连接器地址**拼核查文件下载链接（不依赖库里存的绝对地址） |

## 三、页面功能

- **批次进度**：待处理总数 / 已完成 / 未完成 / 生成失败 / 已去除 + 进度条 + 失败明细 + 「重新尝试失败项」
- **售后工单**：导入（Excel/CSV，含模板下载）、新建、删除、触发前检查、单条重新生成
- **指南详情抽屉**：文档 20 字段（②～⑳）+ ⑥ 个 AI 字段 + 「标记为已审核 / 取消审核」+ 人工回填实际回信 + 核查文件下载（CSV/TXT）
- **导入模板列**：订单编号、买家邮箱、回信抬头、买家问题类型、相关信息补充、语气和语言要求、回复倾向、邮件篇幅、标准参考案例模版路径、表 A 获取深度、表 B 获取深度

## 四、验证脚本（放在 NocoBase 仓库 `scripts/`）

| 脚本 | 用途 | 典型输出 |
|---|---|---|
| `after-sales-batch-v2-selfcheck.js` | 通过 action 跑完整链路（建单→生成→审核→下载→清理） | 断言 21/21 通过 |
| `after-sales-batch-page-check.js` | 真实浏览器渲染检查（标题、进度四项、表格数据、抽屉字段、控制台报错） | 断言 23/23 通过（v1 与 v2 各一次） |
| `after-sales-batch-selfcheck.js` | **已过期**：旧版（NocoBase 侧 AI 员工问答式生成 + 旧表）自检，仅作历史留档 | — |

```bash
# 链路自检（默认用 .env 的 INIT_ROOT_* 登录本地 NocoBase）
node scripts/after-sales-batch-v2-selfcheck.js --keep

# 页面渲染检查（v1 / v2 客户端）
node scripts/after-sales-batch-page-check.js --client=v1
node scripts/after-sales-batch-page-check.js --client=v2
```

## 五、本地化部署注意（本地镜像 ≠ 生产）

1. **连接器地址**：`AFTER_SALES_CONNECTOR_BASE_URL`（默认 `http://127.0.0.1:3000`）。生产部署时改成生产网关地址。
2. **核查文件链接**：连接器写库时用的是它自己的公网地址（`SystemConfig.public_*`）。本地已把 `public_ip` 改为
   `127.0.0.1`；页面另外用 `getGuideArtifactUrls` 按插件侧地址覆盖，保证本地/生产切换都能下载。
3. **登录密码**：NocoBase 不导出密码哈希，本地镜像的 `nocobase` 账号密码来自本地 `.env` 的 `INIT_ROOT_PASSWORD`；
   生产第二用户（如"售后组"）需由管理员重置密码后才能登录本地镜像。
4. **改代码即时生效**：`yarn dev`（rsbuild）下改 `src/client*` 会热更新；改 `src/server` 会自动重启服务端。
5. 表名与字段以连接器仓库 `material/database/power_automate_schema.sql` 为准（四张 V2 表）。
