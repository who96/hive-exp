# hive-exp 竞品分析报告

> **日期**: 2026-03-01
> **状态**: v1.0
> **方法**: 多源交叉验证（GitHub 仓库分析 + 官方文档 + 第三方 benchmark + 社区反馈）

---

## 0. 一句话结论

**hive-exp 没有直接竞品。** 市场上有做"记忆"的（Mem0/Zep/Letta），有做"规则"的（Cursor/Windsurf），但**没有人在做"结构化解题经验的跨厂商互操作"**。这既是机会也是风险 — 机会在于蓝海，风险在于市场可能还不存在。

---

## 1. 市场地图

```
             记忆（What was said）          经验（What worked）
             ─────────────────              ─────────────────
                  │                              │
  云端 API   Mem0 (48K★, $24M)                   │
  ─────────  Zep Cloud                           │  ← 空白地带
             Cognee (12K★, $7.5M)                │
                  │                              │
  开源框架   Letta (16K★)                         │
  ─────────  LangMem                        hive-exp ← 我们在这里
             Graphiti (20K★)                     │
                  │                              │
  IDE 内置   Cursor Memories                     │
  ─────────  Windsurf Memories                   │  ← 没有人在做
                  │                              │
```

**关键洞察**：整个行业都在抢"记忆层"（Memory Layer），没有人在做"经验层"（Experience Layer）。记忆回答"发生了什么"，经验回答"什么方法管用"。这是两个不同的问题。

---

## 2. Mem0 深度分析

### 2.1 基本面

| 指标 | 数据 |
|------|------|
| GitHub Stars | 48,300+ |
| Forks | 5,400+ |
| 贡献者 | 254 |
| PyPI 下载量 | 13M+ |
| 融资 | $24M Series A（YC, Peak XV, Basis Set）|
| 云端月调用量 | 186M/月（2025 Q3，30% MoM 增长）|
| 注册开发者 | 80,000+ |
| 合作伙伴 | AWS（Agent SDK 记忆集成合作伙伴，"独家"关系待验证）|

### 2.2 架构

```
┌─────────────────────────────────────────────┐
│                 Mem0 Pipeline                │
│                                             │
│  Input (对话) → LLM 提取 → 候选记忆         │
│                    │                        │
│              ┌─────┴─────┐                  │
│              │ 比对 top-N │                  │
│              │ 相似记忆   │                  │
│              └─────┬─────┘                  │
│                    │                        │
│          LLM 决策: ADD / UPDATE /            │
│                   MERGE / DELETE             │
│                    │                        │
│         ┌─────────┼─────────┐              │
│         ▼         ▼         ▼              │
│    Vector DB   Graph DB   KV Store         │
│   (Qdrant等)  (Neo4j)   (Redis等)         │
└─────────────────────────────────────────────┘
```

**数据模型**：半结构化。基础版无 schema 约束，每条记忆是 LLM 从对话中提取的自然语言事实片段（如"用户偏好晨跑"、"对青霉素过敏"）。Graph 版本（Mem0g，仅 Pro $249/月用户）增加了实体-关系三元组结构，但该结构描述的是实体间关系（"Alice → knows → Bob"），而非解题经验的因果关系（signal → strategy → outcome）。

**与 hive-exp 的根本区别**：Mem0 存的是 **"用户说了什么"**（对话事实），hive-exp 存的是 **"什么策略在什么条件下解决了什么问题"**（结构化三元组 signal → strategy → outcome）。

### 2.3 致命弱点

#### 弱点 1: LLM-as-memory-judge — 质量是概率性的

所有记忆的提取、评分、更新、删除决策都委托给 LLM。这意味着记忆质量是 LLM 当前能力的函数，不是系统级保证。

**独立 Benchmark 数据（HaluMem, 2024；注意：数据来自第三方 benchmark，测试时使用的 Mem0 版本未明确标注，后续版本可能已改善）**：
- 记忆问答准确率：**53.02%**
- 记忆更新准确率：**< 26%**
- 在 1M token 对话长度下，更新准确率崩溃到 **0.92%**

> 这些数据反映的是 LLM-as-memory-judge 架构的固有局限性，而非 Mem0 某个特定版本的 bug。即使 Mem0 更新了 LLM 或优化了 prompt，只要核心决策链仍委托给 LLM，质量上限就受制于 LLM 的推理能力。

