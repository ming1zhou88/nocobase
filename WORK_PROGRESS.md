# AI 知识库与邮件中心：工作进度

## 产品目标

在 NocoBase 免费版中以独立插件实现可扩展知识库、pgvector 检索、AI Employees 集成、第三方数据源和企业邮件中心；不修改 NocoBase core，不依赖或复制第三方私有源码。

## 进度

| 阶段 | 交付内容 | 状态 | 验收标准 |
| --- | --- | --- | --- |
| 0 | 本机环境与插件骨架 | 已完成 | 已创建 `@zhoumingrui/plugin-ai-knowledge-base` 骨架；本机 Node.js、Yarn 与 PostgreSQL 连通性均已确认 |
| 1 | PostgreSQL + pgvector | 已完成 | 已在独立 `nocobase_kb` 数据库启用 pgvector 0.8.3，并验证向量余弦距离计算 |
| 2 | Vector database / Vector store | 已完成 | pgvector 连接检测、配置、Embedding 模型绑定、索引初始化及 `/admin` 管理页均已完成并通过回归测试 |
| 3 | Knowledge base | 已完成 | 已实现文本与多类型文件导入、切片、向量化、状态管理、检索测试和文档删除 |
| 4 | AI Employees 集成 | 已完成 | 已接入官方 knowledge-base feature，并通过 AI Employee 真实对话检索验收 |
| 5 | NocoBase 与第三方数据源 | 进行中 | 第一阶段重点实现 MySQL、PostgreSQL、NocoBase；其余连接器按复用性和复杂度分批交付 |
| 6 | 邮件中心 | 未开始 | 支持 SMTP 发信、IMAP 收信、草稿、已读未读、附件和线程 |
| 7 | 邮件工作流触发器 | 未开始 | 新邮件可触发 NocoBase 工作流并传递邮件上下文 |
| 8 | 权限、审计、测试与部署 | 未开始 | 权限过滤、失败重试、测试通过、部署说明完整 |

## 已完成迭代：可被 AI 员工实际使用的知识库

| 子项 | 内容 | 状态 |
| --- | --- | --- |
| 向量数据库 | PostgreSQL/pgvector 连接检测、配置记录与列表 | 已完成 |
| 向量存储 | 绑定向量数据库、Embedding 服务商、模型和固定维度 | 已完成 |
| 知识库实体 | 创建、启停、绑定已初始化 Vector store、设置 Top-K 与列表管理 | 已完成 |
| 向量表 | 依据 store 的维度创建 chunk 表、HNSW 索引和版本命名 | 已完成 |
| Embedding 适配 | 复用 AI 插件 LLM 服务配置并调用 Embedding 模型 | 已完成 |
| 资料入库 | 文本及 TXT/Markdown/CSV、PDF、DOCX、XLS/XLSX、PPTX 读取、切片、状态和删除 | 已完成 |
| AI 检索 | 注册 plugin-ai knowledge-base feature、检索测试与 AI Employee 对话调用 | 已完成 |

### 用户验收路径

1. 在 AI Employees 中配置 LLM services（OpenAI、千问）。
2. 创建并测试 Vector database，创建绑定 embedding 服务的 Vector store。
3. 创建 Knowledge base 并选择 Vector store。
4. 导入文件或选择业务数据源，等待切片和向量化完成。
5. 在 AI employee 编辑页选择知识库并启用“引用知识库”。
6. 与员工对话，系统检索相关片段并在回答中提供来源。

## 配置与扩展约束

- 向量数据库是多记录配置：每条记录拥有独立主机、端口、数据库、用户、密钥引用和启停状态。
- 一个 Vector store 只能绑定一条向量数据库和一个 embedding 模型；模型、维度、表名和索引版本均不可混用。
- 一个知识库选择一个 Vector store；系统支持创建多个知识库、多个 store 和多个 pgvector 数据库。
- OpenAI、千问等聊天模型与 embedding 模型解耦：任一 AI 员工可使用同一个知识库回答。
- 生产环境的第三方密码必须保存在 NocoBase Secrets；本机 `.env` 回退仅用于当前开发环境。

## 服务器初始化（当前阶段）

