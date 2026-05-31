# WeRead AI Reader — 微信读书 AI 实时跟读助手

## 项目定位

在微信读书网页版阅读时，自动分析当前章节内容，提供章节摘要、重点分析、深度阅读评分，帮助用户判断是否值得精读。

## 核心术语

| 术语 | 定义 |
|------|------|
| **轻量分析** | 不调 LLM，仅聚合 weread API 数据（热门划线、评论、章节元数据），毫秒级返回 |
| **深度分析** | 将官方 WeRead Skill 信号 + 章节正文快照发给 LLM，生成摘要、重点、评分，需 3-8 秒 |
| **章节正文快照** | 采集时刻从微信读书网页版 DOM 中可提取的当前章节正文文本，用于 AI 总结；不承诺包含图片、脚注弹层、公式、表格或复杂排版 |
| **信号** | 由官方 WeRead Skill 获取的读者反馈数据，包括整本书评价、本章热门划线、划线评论、划线热度、个人笔记和书籍评分 |
| **公共阅读信号** | 不依赖当前用户个人笔记的 WeRead 信号，包括本章热门划线、划线评论和整本书公开评价；它是阅读判断的默认证据层 |
| **书籍上下文信号** | 用来理解本章在全书中的位置和背景的信息，包括书籍元信息、章节目录、章节字数、全书评分和当前阅读进度 |
| **个人阅读信号** | 当前用户自己的划线、想法、点评和阅读进度；用于个性化判断“接下来最需要掌握什么”，但需要明确作为可选增强层处理 |
| **采集端** | 运行在微信读书网页版里的 Chrome 扩展，负责识别当前阅读现场并被动抓取已渲染正文 |
| **Agent 服务器** | 接收采集端上传的阅读现场，调用官方 WeRead Skill 和 LLM 生成实时 AI 反馈的服务端 |
| **官方 WeRead Skill** | 通过 Agent API Gateway 调用微信读书官方能力的接口层，用于获取划线、评论、笔记和书籍数据 |
| **本章阅读价值判断** | 结合整本书评价、本章热门划线、划线评论和章节正文快照，判断当前章节是否值得精读、为什么值得读、重点段落在哪里以及读者共识或争议是什么 |
| **实时 AI 反馈** | 用户翻章或请求分析后，围绕本章阅读价值判断生成的阅读辅助结果 |
| **阅读判断** | 主视图中的实时 AI 反馈，面向用户展示本章是否值得精读、判断范围、关键理由、读者视角和下一步阅读动作；章节变化时自动生成，同章内采集增长时不自动重跑 |
| **掌握价值分** | 阅读判断中的 0-100 综合分，表示本章对接下来理解全书或推进阅读最值得投入注意力的程度；它不是文学质量分或作者水平分 |
| **信息密度分** | 掌握价值分的子维度，衡量本章单位篇幅内包含多少需要记住、区分或迁移的关键内容 |
| **结构关键性分** | 掌握价值分的子维度，衡量本章对全书论证、故事推进或概念体系的承上启下作用 |
| **可跳读风险分** | 掌握价值分的子维度，衡量跳过本章后续阅读出现理解断裂或错过关键转折的风险 |
| **追问问题** | 阅读判断中给用户的 3-5 个带着阅读的问题，用来提示用户接下来应向作者追问什么；它不包含答案，也不模拟作者对话 |
| **本章判断** | 用户手动触发的阅读判断刷新动作，针对当前章节、当前已采集正文和官方 WeRead Skill 信号重新生成阅读判断 |
| **AI 折叠入口** | 阅读页上最小化后的紧凑入口，只显示 `AI`，可点击或通过 Option+Q 展开阅读判断面板 |
| **信号面板** | 阅读判断下方的证据区，包括本章热门划线、按划线 range 归属到对应划线下方的评论，以及整本书评价背景 |
| **短判断** | 阅读判断的当前技术形态，翻章后自动流式生成，可缓存 |
| **长版深度分析** | 用户手动触发的完整分析，比短判断更详细，适合精读前或读后复盘 |
| **Agent 输入日志** | 调试用证据日志，用于确认采集端发给 Agent 服务器的阅读快照、服务器补齐的 Skill 信号和最终发送给 LLM 的输入；默认记录结构、长度、哈希和截断预览，不长期保存整章正文 |
| **单用户 Agent 服务器** | V1 的服务端形态，只服务一个用户，但请求协议保留 `clientToken`，为未来多用户托管预留身份边界 |
| **clientToken** | Chrome 扩展访问 Agent 服务器的开发用令牌；V1 映射到默认用户，未来可扩展为多用户身份与密钥隔离入口 |
| **阅读快照** | 采集端上传给 Agent 服务器的一次当前阅读现场，包含书籍、章节、URL、章节正文快照、内容哈希、采集时间和请求 ID |
| **snapshotId** | Agent 服务器接收阅读快照后返回的标识，用于查询信号面板、打开短判断 SSE 流和复用缓存 |