#### 弱点 2: 无结果追踪（No Outcome Tracking）

Mem0 没有任何机制记录"某条记忆被使用后，结果是成功还是失败"。它只知道"这条记忆存在"和"这条记忆被检索了"，不知道"这条记忆有没有用"。

**hive-exp 的差异**：每条经验都有 `outcome.status`（success/failed/partial）和 `evidence_digest`（可验证的证据哈希）。经验的价值是可量化的。

#### 弱点 3: 无置信度衰减（No Confidence Decay）

过时的记忆和新鲜的记忆权重相同。Mem0 没有时间衰减机制 — 三个月前的事实和三分钟前的事实被同等对待，除非手动管理。

**hive-exp 的差异**：30 天半衰期自动衰减 + 三条自动淘汰规则。

#### 弱点 4: 无人工审核流程（No Human-in-the-Loop）

记忆被 LLM 提取后直接存入系统，没有审核队列、没有投票机制、没有"3 个 Agent 确认这个策略有效"的共识机制。

**hive-exp 的差异**：PR 审核流（AI + 人工分级）+ provisional 观察期 + 跨 Agent 共识触发。

#### 弱点 5: 定价悬崖

| 层级 | 价格 | 关键限制 |
|------|------|---------|
| Free | $0 | 10K 记忆，1K 检索/月 |
| Starter | $19/月 | 50K 记忆，无 Graph |
| Pro | $249/月 | Graph 解锁 |

$19 → $249 是 **13 倍跳跃**。最有价值的功能（Graph Memory）被锁在 Pro 层。

#### 弱点 6: 多 Agent 记忆泄露（已知 Bug）

GitHub Issue #3998：多 Agent 网关场景下，共享同一 `user_id` 的不同专业 Agent 之间记忆会交叉污染（诊所 SOP 渗入私人助理上下文）。这是未解决的架构问题。

### 2.4 Mem0 的 OpenMemory MCP

这是 Mem0 最接近 hive-exp 定位的产品：

- 本地优先的 MCP 服务器（Docker: FastAPI + Postgres + Qdrant）
- 支持 Cursor、Claude Desktop、Windsurf 跨工具共享记忆
- 有细粒度 ACL（per-app allow/deny）
- SSE 实时更新

**为什么它不是 hive-exp 的竞品**：OpenMemory 共享的是"用户偏好和对话事实"，不是"结构化解题经验"。它回答"这个用户喜欢 Tab 还是 Space"，不回答"遇到 TypeScript 循环引用错误时，什么修复策略成功率最高"。

---

## 3. 其他竞品逐一分析

### 3.1 Letta（原 MemGPT）— 16K★

**定位**：LLM-as-OS，Agent 自管理记忆。

**架构亮点**：
- OS 隐喻：Core Memory（RAM）+ Recall Memory（搜索历史）+ Archival Memory（长期存储）
- Agent 通过 tool call 自主决定什么留在上下文、什么写入外部存储
- Agent File（.af）格式：Agent 连同记忆状态可序列化、可移植

**与 hive-exp 的关系**：**上下游，非竞品。**
- Letta 管的是单 Agent 的上下文状态（"我现在在做什么"）
- hive-exp 管的是跨 Agent 的解题经验（"遇到这个坑怎么绕"）
- hive-exp 可以作为 Letta Agent 的 archival memory 数据源之一

**弱点**：需要整体采纳 Letta 框架，不能像 Mem0 一样"加一行 API 调用"就集成。

### 3.2 Zep / Graphiti — 20K★（Graphiti）

**定位**：时序知识图谱（Temporal Knowledge Graph）。

**架构亮点**：
- 双时态模型：追踪事件发生时间 AND 事件录入时间
- 混合检索：语义 + BM25 + 图遍历，P95 < 200ms
- 事实随时间自动失效（temporal invalidation）

**与 hive-exp 的关系**：**底层图原语，潜在依赖。**
- Graphiti 是存储层，hive-exp 是语义层
- hive-exp 的 Memory Graph 未来可考虑用 Graphiti 作为底层
- 但 Phase 0.5-1 用 JSONL + SQLite 够了，不需要引入 Neo4j

**弱点**：Zep 社区版已废弃（2025），只推云端服务。开源社区信任受损。

