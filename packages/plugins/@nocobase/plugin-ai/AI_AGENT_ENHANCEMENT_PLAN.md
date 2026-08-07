# AI Agent 功能增强开发规划

> 本文档供接手开发的 AI agent 使用。请先阅读 `AGENTS.md` 了解项目规范。
> 本仓库已配置 CodeGraph（`.codegraph/codegraph.db`），可通过 CodeGraph MCP 工具快速检索代码关系，减少 token 消耗。

---

## 一、问题诊断（已完成）

### 1.1 欢迎语（Greeting）不支持 Markdown

**根因**：`MessageRenderer.tsx` 中 greeting 类型消息直接用 `<Bubble content={msg.content}>` 渲染，完全绕过了 Markdown 组件。

- 文件：`src/client/ai-employees/chatbox/MessageRenderer.tsx`
- 代码位置：`AIMessageRenderer` 函数，`case 'greeting'` 分支
- 当前代码：
  ```tsx
  case 'greeting':
    return (
      <Bubble
        content={msg.content}  // ← 纯文本，无 Markdown 渲染
        style={{ marginBottom: '8px' }}
      />
    );
  ```
- 数据源：greeting 字段在 `src/collections/ai-employees.ts` 中定义为 `text` 类型，内容来自内置 AI employee 定义（如 `src/ai/ai-employees/ellis.ts`）和数据库配置。
- 内置示例（`ellis.ts`）：`greeting: 'Hi, I'm Ellis. Share an email or thread...'` — 纯文本，无 markdown 格式。

### 1.2 预选项（Suggestions）不支持 Markdown

**根因**：`SuggestionsOptions.tsx` 将选项渲染为 `<div>{option}</div>`，纯文本无格式。

- 文件：`src/client/ai-employees/suggestions/ui/SuggestionsOptions.tsx`
- 当前代码：
  ```tsx
  <Button {...btnProps(option)} onClick={...}>
    <div>{option}</div>  // ← 纯文本
  </Button>
  ```
- 选项数据来源：AI tool call 返回的 `args.options` 数组（`src/ai/tools/suggestions.ts`）。

### 1.3 Markdown 渲染换行问题

**根因**：`Markdown.tsx` 的 `rehypeSanitize` 配置未显式包含 `br`、`hr` 标签，且容器未设置 `white-space: pre-wrap`。

- 文件：`src/client/ai-employees/chatbox/markdown/Markdown.tsx`
- **已修复（本轮）**：已添加 `white-space: pre-wrap`、`word-break: break-word`，并在 sanitize schema 中增加 `br`、`hr` 标签和 `clobberPrefix: ''`。

### 1.4 代码块显示不够丰富

**现状**：`Code.tsx` 使用 `CodeHighlight` 组件（基于 `react-syntax-highlighter`），已有基础语法高亮和复制按钮，但缺少行号、折叠、主题切换。

- 文件：`src/client/ai-employees/chatbox/markdown/Code.tsx`
- 高亮实现：`src/client/ai-employees/common/CodeHighlight.tsx`
- 已有功能：语言识别、Card 包裹、复制按钮、暗色/亮色主题自适应
- 缺失功能：行号显示、长代码折叠、一键展开/收起

### 1.5 数据表切换不方便

**现状**：数据源选择通过 `AddContextButton` → `DatasourceSelector` 弹窗操作，步骤多。

- 弹窗组件：`src/client/ai-employees/datasource/DatasourceSelector.tsx`（基于 FlowModel，较重）
- 触发入口：`src/client/ai-employees/chatbox/SenderFooter.tsx` 中的 `<AddContextButton>`
- 无法在聊天输入区直接快速切换目标表

### 1.6 整体 UI 美观度

**现状**：基于 Ant Design + `@ant-design/x` Bubble 组件，功能完整但视觉平淡。

- 聊天主容器：`src/client/ai-employees/chatbox/ChatBox.tsx`
- 消息列表：`src/client/ai-employees/chatbox/Messages.tsx`
- 输入区：`src/client/ai-employees/chatbox/Sender.tsx`