1. 安装 PostgreSQL 与 pgvector，并创建 NocoBase 主库和独立向量库。
2. 在向量库执行 `CREATE EXTENSION vector;`。
3. 设置 `DB_*` 为 NocoBase 主库；设置 `KB_PGVECTOR_PASSWORD` 为向量库密码。
4. 构建并启用插件后，NocoBase 自动同步知识库元数据表。
5. 在界面创建 Vector database、Vector store 并点击“初始化索引”；chunk 表和 HNSW 索引由插件自动创建，无需手工建表。

## 已确认

- NocoBase 源码仓库：`D:\projects\webstorm-projects\nocobase`
- NocoBase 主库：本机 PostgreSQL `127.0.0.1:5432/nocobase`，专用角色为 `nocobase`。
- 向量库：本机 PostgreSQL `127.0.0.1:5432/nocobase_kb`，已启用 pgvector 0.8.3。
- 数据库密码不记录在该文件、源码、Git 或日志中。
- 实现方式：独立 NocoBase 插件；知识库能力复用同一服务端资源，同时兼容 `/admin` legacy 管理入口和 `/v` modern runtime，不复制业务逻辑。

## 当前阻塞

- 无。

## 2026-07-16 增量：文本入库闭环（已完成）

- 已完成：知识库页增加“添加测试文本”入口；提交后服务端将文本切片、调用该 Vector store 绑定的现有 LLM Embedding 服务，并在 pgvector 索引表中事务写入向量与来源元数据。
- 已完成：`aiKnowledgeDocuments` 保存文档、分片数、状态和错误信息；任一分片或向量化失败会回滚 pgvector 写入并标记失败，方便排查与重试。
- 已验证（迁名前）：插件 ESLint 自动修复及生产构建均通过。
- 完成结果：后续已实现向量检索并接入 AI Employees 的官方 knowledge-base feature，真实对话闭环验收通过。

## 2026-07-16 增量：检索测试闭环（已完成）

- 已完成：新增与后续 AI Employees 共用的 pgvector 检索服务；查询使用相同 Embedding 服务生成问题向量，按知识库隔离，使用余弦距离返回 Top-K 文本、相似度、标题和分片序号。
- 已完成：知识库页新增“检索测试”表单与结果表，能直接验证命中质量、来源与分数，无需手工执行 SQL。
- 已验证：插件 ESLint 及生产构建通过。
- 完成结果：检索命中与 AI Employees 接入均已验收，文本入库和检索复用同一服务链路。

## 2026-07-16 增量：AI Employees 知识库接入（已完成）

- 已完成：将本插件的知识库实现注册到 plugin-ai 的官方 feature manager；AI Employee 使用已验证的同一 pgvector 检索服务，不存在第二套检索逻辑。
- 已完成：支持员工配置多个知识库；分别检索后按相似度统一排序并截取 Top-K。检索结果携带文档标题、分片及知识库标识，供提示词与审计扩展使用。
- 已验证：插件 ESLint 及生产构建通过。
- 完成结果：AI Employee Knowledge Base 配置和真实对话验收通过，知识库 MVP 正式完成。

### 验收结果（2026-07-16）

- 已验收完成：测试文本入库 → 文本切片 → Embedding → pgvector → 检索 → AI Employee 实际对话回答。
- 结论：知识库 MVP 的核心闭环已完成，可由 AI Employees 正式使用；后续功能均在该已验证链路上扩展。

## 2026-07-16 架构收敛：统一 AI 管理运行时（已完成）

- 已确认问题：AI Employees 当前运行在 `/admin` 的 legacy client，知识库管理页运行在 `/v` 的 modern client；两者之间的链接会触发完整应用切换和重新加载，不能作为正式用户体验。
- 已决定：取消把 `/v` 工作区作为日常入口；将知识库管理页原生迁入 legacy client，并作为与 AI Employees 同级的独立菜单。
- 完成结果：知识库/文档管理与检索测试、向量存储、向量数据库均已迁入 legacy client，未采用 iframe，也未复制服务端业务逻辑。

## 2026-07-16 范围校正：先完成多类型文档入库

- 已移除：尚未交付的数据源配置、PostgreSQL 连接测试及表枚举预开发代码；该部分不再影响当前插件或数据库。
- 当前优先级：完成 TXT、PDF、DOCX、XLSX、PPTX 的文件上传、文本提取、文档状态、切片和统一 pgvector 入库。
- 数据源后续边界：MySQL/PostgreSQL 仅作为只读业务内容来源，读取后送入统一文档入库管道；唯一向量存储仍是已配置的 pgvector。