### 3.3 LangMem — 小众

**定位**：LangGraph 生态的长期记忆 SDK。

**架构亮点**：
- 三种记忆类型：语义（事实）、情景（回忆）、程序性（学到的指令）
- 程序性记忆（Procedural Memory）是真正的创新：系统根据积累的经验重写 Agent 自己的 prompt

**与 hive-exp 的关系**：**部分重叠。**
- LangMem 的 Procedural Memory 概念接近 hive-exp 的"经验驱动策略推荐"
- 但 LangMem 深度绑定 LangGraph，不跨厂商
- P50 搜索延迟 18 秒、P95 60 秒 — 生产不可用

**弱点**：延迟灾难性地高。无 TypeScript SDK。锁定 LangChain 生态。

### 3.4 Cursor Memories / Windsurf Memories — IDE 内置

**实质**：自动生成的 `.cursorrules` / `.windsurf/rules/` 文本文件。本质是 **prompt injection with marketing**。

**与 hive-exp 的关系**：**完全不同层。**
- 这些是单 IDE、单用户、非结构化的偏好规则
- 没有 schema、没有验证、没有信任分级、没有跨工具
- hive-exp 的 experience 可以通过 adapter 注入这些 IDE 的 rules 目录

### 3.5 Cognee — 12K★

**定位**：开源知识引擎（ECL 管道：Extract → Cognify → Load）。

**架构亮点**：
- 最丰富的语义图构建（比 Mem0 和 Graphiti 更深的语义层）
- 多后端支持（Neo4j, FalkorDB, KuzuDB + Redis, Qdrant, Weaviate）
- $7.5M 种子轮（2026.02），OpenAI 和 FAIR 创始人背书

**与 hive-exp 的关系**：**潜在底层依赖。**
- Cognee 做知识图谱构建，hive-exp 做经验管理
- 未来 hive-exp 的 RAG 回写模块可以考虑用 Cognee 的 pipeline

---

## 4. 核心对比矩阵

| 维度 | Mem0 | Letta | Zep/Graphiti | LangMem | Cursor/WS | **hive-exp** |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **存什么** | 对话事实 | Agent 状态 | 时序实体关系 | 事实+程序 | 偏好规则 | **解题经验** |
| **数据模型** | 半结构化（Graph 版为结构化） | 层级结构 | 时序图 | 半结构化 | 纯文本 | **结构化三元组** |
| **跨厂商** | ✅ (MCP) | ✅ (模型无关) | ✅ (API) | ❌ (LangGraph) | ❌ (单 IDE) | **✅ (adapter)** |
| **团队共享** | 命名空间 | Conversations API | 多租户 | 命名空间 | git rules | **PR 审核流** |
| **结果追踪** | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ (outcome)** |
| **信任机制** | 阈值(opt-in) | 无 | 时序失效 | 无 | 无 | **衰减+淘汰+审核** |
| **置信度衰减** | ❌ | ❌ | ✅ (temporal) | ❌ | ❌ | **✅ (30d半衰期)** |
| **人工审核** | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ (promote流)** |
| **开源** | ✅ (Apache 2.0) | ✅ | 部分 | ✅ (MIT) | ❌ | **✅ (计划中)** |
| **自托管** | ✅ (复杂) | ✅ | Graphiti可 | ✅ | ❌ | **✅ (本地优先)** |
| **Stars** | 48K | 16K | 20K(Graphiti) | 小 | N/A | **0 (未发布)** |

**红色警报列**：所有竞品在"结果追踪"和"人工审核"两个维度上都是 ❌。这是 hive-exp 独有的差异化区间。

---

## 5. 竞争定位分析

### 5.1 三场正在发生的战争

| 战场 | 选手 | 状态 |
|------|------|------|
| **基础设施 API 层** | Mem0 vs Zep vs Letta | Mem0 在开发者采纳上领先，Zep 在架构上领先，Letta 在深度上领先 |
| **IDE 便捷层** | Cursor vs Windsurf | 零创新 — 本质是自动化 prompt injection |
| **图原语层** | Graphiti vs Cognee vs LightRAG | Graphiti 势头最猛（20K★ + MCP 1.0）|

### 5.2 hive-exp 不在这三个战场上

hive-exp 要开辟的是**第四个战场**：

