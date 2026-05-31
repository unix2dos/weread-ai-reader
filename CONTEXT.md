# WeRead AI Reader — 微信读书 AI 实时跟读助手

## 项目定位

在微信读书网页版阅读时，自动分析当前章节内容，提供章节摘要、重点分析、深度阅读评分，帮助用户判断是否值得精读。

## 核心术语

| 术语 | 定义 |
|------|------|
| **轻量分析** | 不调 LLM，仅聚合 weread API 数据（热门划线、评论、章节元数据），毫秒级返回 |
| **深度分析** | 将章节全文 + API 数据发给 LLM，生成摘要、重点、评分，需 3-8 秒 |
| **章节全文** | 从 `#preRenderContent` DOM 节点提取的当前章节完整 HTML 内容 |
| **信号** | 可用于分析的间接数据源：热门划线、划线热度、评论、个人笔记、书籍评分 |

## 设计决策

### 数据源：Route A — 信号聚合

**决策**：不获取章节全文用于 AI 分析，而是聚合所有可获取的信号。

**理由**：
- weread API（官方和非官方）都不提供章节正文接口
- 全文获取方案（WeReadScan、JS 逆向）延迟在分钟级，不适合实时场景
- 热门划线 + 评论 + 评分已足够构成有价值的分析

**修正**：后来发现通过油猴/Chrome 扩展在网页版运行时，可以通过 MutationObserver 监听 `#preRenderContent` 获取章节全文。因此 V1 实际方案是 **全文 + 信号混合**，比纯 Route A 更强。

### 产品形态：Chrome 扩展（V1 先用油猴验证）

**决策**：最终产品是 Chrome 扩展，V1 先用 Tampermonkey 油猴脚本验证核心技术可行性。

**理由**：
- 项目复杂度高（DOM 监听 + UI 面板 + 流式 AI + 设置页 + 缓存），油猴单文件难以维护
- Chrome 扩展有 background service worker，可做缓存和异步处理
- 参考项目 `weread_deepreading` 已验证 Chrome 扩展架构可行
- 油猴验证脚本验证完即弃用，核心逻辑迁移到扩展

### 触发模式：Mode 3 — 混合触发

**决策**：翻章时自动触发轻量分析（零成本、零延迟），深度分析按需手动触发。

**理由**：
- 轻量分析不调 LLM，每章都有，给用户即时反馈
- 深度分析消耗 token，按需触发控制成本
- 用户体验最自然：先看快速概览，感兴趣再深入

### 架构：纯 Chrome 扩展，无后端服务器（V1）

**决策**：V1 不需要独立后端，API 调用在 background service worker 中完成。

**理由**：
- 个人项目，API Key 存浏览器 `chrome.storage.local` 足够安全
- background service worker 本身就是"本地后端"
- 少一个服务 = 少一半部署复杂度
- 未来如需服务端，只需把 background 的 API 调用逻辑抽成 HTTP 接口

### 交互范围：V1 不含"选中文字问 AI"

**决策**：V1 只做章节级分析，不做文本选中交互。V2 再加。

**理由**：
- V1 目标是验证"AI 跟读分析"核心价值
- 选中交互会让初版复杂度翻倍
- 技术上简单（监听 selectionchange），不影响架构

## 技术要点

### 章节全文获取

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
- [ ] 油猴脚本验证章节全文获取
- [ ] Chrome 扩展脚手架
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