## 信号优先级

1. **当前章热门划线**：主信号，用于定位本章被多数读者认为重要的段落。
2. **热门划线下的评论/想法**：主信号，用于判断读者共识、争议和解释角度。
3. **书籍上下文信号**：背景信号，用于理解全书类型、章节位置、评分和用户阅读进度，不能压过当前章判断。
4. **整本书公开评价**：背景信号，用于理解全书口碑和阅读预期，不能压过当前章判断。
5. **个人阅读信号**：个性化信号，只有在用户授权并配置后加入。

## 阅读判断结构

1. **结论**：本章值得精读、可快读或可跳读。
2. **掌握价值分**：给出 0-100 综合分，并拆分信息密度分、结构关键性分、可跳读风险分。
3. **理由**：基于章节正文快照、热门划线和划线评论给出 2-3 条证据。
4. **重点段落**：列出 3-5 条热门划线或正文片段。
5. **读者视角**：总结评论中的共识、争议、误读或补充。
6. **追问问题**：给出 3-5 个用户应带着阅读的问题，不生成答案。
7. **阅读动作**：建议用户接下来精读哪部分、如何快读或是否跳读。

## Agent 输入日志

采集端在调试折叠区展示本次发给 Agent 服务器的阅读快照摘要：`bookId`、`bookTitle`、`chapterTitle`、`url`、`chapterText.length`、`contentHash`、截断正文预览、发送时间和请求 ID。

Agent 服务器打印结构化日志：收到的阅读快照、补齐的官方 WeRead Skill 信号、每类信号数量、热门划线 range、评论数量、最终 LLM 输入结构和 token 估算。默认不长期保存整章正文；开发模式可以打印截断正文预览。

## 密钥边界

Chrome 扩展不保存 WeRead API Key 或 LLM API Key。扩展只配置 Agent Server URL 和开发用访问 token；官方 WeRead Skill 调用、LLM 调用、缓存和日志都由 Agent 服务器负责。

## 分享模型

V1 先做单用户 Agent 服务器，目标是让项目作者自己稳定使用。Chrome 扩展请求必须带 `clientToken`；服务器 V1 将该 token 映射到默认用户。未来如果要分享给别人直接使用，可以把 token 映射扩展成用户表，并按用户隔离 WeRead API Key、LLM Key、缓存、日志和分析结果。

## 实时反馈接口流

Chrome 扩展先 `POST /api/reading-snapshots` 上传阅读快照，Agent 服务器返回 `snapshotId` 和信号面板。随后 Chrome 扩展打开 `GET /api/reading-snapshots/:snapshotId/judgement/stream`，通过 SSE 接收短判断。长版深度分析复用同一类流式通道。

## 阅读快照请求体

`POST /api/reading-snapshots` 的最小请求体：

```json
{
  "clientToken": "dev-token",
  "requestId": "uuid",
  "bookId": "string",
  "bookTitle": "string",
  "chapterUid": 123,
  "chapterTitle": "string",
  "url": "https://weread.qq.com/web/reader/...",
  "chapterText": "string",
  "contentHash": "sha256",
  "capturedAt": "2026-05-31T12:00:00.000Z",
  "source": "#preRenderContent"
}
```