```
战场 4: 结构化经验互操作层
────────────────────────────
- 不是"记住对话"     → 是"记住什么方法管用"
- 不是"单 Agent"     → 是"跨 Agent 跨团队"
- 不是"LLM 判断质量" → 是"outcome 数据证明质量"
- 不是"SaaS API"     → 是"本地优先 + 开放协议"
```

### 5.3 护城河分析

| 护城河类型 | hive-exp 是否具备 | 说明 |
|-----------|:---:|------|
| 网络效应 | ⚠️ 弱 | 需要达到临界用户量才能触发经验共享的网络效应。Phase 1 单人版无网络效应。 |
| 数据壁垒 | ⚠️ 中 | 一旦团队积累了大量结构化经验，迁移成本高。但 Phase 1 数据量小。 |
| 协议锁定 | ✅ 强（如果成功）| 如果 experience record schema 成为事实标准，所有人都要兼容。类似 OpenTelemetry。 |
| 技术壁垒 | ❌ 弱 | 核心技术不复杂（YAML + JSONL + SQLite），Mem0 如果想做可以很快复制。 |
| 社区壁垒 | ⚠️ 取决于执行 | 开源社区的 adapter 贡献者生态。 |

**核心风险**：如果 Mem0 决定在其 Platform 上增加 "structured experience" 类型和 outcome tracking，凭借 48K stars + $24M 融资 + AWS 合作关系，可以在 3-6 个月内做出类似功能。hive-exp 的防御策略是**协议标准化 + 厂商中立** — Mem0 做的是自己平台的功能，hive-exp 做的是跨平台的开放标准。

---

## 6. 定位建议

### 6.1 放弃的定位

| 定位 | 为什么放弃 |
|------|-----------|
| "Git for AI Agent Experiences" | Letta Context Repositories 已用 "git-backed memory"，话术撞车 |
| "Memory Layer for AI Agents" | 这是 Mem0 的 slogan，正面竞争必输 |
| "Agent Memory Platform" | 所有人都在做 memory platform，红海 |

### 6.2 推荐的定位

**主定位**：
> **"The experience protocol for AI agents"**
> — 一个开放的、可审计的经验互操作协议。不是 memory，是 experience。

**类比**：
> OpenTelemetry 解决了 "可观测性数据的跨厂商互操作"
> hive-exp 解决了 "解题经验的跨 Agent 互操作"

**差异化叙事（三句话）**：
1. Mem0 记住用户说了什么 → hive-exp 记住什么方法管用
2. Cursor 的经验锁在 Cursor 里 → hive-exp 的经验可以流通到任何 Agent
3. 所有竞品的记忆质量靠 LLM 猜 → hive-exp 的经验质量靠 outcome 数据证明

### 6.3 Tagline 候选

| 选项 | 评价 |
|------|------|
| "The experience protocol for AI agents" | ✅ 精准，类比 OpenTelemetry |
| "Context7 for solutions, not docs" | ✅ 简洁，但依赖对 Context7 的认知 |
| "Structured experience sharing across any AI agent" | ⚠️ 准确但太长 |
| "What worked, verified, shared" | ⚠️ 有力但不够具体 |

---

## 7. 与 Mem0 的互补/竞争场景推演

### 场景 A: 互补（最可能，70%）

```
用户的 Cursor   ──→  Mem0 OpenMemory  ──→  "用户偏好 dark mode"
用户的 Claude   ──→  Mem0 OpenMemory  ──→  "用户常用 TypeScript"
                                              │
                                              ▼  (hive-exp 不碰这块)
                                    ┌──────────────────┐
                                    │  用户画像/偏好层   │
                                    └──────────────────┘

用户的 Claude   ──→  hive-exp        ──→  "tsc 循环引用 → 策略A → 87% 成功"
用户的 Codex    ──→  hive-exp        ──→  "ESLint 误报 → 策略B → 92% 成功"
                                              │
                                              ▼  (Mem0 不碰这块)
                                    ┌──────────────────┐
                                    │  解题经验/策略层   │
                                    └──────────────────┘
```

两者共存，各管各的层。hive-exp 甚至可以做 `@hive-exp/adapter-mem0`，让 Mem0 用户把高价值经验存入 Mem0 的 organizational memory。

### 场景 B: Mem0 扩张（可能，25%）

