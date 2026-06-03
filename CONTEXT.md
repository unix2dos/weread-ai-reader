# WeRead AI Reader — 微信读书 AI 实时跟读助手

## 项目定位

在微信读书网页版阅读时，自动分析当前章节内容，提供章节摘要、重点分析和阅读方式判断，帮助用户决定这一章如何分配注意力：必须精读、局部精读、快读或跳读。

## 核心术语

| 术语 | 定义 |
|------|------|
| **轻量分析** | 不调 LLM，仅聚合 weread API 数据（热门划线、评论、章节元数据），毫秒级返回 |
| **深度分析** | 将官方 WeRead Skill 信号 + 章节正文快照发给 LLM，生成摘要、重点、评分，需 3-8 秒 |
| **章节正文快照** | 采集时刻从微信读书网页版 DOM 中可提取的当前章节正文文本，用于 AI 总结；不承诺包含图片、脚注弹层、公式、表格或复杂排版 |
| **信号** | 由官方 WeRead Skill 获取的读者反馈数据，包括整本书评价、本章热门划线、划线评论、划线热度、个人笔记和书籍评分 |
| **热度信号** | 由划线人数、点赞数和评论数量体现的读者注意力信号；它只能说明读者关注过某段内容，不能单独证明本章有高收获价值 |
| **公共阅读信号** | 不依赖当前用户个人笔记的 WeRead 信号，包括本章热门划线、划线评论和整本书公开评价；它是阅读判断的默认证据层 |
| **书籍上下文信号** | 用来理解本章在全书中的位置和背景的信息，包括书籍元信息、章节目录、章节字数、全书评分和当前阅读进度 |
| **个人阅读信号** | 当前用户自己的划线、想法、点评和阅读进度；用于个性化判断读完本章最可能带走什么收获，但需要明确作为可选增强层处理 |
| **采集端** | 运行在微信读书网页版里的 Chrome 扩展，负责识别当前阅读现场并被动抓取已渲染正文 |
| **Agent 服务器** | 接收采集端上传的阅读现场，调用官方 WeRead Skill 和 LLM 生成实时 AI 反馈的服务端 |
| **官方 WeRead Skill** | 通过 Agent API Gateway 调用微信读书官方能力的接口层，用于获取划线、评论、笔记和书籍数据 |
| **本章收获价值判断** | 结合整本书评价、本章热门划线、划线评论和章节正文快照，判断读者读完当前章节最可能带走什么可靠收获，以及这些收获是否值得投入注意力；它不等同于章节热度、内容增量或文学质量 |
| **实时 AI 反馈** | 用户翻章或请求分析后，围绕本章收获价值判断生成的阅读辅助结果 |
| **阅读判断** | 主视图中的实时 AI 反馈，面向用户展示本章建议读法、能带走的核心收获、带着读的问题和下一步阅读动作；它用于阅读前分配注意力，不用于评价章节质量；章节变化时自动生成，同章内采集增长时不自动重跑 |
| **AI 摘要窗口** | 独立于微信读书网页内容区的伴随展示面，用于在不遮挡、不压缩正文的情况下展示精炼阅读判断；用户手动打开一次后，它跟随当前阅读现场更新，记住上次位置和大小；关闭后不自动重开，只由扩展工具栏 popup 重新打开；它不负责采集正文 |
| **采集上下文** | AI 摘要窗口头部展示的当前阅读现场信息，包括书名、章节名、已采集正文字数、官方章节字数、覆盖率和采集方式；它说明本次判断基于多少正文，不属于阅读信号 |
| **收获价值分** | 阅读判断中的 0-100 综合分，表示读者读完本章能带走的可靠收获及其投入回报；它不是文学质量分、作者水平分、热度分或单纯内容增量分；首屏应展示总分和三个子分；只有达到高门槛时才应支撑全章精读结论 |
| **可带走收获** | 收获价值的核心判断维度，衡量本章是否提供清晰概念、方法、判断框架、关键事实或可迁移理解，而不是只提供重复、空泛或情绪性内容 |
| **理解杠杆** | 收获价值的核心判断维度，衡量本章是否能解锁后文、全书主线、关键问题或重要区分 |
| **投入回报** | 收获价值的核心判断维度，衡量慢读本章相对快读、局部精读或跳读是否划算 |
| **收获证据** | 能支撑收获价值判断的内容证据，包括清晰概念、方法、重要区分、因果链、反证、适用边界或后文枢纽；金句、共鸣、重复观点和泛泛赞同只有热度，不自动构成收获证据 |
| **精读门槛** | 阅读判断中区分精读、快读和跳读的严格评分语义：90 分以上表示必须精读，80-89 表示值得精读但必须说明具体价值来源，65-79 表示快读为主并只精读局部，65 以下表示可跳读或只扫结论 |
| **全章级读法** | 阅读判断结论中的总体阅读策略，包括必须精读、值得精读、可快读和可跳读；它约束阅读动作的措辞，避免出现“可快读”结论下又要求“必须精读”的冲突 |
| **局部精读** | 可快读章节中的局部放慢策略，只针对定义、因果链、转折段、核心数据或高热划线附近上下文；它不能写成“必须精读”，因为“必须精读”保留给全章级读法 |
| **带着读的问题** | 阅读判断中给用户的 1-2 个读前验证问题，用来检查本章核心收获是否被读懂；至少一个问题应围绕核心收获，另一个问题可以追问适用边界、前提、反证或常见误读；它不包含答案，也不模拟作者对话 |
| **证据片段** | 判断依据中的可追溯文本证据，来自服务端提供的热门划线、划线评论或必要的正文片段候选；每条证据应说明支撑哪个核心收获或读法判断，不能由 LLM 自由编造 |
| **依据偏弱提示** | 阅读判断在正文覆盖率低、公共信号少、章节定位失败或 Skill 信号告警较多时显示的短提示；它不是常驻可信度分，只在证据不足可能影响读前预判时出现 |
| **本章判断** | 用户手动触发的阅读判断刷新动作，针对当前章节、当前已采集正文和官方 WeRead Skill 信号重新生成阅读判断；主入口在扩展工具栏 popup，次入口在 AI 摘要窗口，微信读书页面内不显示可见刷新按钮 |
| **扩展工具栏 popup** | 用户点击 Chrome 扩展图标后出现的短暂控制面板，用于打开或聚焦 AI 摘要窗口、触发本章判断、显示当前短状态、打开设置和执行维护操作；它不是常驻阅读反馈面，失焦关闭后不继续展示实时摘要；`Option+Q` 仍然作为打开或聚焦 AI 摘要窗口的快捷入口 |
| **扩展图标 badge** | Chrome 扩展图标上的短状态提示，用于在没有页面内 AI 小框时表达生成中、完成或失败；它只承载状态，不承载阅读判断内容 |
| **阅读信号** | AI 摘要窗口中独立于 Agent 分析的当前章节 WeRead 公共信号区，包括本章热门划线、按划线 range 归属到对应划线下方的评论和信号告警；默认展开，但只显示少量高信号摘要，更多划线和评论进入展开明细 |
| **整本书评价背景** | AI 摘要窗口中独立展示的全书公开书评背景区，用来补充全书口碑和主题预期；默认折叠，避免压过当前章节判断 |
| **信号面板** | Agent 服务器返回给采集端的 Skill 信号结构，是阅读信号的原始数据来源，不等同于 UI 上的阅读判断 |
| **极简首屏** | AI 摘要窗口默认展示的高价值摘要层，包括头部采集上下文、阅读判断、默认展开的阅读信号、默认折叠的整本书评价背景和默认折叠的调试区；阅读判断首屏应优先回答“本章能带走什么”和“怎么读”，证据层可以折叠；调试区只放请求摘要和完整请求 |
| **短判断** | 阅读判断的当前技术形态，翻章后自动流式生成，可缓存 |
| **长版深度分析** | 用户手动触发的完整分析，比短判断更详细，适合精读前或读后复盘 |
| **Agent 输入日志** | 调试用日志，用于确认采集端发给 Agent 服务器的阅读快照、服务器补齐的 Skill 信号和最终发送给 LLM 的输入；默认记录结构、长度、哈希和截断预览，不长期保存整章正文 |
| **单用户 Agent 服务器** | V1 的服务端形态，只服务一个用户，但请求协议保留 `clientToken`，为未来多用户托管预留身份边界 |
| **clientToken** | Chrome 扩展访问 Agent 服务器的开发用令牌；V1 映射到默认用户，未来可扩展为多用户身份与密钥隔离入口 |
| **阅读快照** | 采集端上传给 Agent 服务器的一次当前阅读现场，包含书籍与章节标识、URL、章节正文快照、内容哈希、采集时间和请求 ID；它不是 WeRead 公共阅读信号本身，只是定位和生成判断的输入 |
| **snapshotId** | Agent 服务器接收阅读快照后返回的标识，用于查询信号面板、打开短判断 SSE 流和复用缓存 |