---

## 二、架构概览

### 2.1 双 Runtime 结构

```
src/client/          ← v1（legacy），所有 UI 组件都在这里
src/client-v2/       ← v2，仅包含 stores 和 hooks，UI 组件复用 v1
```

**重要**：Markdown、Code、Sender、Messages 等所有 UI 组件只需修改 `src/client/` 下的文件。v2 的 `chat-box.ts` 仅 re-export v1 的 store。

### 2.2 核心文件索引

| 功能 | 文件路径 | 说明 |
|------|----------|------|
| Markdown 渲染 | `src/client/ai-employees/chatbox/markdown/Markdown.tsx` | react-markdown + rehype-raw + rehype-sanitize |
| 代码高亮 | `src/client/ai-employees/chatbox/markdown/Code.tsx` | 包装 CodeHighlight，支持 AI Coding 模式 |
| 高亮实现 | `src/client/ai-employees/common/CodeHighlight.tsx` | react-syntax-highlighter，hljs 方案 |
| 消息渲染 | `src/client/ai-employees/chatbox/MessageRenderer.tsx` | AI/User/Error/Task 消息分发 |
| 消息列表 | `src/client/ai-employees/chatbox/Messages.tsx` | Bubble 列表、滚动、折叠 |
| 聊天主容器 | `src/client/ai-employees/chatbox/ChatBox.tsx` | 展开/收起/全屏切换 |
| 输入框 | `src/client/ai-employees/chatbox/Sender.tsx` | @ant-design/x Sender |
| 输入头部 | `src/client/ai-employees/chatbox/SenderHeader.tsx` | 上下文/附件/编辑提示 |
| 输入底部 | `src/client/ai-employees/chatbox/SenderFooter.tsx` | 上下文按钮/上传/搜索/AI切换/模型切换 |
| 预选项 UI | `src/client/ai-employees/suggestions/ui/SuggestionsOptions.tsx` | 按钮组选择 |
| 数据源选择 | `src/client/ai-employees/datasource/DatasourceSelector.tsx` | FlowModel 弹窗 |
| AI Employee 定义 | `src/ai/ai-employees/*.ts` | 内置 AI 角色定义（greeting 等） |
| 系统提示词 | `src/server/ai-employees/prompts.ts` | getSystemPrompt 函数 |
| 集合定义 | `src/collections/ai-employees.ts` | 数据库字段定义 |
| 内置管理器 | `src/server/manager/built-in-manager.ts` | i18n 翻译 greeting |
| Store（v1） | `src/client/ai-employees/chatbox/stores/chat-box.ts` | re-export v2 |
| Store（v2） | `src/client-v2/ai-employees/chatbox/stores/chat-box.ts` | 实际 store 实现 |
| 类型定义 | `src/client/ai-employees/types.ts` | Message/AIEmployee/SendOptions 等 |

### 2.3 消息渲染流程

```
Messages.tsx
  └→ renderItem()
       └→ MemoBubble (来自 @ant-design/x)
            └→ messageRender → MessageRenderer.tsx
                 ├→ AIMessage (role === 'assistant')
                 │    └→ AIMessageRenderer
                 │         ├→ case 'greeting' → <Bubble content={msg.content}>  ← 无 Markdown！
                 │         └→ default → AITextMessageRenderer → <Markdown message={msg} />
                 ├→ UserMessage (role === 'user')
                 │    └→ <Bubble content={msg.content}>  ← 纯文本，有 pre-wrap
                 ├→ ErrorMessage
                 ├→ HintMessage
                 └→ TaskMessage
```

### 2.4 Suggestions 渲染流程

```
MessageRenderer.tsx → AITextMessageRenderer → ToolCard
  └→ generative-ui/ToolCard.tsx
       └→ 根据 tool name 匹配 UI 组件
            └→ SuggestionsOptions.tsx（tool name: 'suggestions'）
                 └→ <Button><div>{option}</div></Button>  ← 无 Markdown！
```

---