## 2026-07-16 增量：多类型文件文本提取（已完成）

- 已完成：TXT/Markdown/CSV、PDF、DOCX、XLS/XLSX、PPTX 的服务端文本提取器。
- 已完成：新增文件入库接口；提取出的文本复用已验证的文档记录、切片、Embedding 与 pgvector 事务写入管道。
- 已验证：新增依赖随插件构建打包，ESLint 与生产构建均通过。
- 已完成：知识库页增加文件选择与多文件队列；每个文件独立执行并在上传列表显示成功或失败，成功后自动刷新文档状态列表。
- 已验收：真实文件导入链路已随本阶段统一收口，PDF、DOCX、XLSX、PPTX 均走同一提取、切片和向量化管道。
- 已完成：文档级删除。删除时同步清理该文档在 pgvector 中的全部切片，再删除元数据记录，防止已删除内容继续被 AI 检索。
- 完成结果：文件入库阶段关闭；MySQL/PostgreSQL 只读接入转入独立第三方数据源连接器阶段。

## 2026-07-16 收尾：AI Employees 管理页迁移完成

- 已完成：将 `/v` 中已验证的知识库、向量数据库和向量存储管理能力完整迁入 AI Employees 的 legacy client 子菜单；继续复用原有资源与服务端接口，没有新增第二套数据或检索逻辑。
- 知识库：创建表单改为纵向单列布局，所有字段补齐标题、校验和用途说明；同步补齐知识库列表、检索测试、文件导入、文档状态与文档删除功能。
- 向量数据库：补齐独立的用户名和密码字段，密码作为最后一个连接凭据字段；创建前必须先测试当前表单连接，修改字段后需要重新测试；已保存连接的操作区同时提供测试连接和删除。
- 向量存储：创建表单改为纵向单列布局；与 `/v` 页面保持相同的向量数据库、Embedding 服务、模型、维度、启用状态、索引状态和初始化操作。
- 国际化：三个 legacy 页面及菜单项统一接入插件 i18n，补齐 `en-US`、`zh-CN` 文案，不再硬编码中英文界面字符串。
- 回归测试：新增 `src/client/settings/__tests__/settings-pages.test.tsx`，覆盖密码字段、创建前测试按钮、已保存连接的测试与删除操作，以及知识库和向量存储的纵向布局；3 项测试全部通过。
- 静态检查：本次修改文件已执行 ESLint 自动修正；中英文 locale JSON 解析成功，85 个界面翻译键均完整覆盖；未发现 `any`、异步 `void` 调用或残留的 inline 表单。
- 运行验收：按用户要求，本次收尾不再由代理执行 NocoBase build、`yarn dev` 或启动应用；由用户在现有环境完成最终构建和浏览器验收。
- 当前状态：legacy 管理页迁移开发与验收均已完成，本阶段关闭。

## 2026-07-17 收尾：自有插件身份与许可证

- 插件包名由与官方文档冲突的 `@nocobase/plugin-ai-knowledge-base` 调整为 `@zhoumingrui/plugin-ai-knowledge-base`。
- 原创源码版权归 Zhou Mingrui，使用 `AGPL-3.0-only`；插件目录新增完整 `LICENSE` 和独立 `NOTICE`。
- NocoBase 脚手架提供的两份通用 `client.d.ts` 保留原 NocoBase 版权及许可声明，不主张个人版权。
- 根仓库提交钩子增加该插件目录的精确排除规则，避免后续提交重新覆盖原创源码版权头。
- NocoBase 上游源码、官方文档、商标及原许可证均未修改；本次仅调整自研插件身份，不改变业务逻辑、数据表或接口。
- 按用户要求，本次不由代理执行 build 或 dev；包名变更后的构建与启用由用户在本地完成。

## 2026-07-17 启动：第三方数据源连接器插件（进行中）