Mem0 在 v3.0 中增加 "Experience Memory" 类型，支持 structured schema + outcome tracking。凭借现有生态快速获客。

**hive-exp 的防御**：
- 协议开放性 — Mem0 的实现是平台锁定的，hive-exp 的 schema 是开放标准
- 本地优先 — 企业数据不出本地，Mem0 云端方案有合规风险
- Adapter 生态 — 任何人可以写 adapter，不依赖单一厂商

### 场景 C: Mem0 收购/集成（低概率，5%）

Mem0 直接采纳 hive-exp 的 experience record schema 作为其平台的一种内置 memory type。

**这其实是 hive-exp 的最佳退出场景** — 协议成为标准，被主流平台采纳。

---

## 8. 行动建议

### 8.1 立即做（Phase 0.5 前）

1. **确定最终 slogan** — 建议 "The experience protocol for AI agents"
2. **在 README 中明确与 Mem0/Letta/Cursor Memories 的区别** — 用一张对比表
3. **注册 npm 包名** — `@hive-exp/core`、`hive-exp`（CLI）

### 8.2 Phase 1 做

4. **设计 `@hive-exp/adapter-mem0` 接口**（不实现，只定义 interface）— 表明互补而非竞争姿态
5. **Signal Semantic Convention Table** — 这是跨厂商互操作的核心差异化，Mem0 没有
6. **Conformance Test Suite** — 让第三方 adapter 开发者可以自验

### 8.3 Phase 2+ 做

7. **发布 "Experience Record Spec" 独立文档** — 类似 OpenTelemetry Spec，与实现分离
8. **考虑 Graphiti 作为 Memory Graph 的可选后端** — 借助 20K★ 社区
9. **Python SDK** — Mem0 的主力用户群在 Python 生态

---

## 附录 A: 数据源

| 来源 | URL |
|------|-----|
| Mem0 GitHub | github.com/mem0ai/mem0 |
| Mem0 论文 | arxiv.org/abs/2504.19413 |
| Mem0 融资 | TechCrunch 2025-10-28 |
| Mem0 定价 | mem0.ai/pricing |
| OpenMemory MCP | mem0.ai/blog/introducing-openmemory-mcp |
| Mem0 Issue #3998 | github.com/mem0ai/mem0/issues/3998 |
| Mem0 Issue #2672 | github.com/mem0ai/mem0/issues/2672 |
| HaluMem Benchmark | guptadeepak.com/the-ai-memory-wars |
| AI Memory Crisis | medium.com/@mohantaastha (62% wrong memories) |
| Letta GitHub | github.com/letta-ai/letta |
| Graphiti GitHub | github.com/getzep/graphiti |
| LangMem GitHub | github.com/langchain-ai/langmem |
| Cognee 融资 | cognee.ai/blog (2026-02, $7.5M) |
| 竞品对比 2026 | dev.to/anajuliabit (Mem0 vs Zep vs LangMem vs MemoClaw) |
| 协作记忆论文 | arxiv.org/html/2505.18279v1 |
| Zep 开源策略 | blog.getzep.com (new direction) |
| Windsurf 记忆 | docs.windsurf.com/windsurf/cascade/memories |
| Cursor 0.51 | forum.cursor.com/t/0-51-memories-feature |
| AI Memory 概览 | arize.com/ai-memory |
| VentureBeat | venturebeat.com (shared memory missing layer) |

## 附录 B: Mem0 技术细节补充

### Mem0 的四层记忆模型

| 层级 | 生命周期 | 用途 |
|------|---------|------|
| Conversation Memory | 单轮 | 当前 turn 的工具输出 |
| Session Memory | 分钟~小时 | 多步任务上下文 |
| User Memory | 周~永久 | 用户偏好、历史 |
| Organizational Memory | 永久 | 组织 FAQ、策略 |

### Mem0 SDK 接口

```python
# Python
from mem0 import Memory           # OSS 自托管
from mem0 import MemoryClient     # 云端 API

# TypeScript
import { Memory } from 'mem0ai';
```

### Mem0 REST API

```
POST   /v1/memories/        # 添加
GET    /v1/memories/search   # 语义搜索 + 过滤
PATCH  /v1/memories/batch    # 批量更新
DELETE /v1/memories/batch    # 批量删除
```
