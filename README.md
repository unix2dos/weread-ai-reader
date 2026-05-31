# WeRead AI Reader

微信读书网页版的实时 AI 跟读助手。它把 Chrome 扩展在当前阅读页被动采集到的正文片段，和官方 WeRead Skill 返回的书籍上下文、整本书评价、本章热门划线、划线评论一起交给本地 Agent 服务器，再由 LLM 给出实时的本章阅读价值判断。

## 它解决什么问题

微信读书官方 Skill 能拿到很有价值的读者信号，例如书籍信息、阅读进度、热门划线、划线评论和书评，但拿不到当前章节正文。这个项目用 Chrome 扩展补上浏览器侧可见正文，再交给服务器统一组织 Agent 请求，判断这一章是否值得精读、接下来最需要掌握什么、应该带着哪些问题读，以及评论区有什么共识或争议。

当前实现刻意采用非打扰式采集：扩展只收集微信读书自然渲染出来的正文，不主动翻页、不滚动、不跳章节。因此低覆盖率时，Agent 会明确把结论标成阶段性建议，而不是假装已经读完整章。

## 插件截图

阅读页侧边面板会把阅读判断放在上方，热门划线和评论作为证据区放在下方。

![阅读页侧边面板](docs/images/reader-panel.png)

最小化后只保留 `AI` 入口，按 `Option+Q` 可以展开面板。

![AI 折叠入口](docs/images/collapsed-entry.png)

设置页配置本地 Agent 服务地址和 `clientToken`，clientToken 可以通过小眼睛临时显示。

![扩展设置页](docs/images/options-page.png)

## 流程图

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#EEF2FF', 'primaryTextColor': '#172554', 'primaryBorderColor': '#4F46E5', 'lineColor': '#64748B', 'secondaryColor': '#ECFDF5', 'tertiaryColor': '#FFF7ED'}}}%%
flowchart TD
  A["用户在微信读书网页版阅读"] --> B["Chrome 扩展被动采集已渲染正文"]
  B --> C["扩展上传阅读快照"]
  C --> D["本地 Agent 服务器校验 clientToken"]
  D --> E["服务器调用官方 WeRead Skill"]
  E --> F["获取章节信息、书籍上下文、热门划线、划线评论、整本书评价"]
  D --> G["服务器合并正文、覆盖率、Skill 信号"]
  F --> G
  G --> H["构造完整 LLM 请求"]
  H --> I["OpenAI 兼容 LLM 生成阅读判断"]
  I --> J["SSE 流式返回扩展面板"]
  H --> K["调试面板显示并复制完整请求"]
```

## 项目结构

| 路径 | 用途 |
|------|------|
| `extension/` | Chrome 扩展，负责页面采集、设置页、弹窗和阅读面板 |
| `server/` | 本地 Agent 服务器，负责 WeRead Skill、LLM、缓存、SSE |
| `test/` | Node 内置测试，覆盖快照上传、信号聚合、Agent 请求和流式判断 |
| `docs/adr/` | 架构决策记录 |
| `CONTEXT.md` | 项目上下文、术语和设计约束 |

## 准备条件

- Node.js 18 或更新版本
- Chrome
- 微信读书网页版登录态
- 官方 WeRead Skill API Key
- OpenAI 兼容的 LLM API Key

## 启动服务器

```bash
npm install

export WEREAD_API_KEY="wrk-..."
export LLM_API_KEY="sk-..."
export LLM_API_BASE="https://opencode.ai/zen/go/v1"
export LLM_MODEL="mimo-v2.5"
export CLIENT_TOKEN="change-me"
export ENABLE_PERSONAL_SIGNALS="false"
export PORT="19763"

npm start
```

健康检查：

```bash
curl http://127.0.0.1:19763/health
```

## 安装 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 `extension/` 目录。
5. 打开扩展设置页，填写 Agent 服务器地址和 `CLIENT_TOKEN`。

本地默认地址是 `http://127.0.0.1:19763`，默认开发令牌是 `dev-token`。如果服务器环境变量里改了 `CLIENT_TOKEN`，扩展设置页也要同步修改。

## 使用方式

1. 打开微信读书网页版阅读页，例如 `https://weread.qq.com/web/reader/...`。
2. 页面右侧会出现 `WeRead AI` 面板。
3. 翻到新章节或点击“本章判断”，扩展会上传当前阅读快照。
4. 面板上方流式显示阅读判断，下方证据区展示官方 Skill 信号。
5. 调试区域可以查看摘要，并复制“完整请求”，用于确认发给 Agent/LLM 的实际内容。

LLM 返回的阅读判断会包含精读/快读/跳读建议、掌握价值分、接下来最需要掌握的内容、追问问题、重点段落和读者视角。

面板最小化后只显示 `AI`，按 `Option+Q` 可以展开面板。

## 数据和密钥边界

- WeRead API Key 和 LLM API Key 只放在服务器环境变量里。
- Chrome 扩展只保存服务器地址和 `clientToken`。
- `clientToken` 是扩展访问 Agent 服务器的共享访问令牌，需要和服务器环境变量 `CLIENT_TOKEN` 一致；它不是 WeRead 或 LLM API Key。
- 调试输出会隐藏 LLM Authorization，不会把服务端密钥返回给浏览器。
- 当前服务器是单用户开发形态，`clientToken` 是未来多用户隔离的协议边界。

`ENABLE_PERSONAL_SIGNALS=true` 会把个人划线和个人想法加入章节判断输入。默认关闭时，Agent 只使用公共阅读信号、书籍上下文信号和浏览器采集到的章节正文快照。

## 当前限制

- 官方 WeRead Skill 不提供章节正文接口。
- 正文来自浏览器已渲染内容，采集覆盖率取决于用户自然阅读过多少页面。
- 扩展不会为了“全章采集”自动滚动、翻页或跳转，以免影响阅读体验。
- 覆盖率不足时，AI 只能做阶段性建议，并会更多依赖热门划线、评论和书评信号。

## 开发验证

```bash
npm test
node --check server/createApp.js server/index.js server/llmClient.js server/readingStrategy.js server/signalBuilder.js server/wereadClient.js test/agent-server.test.js test/reading-strategy.test.js extension/background.js extension/content.js extension/canvas-hook.js extension/options.js extension/popup.js
```

加载扩展后的端到端验证建议在单独的微信读书测试窗口进行，避免干扰正在阅读的页面。

## 模型评测

`scripts/benchmark-models.js` 会复用正式阅读判断的 `readingStrategy`，用固定样本比较不同 OpenAI 兼容模型的速度、JSON 有效性、schema 完整度和自动质量分。

```bash
mkdir -p reports
npm run benchmark:models -- \
  --models mimo-v2.5,kimi-k2.6 \
  --format markdown \
  --timeout-ms 45000 \
  --output reports/model-benchmark.md
```

如果服务商支持 `/models`，可以用 `--models all` 自动拉取模型列表：

```bash
npm run benchmark:models -- --models all --format markdown
```

默认读取 `LLM_API_BASE` 和 `LLM_API_KEY`，样本文件是 `scripts/fixtures/reading-strategy-samples.json`。报告里的 `TTFT Avg` 是首个模型内容 delta 到达时间，`Total Avg` 是完整结构化 JSON 返回并解析完成的时间。