- 当前目标：在 `/admin/settings/data-source-manager/list` 的现有“数据源”管理页中注册自有外部数据源类型，不另建割裂的管理页面，并复用 NocoBase 已有的数据源列表、状态、启停、配置、权限和 collection 管理能力。
- 支持范围：MySQL、PostgreSQL、NocoBase、Oracle、SQL Server、REST API、ClickHouse、Doris、MariaDB；明确排除 Kingbase。
- 第一优先级：MySQL、PostgreSQL、NocoBase。要求具备连接配置、变量与密钥、连接测试、远端 collection/表发现、选择性或全部加载、字段类型推断、主键识别、只读安全策略、刷新、编辑、删除、错误状态和中英文界面。
- 已完成参考审计：MySQL/MariaDB 使用 Host、Port、Database、Username、Password、Table prefix、Enabled 和 Collections；PostgreSQL额外支持 Schema 与 SSL mode；统一提供 Load Collections、Test Connection、Submit，并由现有数据源页提供 Configure、Edit、Delete。
- 已确认复用点：服务端复用 `@nocobase/data-source-manager` 的 factory、`DatabaseDataSource`、`SequelizeCollectionManager`、PostgreSQL/MariaDB introspector 及 `plugin-data-source-manager` 的测试连接、表加载和元数据持久化流程；客户端向现有 legacy/modern 数据源管理器注册类型，不复制列表页。
- 后续批次：MariaDB 可复用 MySQL 主体实现；Doris 优先评估 MySQL 协议兼容；ClickHouse 需要独立驱动、类型映射和查询适配；Oracle、SQL Server 需要独立方言验证；REST API 需要独立的 collection/schema/分页/鉴权映射层。
- 稳定性边界：第一阶段默认只读，不在外部数据库执行建表、改表或删除操作；连接凭据不写入日志；数据库连接必须设置超时、池上限并在失败/停用/删除时释放。
- 验证约束：代理不执行 NocoBase build、`yarn dev` 或 `yarn nocobase upgrade`；源代码完成后仅运行相关单测、静态检查和 ESLint，应用启动及浏览器验收由用户执行。

### 第一阶段实现进度

| 连接器 | 当前状态 | 已实现能力 | 剩余验收 |
| --- | --- | --- | --- |
| MySQL | 代码完成，待真实连接联调 | 连接测试、变量与密钥、表发现、全部/选择加载、字段与主键推断、表前缀、连接池、超时、默认只读及可选读写 | 用户环境连接真实 MySQL，验证表加载和 CRUD 安全开关 |
| PostgreSQL | 代码完成，待真实连接联调 | MySQL 全部通用能力，以及 Schema、SSL mode、PostgreSQL 类型与主键推断 | 用户环境连接真实 PostgreSQL，覆盖 SSL 与非 public Schema |
| NocoBase | 代码完成，待真实连接联调 | Base URL、API path、API Token、远端角色、远端数据源、collection/field 元数据发现、标准 CRUD 代理、默认只读 | 使用第二套 NocoBase 或参考站 API Token 验证权限、分页、筛选与写入开关 |

- 插件位置：`packages/plugins/@zhoumingrui/plugin-data-source-connectors`，自有版权并使用 `AGPL-3.0-only`；同时注册 legacy `/admin` 与 modern `/v` 数据源管理器，服务端连接器实现保持单一。
- 自动验证：4 个服务端测试文件共 9 项测试全部通过，1 项客户端归一化测试通过；目标源码 TypeScript `--noEmit` 检查通过；插件源码及许可证排除脚本 ESLint 通过；中英文 locale JSON 解析通过。
- 安全实现：默认只读；只有显式切换读写后才允许远端 create/update/destroy；不会记录密码或 Token；临时 SQL 测试连接在完成后关闭；连接池、连接超时和 API 请求超时均有上限。
- 本轮未执行 build、`yarn dev`、`yarn nocobase upgrade` 或插件启用，遵从用户指定的本地运行边界。

### 2026-07-17 联调修复：legacy 连接字段可编辑

- 用户验收发现：`/admin` 添加 MySQL 数据源时，除显示名称外，Host、Port、Database、Username 等连接字段无法直接键入；PostgreSQL 共用同一字段实现，存在相同风险。
- 根因确认：legacy `TextAreaWithGlobalScope` 底层的 `Variable.Input` 未配置 `useTypedConstant`，界面只提供变量/密钥选择入口，没有注册字符串或数字常量编辑器。
- 已完成：统一字段生成器按文本和数字分别启用 `useTypedConstant: ['string']` 与 `useTypedConstant: ['number']`，密码继续遮罩，变量与密钥选择能力保持不变；MySQL、PostgreSQL 和 NocoBase legacy 表单同步生效。
- 已验证：新增 3 项字段 schema 回归测试并全部通过，覆盖文本、数字及密码字段；目标源码 TypeScript `--noEmit` 与 ESLint 均通过。
- 性能诊断：本机 `Get-Content`、`rg`、Git、磁盘、内存、网络和 PostgreSQL 连接实测均正常；此前单轮耗时主要来自 NocoBase legacy/modern 双客户端开发编译器的内存占用，以及测试环境初始化、TypeScript 和 ESLint 等多轮检查串行累积，并非 PostgreSQL 或文件读取故障。
- 本次修复未运行 build、`yarn dev` 或 `yarn nocobase upgrade`；浏览器热更新或重启现有 dev 后，由用户复测 MySQL 与 PostgreSQL 的连接字段输入和连接流程。