`chapterUid` 可以为空；Agent 服务器应尽量用 `bookId + chapterTitle` 通过 `/book/chapterinfo` 补齐。

## 信号面板响应体

`POST /api/reading-snapshots` 返回结构化 JSON，Chrome 扩展负责渲染：

```json
{
  "snapshotId": "string",
  "cache": { "hit": false },
  "signalPanel": {
    "chapter": { "chapterUid": 123, "title": "string" },
    "bookContext": {
      "bookInfo": { "title": "string", "author": "string", "newRating": 86 },
      "readingProgress": { "progress": 25 }
    },
    "publicSignals": {
      "bookReviews": [{ "content": "string", "likeCount": 0 }],
      "bestBookmarks": [{ "range": "1-20", "markText": "string", "totalCount": 12 }],
      "bookmarkReviews": [{ "range": "1-20", "totalCount": 3, "comments": ["string"] }]
    },
    "personalSignals": {
      "enabled": false,
      "bookmarks": [],
      "reviews": [],
      "underlines": []
    },
    "bookReviews": [{ "content": "string", "likeCount": 0 }],
    "bestBookmarks": [{ "range": "1-20", "markText": "string", "totalCount": 12 }],
    "bookmarkReviews": [{ "range": "1-20", "totalCount": 3, "comments": ["string"] }],
    "debug": {
      "skillCalls": ["/book/chapterinfo", "/book/info", "/book/getprogress", "/book/bestbookmarks", "/book/readreviews", "/review/list"],
      "warnings": []
    }
  }
}
```

Agent 服务器不返回 HTML；UI 展示由 Chrome 扩展负责。

## 短判断 SSE 事件

`GET /api/reading-snapshots/:snapshotId/judgement/stream` 使用固定事件格式：

```text
event: start
data: {"snapshotId":"..."}

event: delta
data: {"field":"readingAdvice","text":"..."}

event: complete
data: {"readingJudgement":{"recommendation":"deep_read","masteryScore":{"overall":88,"informationDensity":82,"structuralImportance":90,"skipRisk":75},"nextMustKnow":[],"reasons":[],"keyPassages":[],"questionsForAuthor":[],"readerPerspective":"","readingAdvice":""},"judgement":{"conclusion":"worth_deep_read","reasons":[],"keyPassages":[],"readerPerspective":"","readingAction":""}}

event: error
data: {"message":"...","code":"..."}
```

`delta` 用于流式展示，`complete.judgement` 返回完整结构化短判断并作为缓存对象。

## V1 服务端技术栈

V1 Agent 服务器使用 Node.js + Express。V1 不引入数据库，先使用内存缓存、控制台结构化日志和开发模式截断预览；等阅读价值判断链路稳定后再评估 SQLite 或 Postgres。

## 设计决策

### 数据源：Route A — 信号聚合

**决策**：不依赖官方 API 获取章节正文用于 AI 分析，而是聚合所有可获取的信号。

**理由**：
- weread API（官方和非官方）都不提供章节正文接口
- 离线正文抓取方案（WeReadScan、JS 逆向）延迟在分钟级，不适合实时场景
- 热门划线 + 评论 + 评分已足够构成有价值的分析

**修正**：后来发现通过浏览器采集端在网页版运行时，可以通过 MutationObserver 监听 `#preRenderContent` 获取章节正文快照。因此 V1 实际方案是 **官方 WeRead Skill 信号 + 正文快照混合**：官方信号提供整本书评价、本章热门划线和划线评论，正文快照为这些信号补充当前章节语境。

### 产品形态：Chrome 扩展

**决策**：最终产品和 V1 验证形态都是 Chrome 扩展。早期油猴/离线验证脚本已移除，不作为端到端产品验证路线。

**理由**：
- 项目复杂度高（DOM 监听 + UI 面板 + 流式 AI + 设置页 + 缓存），油猴单文件难以维护
- Chrome 扩展更接近最终交付形态，能同时验证权限、设置页、面板 UI、服务器通信和流式反馈
- 参考项目 `weread_deepreading` 已验证 Chrome 扩展架构可行
- 油猴验证再迁移会产生一次性代码和重复调试成本，后续调试直接在 Chrome 扩展里完成