## 三、开发计划（小步快跑）

### 阶段 1：Greeting 支持 Markdown（最小改动，最高价值）

**目标**：让欢迎语支持完整的 Markdown 格式（标题、列表、代码块、换行等）。

**修改文件**：
1. `src/client/ai-employees/chatbox/MessageRenderer.tsx`
   - `case 'greeting'` 分支：将 `<Bubble content={msg.content}>` 改为使用 `<Markdown>` 组件渲染

**具体改动**：
```tsx
case 'greeting':
  return (
    <Bubble
      styles={{ content: { width: '100%' } }}
      variant="borderless"
      content={<Markdown message={msg} />}  // ← 使用 Markdown 组件
    />
  );
```

**验证**：
- 运行测试：`yarn test packages/plugins/@nocobase/plugin-ai/src/client/__tests__/chatbox/ --run`
- 手动验证：在 AI employee 配置中设置含 Markdown 的 greeting，检查渲染效果

---

### 阶段 2：Suggestions 支持 Markdown

**目标**：让预选项按钮内容支持 Markdown（加粗、列表、代码等）。

**修改文件**：
1. `src/client/ai-employees/suggestions/ui/SuggestionsOptions.tsx`
   - 将 `<div>{option}</div>` 改为使用轻量 Markdown 渲染

**具体改动**：
```tsx
// 方案 A：复用 Markdown 组件（需构造 message 对象）
import { Markdown } from '../../chatbox/markdown/Markdown';

// 在 Button 内：
<Markdown message={{ content: { content: option, messageId: '' } }} />

// 方案 B：使用 react-markdown 直接渲染（更轻量）
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

<ReactMarkdown remarkPlugins={[remarkGfm]}>{option}</ReactMarkdown>
```

**注意**：方案 B 更轻量但无法支持自定义标签（echarts/form），建议预选项场景用方案 B。

**验证**：
- AI tool call 返回含 Markdown 的 options，检查按钮渲染

---

### 阶段 3：代码块增强

**目标**：添加行号显示、长代码折叠、展开/收起。

**修改文件**：
1. `src/client/ai-employees/common/CodeHighlight.tsx`
   - 添加 `showLineNumbers` prop（react-syntax-highlighter 原生支持）
   - 添加 maxHeight 折叠 + "展开/收起" 按钮

2. `src/client/ai-employees/chatbox/markdown/Code.tsx`
   - 在 Card 组件中传递 showLineNumbers
   - 长代码（>50行）默认折叠，添加展开按钮

**具体改动**（CodeHighlight.tsx）：
```tsx
<SyntaxHighlighter
  showLineNumbers={showLineNumbers}
  lineNumberStyle={{ color: '#999', paddingRight: '8px' }}
  customStyle={{ margin: 0 }}
  PreTag="div"
  language={language}
  style={isDarkTheme ? dark : defaultStyle}
>
  {value}
</SyntaxHighlighter>
```

---

### 阶段 4：数据表快速切换

**目标**：在 SenderFooter 或 SenderHeader 添加快捷数据表选择器，无需打开弹窗。

**修改文件**：
1. 新建 `src/client/ai-employees/chatbox/QuickTableSwitcher.tsx`
   - 使用 Ant Design `Select` 或 `Dropdown` 组件
   - 从 `aiContextDatasources` API 获取已配置的数据源列表
   - 选中后直接调用 `addContextItems` 添加上下文

2. `src/client/ai-employees/chatbox/SenderFooter.tsx`
   - 在工具栏中添加 `<QuickTableSwitcher>`

**设计思路**：
```tsx
// QuickTableSwitcher.tsx
<Select
  showSearch
  placeholder="选择数据表"
  filterOption={(input, option) => option.label.includes(input)}
  options={datasources.map(ds => ({ label: ds.title, value: ds.uid }))}
  onChange={handleSelect}
  style={{ minWidth: 200 }}
/>
```

**注意**：需复用现有 `DatasourceSelector` 的数据获取逻辑（`aiContextDatasources` resource），但不使用 FlowModel 弹窗，改为轻量 Select。