### 2026-07-17 本地代理性能规避规则

- 已确认健康基线：文件读取、Git、磁盘、网络和本机 PostgreSQL 均无异常；后续不得在没有新证据时把对话延迟归因于 `Get-Content` 或 PostgreSQL。
- 已将长期规则写入仓库根目录 `AGENTS.local.md`，后续代理会在会话开始时自动读取。
- 运行边界：代理不执行 build、`yarn dev`、`yarn nocobase upgrade`、应用启动或插件启停，不重复启动 legacy/modern Rsbuild。
- 检查策略：只运行与修改直接相关的单个测试文件、触及文件 ESLint 和必要的定向 TypeScript 检查；已经通过且代码未变化的检查不重复运行。
- 资源策略：测试、TypeScript、ESLint 等重型任务不并行；相关轻量读取合并执行；长命令设置超时并及时汇报，遇到重复初始化延迟时先诊断而非反复重试。
- 目标：避免双客户端开发编译器常驻期间叠加重复测试与全仓检查，使后续对话保持可预期的响应时间。

### 2026-07-17 联调检查：插件管理器可发现性

- 已确认 `@zhoumingrui/plugin-data-source-connectors` 能被 NocoBase 本地插件扫描器发现，`package.json`、legacy client、modern client 和 server 三个入口均可解析。
- 已确认主库 `applicationPlugins` 中该插件为 `enabled=true`、`installed=true`；它不是未安装或未注册，之前能打开 MySQL 添加表单也证明插件客户端已经加载。
- 已补充官方插件管理器使用的 `Data sources` 分类关键字，使插件显示在“数据源”分类中；中英文显示名称和说明保持不变。
- 当前检查时应用未监听 `13000`，因此浏览器列表需要在用户启动现有 dev 后强制刷新验收；如果页面保留旧请求缓存，重新进入插件管理器即可，不需要执行 upgrade。

### 2026-07-17 修复：知识库插件管理信息

- 用户确认数据源连接器已经能在插件管理器显示，实际缺少友好标题和说明的是 `@zhoumingrui/plugin-ai-knowledge-base`。
- 根因：该插件 `package.json` 只有包名、版本、作者和依赖，没有插件管理器读取的 `displayName`、`description` 与 `keywords` 元数据，因此界面回退显示原始包名且说明为空。
- 已补充中英文名称“AI Knowledge Base / AI 知识库”、中英文功能说明和官方 `AI` 分类关键字；未修改插件功能、数据结构、启用状态或依赖。
- 重新进入或强制刷新插件管理器后即可看到新信息，不需要执行 upgrade。

### 后续连接器工作列表

| 连接器 | 复杂度 | 复用策略与主要工作 |
| --- | --- | --- |
| MariaDB | 低 | 复用 MySQL 表单、连接生命周期与大部分 introspector；补 MariaDB 方言注册和差异类型测试 |
| Doris | 中 | 优先复用 MySQL 协议做只读连接；验证 information_schema、复合主键、日期/大数/数组类型和分页 SQL |
| ClickHouse | 高 | 引入独立驱动和 Repository；实现类型映射、分页/排序/筛选翻译，默认只读 |
| SQL Server | 高 | 使用 Sequelize MSSQL/tedious；补 schema、复合主键、IDENTITY、日期和 Unicode 类型映射 |
| Oracle | 高 | 独立 oracledb 驱动与连接池；处理 service name/SID、NUMBER/DATE/CLOB、大小写和分页差异 |
| REST API | 很高 | 独立 collection/schema 配置、鉴权、分页/筛选映射、字段推断、限流重试和错误标准化 |
| Kingbase | 排除 | 按需求不实现 |