### 触发模式：信号先到 + 阅读判断自动 + 长分析手动

**决策**：翻章时先自动返回信号面板，再自动流式生成阅读判断；同章内被动采集到更多正文时只更新覆盖提示，不自动重跑 LLM；长版深度分析按需手动触发。

**理由**：
- 信号面板不调 LLM，尽快显示当前章热门划线、划线评论和整本书评价背景
- 阅读判断让实时 AI 跟读成立，避免每章都只停留在数据罗列
- 同章自动重判会增加成本和界面噪音，容易打断阅读；本章判断保留手动控制权
- 长版深度分析消耗更多 token，按需触发控制成本
- 用户体验最自然：先看到读者信号，再看到 AI 判断，感兴趣时再深入

### 架构：浏览器采集端 + Agent 服务器（V1）

**决策**：V1 需要独立 Agent 服务器。Chrome 扩展作为采集端，负责抓取微信读书网页正文快照；Agent 服务器负责调用官方 WeRead Skill 和 LLM，生成实时 AI 反馈。早期油猴/离线验证脚本已经从仓库移除。

**理由**：
- 服务器可以调用官方 WeRead Skill，浏览器扩展不需要直接承载 Agent 编排能力
- WeRead API Key 和 LLM Key 不必暴露给采集端
- 服务端更适合做缓存、流式输出、章节级上下文和后续多 Agent 工作流
- 采集端保持薄层，只处理 DOM 抓取、章节切换检测和 UI 展示

### 交互范围：V1 不含"选中文字问 AI"

**决策**：V1 只做章节级分析，不做文本选中交互。V2 再加。

**理由**：
- V1 目标是验证"AI 跟读分析"核心价值
- 选中交互会让初版复杂度翻倍
- 技术上简单（监听 selectionchange），不影响架构

## 技术要点

### 章节正文快照获取

```javascript
// MutationObserver 监听 #preRenderContent
const observer = new MutationObserver(() => {
  const el = document.querySelector('.preRenderContainer:not([style])');
  if (!el) return;
  const content = el.querySelector('#preRenderContent');
  if (content) {
    const chapterHTML = content.innerHTML;
    handleNewChapter(chapterHTML);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
```

### weread API 可用信号

| 数据 | 接口 | 含原文 |
|------|------|--------|
| 阅读进度 | `/book/getprogress` | ❌ |
| 章节目录 | `/book/chapterinfo` | ❌ |
| 个人划线 | `/book/bookmarklist` | ✅ |
| 热门划线 | `/book/bestbookmarks` | ✅ (每章最多20条) |
| 划线热度 | `/book/underlines` | ❌ (只有人数) |
| 个人想法 | `/review/list/mine` | ✅ |
| 划线评论 | `/book/readreviews` | ✅ |
| 书籍点评 | `/review/list` | ✅ |

### 参考项目

| 项目 | 参考价值 |
|------|---------|
| `lagrangee/weread_deepreading` | Chrome 扩展架构、UI 面板、事件总线、流式对话 |
| `leic4u/WeRead-Scraper` | MutationObserver + #preRenderContent 提取方案 |
| `Higurashi-kagome/wereader` | Chrome 扩展 + weread API 集成 |
| `zhangyu0806/weread-enhanced` | 油猴脚本 UI 模式参考 |

## 版本规划

### V1 — 核心验证
- [ ] Chrome 扩展验证章节正文快照获取
- [ ] Chrome 扩展连接 Agent 服务器
- [ ] MutationObserver 章节切换检测
- [ ] 轻量分析面板（热门划线 + 评论聚合）
- [ ] 深度分析按钮 → LLM 流式回复
- [ ] 设置页（API Key、LLM 选择）
- [ ] 分析结果缓存

### V2 — 交互增强
- [ ] 选中文字问 AI
- [ ] 章节间上下文关联分析
- [ ] 阅读历史和分析记录
- [ ] 暗色模式适配