---

### 阶段 5：UI 美化

**目标**：提升整体视觉体验。

**修改文件**：
1. `src/client/ai-employees/chatbox/Messages.tsx`
   - 优化空状态提示（"Work with your AI crew"）→ 添加图标、渐变色

2. `src/client/ai-employees/chatbox/MessageRenderer.tsx`
   - 消息气泡添加微阴影、圆角优化

3. `src/client/ai-employees/suggestions/ui/SuggestionsOptions.tsx`
   - 按钮样式升级：圆角卡片、hover 动画、渐变边框

4. `src/client/ai-employees/chatbox/ChatBox.tsx`
   - 头部样式升级

---

## 四、已完成的工作

### ✅ Markdown.tsx 换行修复（阶段 1 前置）

文件：`src/client/ai-employees/chatbox/markdown/Markdown.tsx`

改动内容：
- 容器添加 `white-space: pre-wrap` 和 `word-break: break-word`
- sanitize schema 添加 `br`、`hr` 标签
- 添加 `clobberPrefix: ''` 避免 ID 前缀污染
- 添加 `echarts` 标签的 `option`、`style`、`class` 属性白名单
- 添加 `skipHtml={false}` 确保不跳过 HTML
- 添加 `handleContent` 函数预留内容预处理入口

**注意**：此改动已保存但未提交 git。测试基线 4 个测试全部通过。

---

## 五、注意事项

### 5.1 CodeGraph 使用

本仓库已配置 CodeGraph（`.codegraph/codegraph.db`），接手开发时：
- 优先使用 CodeGraph MCP 工具检索代码关系（如果可用）
- CodeGraph 数据库是本地的，不入 git
- 可用于快速查找函数调用关系、组件依赖等

### 5.2 安全注意

- `rehypeRaw` + `rehypeSanitize` 组合是安全敏感的
- 修改 sanitize schema 时不要移除默认的安全限制
- 确保自定义标签（`echarts`、`form`、`collections`）的属性白名单不引入 XSS 风险

### 5.3 双 Runtime

- 只修改 `src/client/` 下的 UI 组件
- `src/client-v2/` 的 store 可以安全修改，但 UI 组件不要在 v2 中新建
- v1 可以 import v2，但 v2 不能 import v1

### 5.4 测试

- 测试目录：`src/client/__tests__/chatbox/`
- 运行命令：`yarn test packages/plugins/@nocobase/plugin-ai/src/client/__tests__/chatbox/ --run`
- 不要并行运行 server 测试

### 5.5 i18n

- 用户可见字符串需通过 `t()` / `useT()` 处理
- 新增字符串需在 `src/locale/en-US.json` 和 `src/locale/zh-CN.json` 中添加

### 5.6 Pre-Commit

- 提交前运行 `yarn eslint --fix` 处理 touched files
- 遵循 Conventional Commits：`feat(plugin-ai): ...`

---

## 六、开发顺序建议

```
第 1 步：Greeting 支持 Markdown（阶段 1）
         └→ 改动最小（1 个文件），价值最高
         └→ 修改 MessageRenderer.tsx 的 greeting 分支

第 2 步：Suggestions 支持 Markdown（阶段 2）
         └→ 改动 1 个文件
         └→ 修改 SuggestionsOptions.tsx

第 3 步：代码块增强（阶段 3）
         └→ 改动 2 个文件
         └→ 修改 CodeHighlight.tsx + Code.tsx

第 4 步：数据表快速切换（阶段 4）
         └→ 新建 1 个文件 + 修改 1 个文件
         └→ 新建 QuickTableSwitcher.tsx + 修改 SenderFooter.tsx

第 5 步：UI 美化（阶段 5）
         └→ 改动多个文件
         └→ 逐步优化，每个文件独立提交
```

每一步完成后：
1. 运行测试确保无回归
2. 运行 `yarn eslint --fix`
3. 提交 git（Conventional Commits 格式）
4. 再进入下一步