## 信号优先级

1. **当前章热门划线**：主信号，用于定位读者关注过的段落；它是热度信号，不能单独证明收获价值。
2. **热门划线下的评论/想法**：主信号，用于判断读者共识、争议和解释角度；只有包含解释、反驳、应用或边界讨论时才显著增强收获价值。
3. **书籍上下文信号**：背景信号，用于理解全书类型、章节位置、评分和用户阅读进度，不能压过当前章判断。
4. **整本书公开评价**：背景信号，用于理解全书口碑和阅读预期，不能压过当前章判断。
5. **个人阅读信号**：个性化信号，只有在用户授权并配置后加入。

## 阅读判断结构

1. **结论**：本章必须精读、值得精读、可快读或可跳读。
2. **收获价值分**：展示 0-100 综合分，并展示可带走收获、理解杠杆和投入回报三个子分。
3. **能带走的收获**：给出 1-3 条读完本章最可能获得的概念、方法、判断框架、关键事实或可迁移理解。
4. **带着读的问题**：给出 1-2 个读前验证问题，必须回连到核心收获或证据，不生成答案。
5. **阅读动作**：用一句话建议用户接下来整章精读、局部精读、如何快读或是否跳读；阅读动作必须服从全章级读法。
6. **判断依据**：折叠展示读者视角、关键理由和证据片段；证据片段需要标明来源并回连到核心收获或读法判断。
7. **依据偏弱提示**：只在正文覆盖或公共信号不足时显示，用来提醒用户降低对本次读前判断的确定性。

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
      "bookReviews": [{ "content": "string", "likeCount": 2 }],
      "bestBookmarks": [{ "range": "1-20", "markText": "string", "totalCount": 12 }],
      "bookmarkReviews": [{ "range": "1-20", "totalCount": 3, "comments": [{ "content": "string", "likeCount": 2 }] }]
    },
    "personalSignals": {
      "enabled": false,
      "bookmarks": [],
      "reviews": [],
      "underlines": []
    },
    "bookReviews": [{ "content": "string", "likeCount": 2 }],
    "bestBookmarks": [{ "range": "1-20", "markText": "string", "totalCount": 12 }],
    "bookmarkReviews": [{ "range": "1-20", "totalCount": 3, "comments": [{ "content": "string", "likeCount": 2 }] }],
    "debug": {
      "skillCalls": ["/book/chapterinfo", "/book/info", "/book/getprogress", "/book/bestbookmarks", "/book/readreviews", "/review/list", "/review/single"],
      "warnings": []
    }
  }
}
```

`likeCount` 只在 WeRead Skill 回包明确提供点赞数字段时出现；不能把缺失字段归一化成 `0`。
当 `/book/readreviews` 只返回评论内容和 `reviewId` 时，Agent 最多对 20 条评论追加调用 `/review/single` 补点赞数，再按点赞数展示每条划线下的 top3 评论。

Agent 服务器不返回 HTML；UI 展示由 Chrome 扩展负责。

## 短判断 SSE 事件

`GET /api/reading-snapshots/:snapshotId/judgement/stream` 使用固定事件格式：

```text
event: start
data: {"snapshotId":"..."}

event: delta
data: {"field":"readingAdvice","text":"..."}

event: complete
data: {"readingJudgement":{"recommendation":"deep_read","masteryScore":{"overall":83,"takeawayValue":82,"understandingLeverage":90,"attentionROI":75},"nextMustKnow":[],"reasons":[],"evidenceSnippets":[],"questionsForAuthor":[],"readerPerspective":"","readingAdvice":"","evidenceWarning":""},"judgement":{"conclusion":"worth_deep_read","reasons":[],"keyPassages":[],"readerPerspective":"","readingAction":""}}

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
| 评论点赞详情 | `/review/single` | ✅ |
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
