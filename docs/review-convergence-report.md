# hive-exp Phase 1 Plan Review — 两轮收敛报告

> **文档类型**: 决策文档（Decision Record）
> **日期**: 2026-03-01
> **状态**: Final
> **被审对象**: Gemini 出品的 Phase 1 实施计划 (`prompt_phase1_implementation.md.resolved`)
> **审查流程**: Round 1 (两路 Opus 4.6 并行) → 主控收敛 → Round 2 (Codex MCP 独立审查) → 最终收敛

---

## 0. Executive Summary

Phase 1 实施计划的**方向基本正确，但地基有结构性缺陷**。两轮 Review（共 3 个独立审查者）在以下 5 点达成完全共识：

1. **数据模型必须冷热分离** — `usage_stats` 嵌入 YAML frontmatter 是致命错误
2. **竞品定位需要重新校准** — 从 "Git for Experiences" 转向 "跨厂商经验互操作协议"
3. **权限隔离模型需要重建** — 文件系统权限对同一 Unix 用户无效，需引入签名机制
4. **Phase 划分需要前置 Phase 0.5** — Core 核心库必须先于 Adapter 开发
5. **Task 列表存在结构性遗漏** — 至少缺 7 个关键模块的实现任务

综合评分：**5.2/10** — 方向对，执行方案需大幅修正后方可动工。

---

## 1. 审查流程

```
Phase 1 Plan (Gemini)
        │
        ▼
┌───────────────────────────────────┐
│  Round 1: 两路 Opus 4.6 并行审查   │
│                                   │
│  Reviewer-α: 架构与可行性         │
│  Reviewer-β: 产品与安全           │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│  主控收敛: 6 条必须执行的修正       │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│  Round 2: Codex MCP 独立审查       │
│  输入: 原始 Plan + Round 1 结论    │
│  输出: 10 条优先级排序的建议        │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│  最终收敛: 本文档                  │
└───────────────────────────────────┘
```

---

## 2. Round 1 — 两路 Opus 4.6 审查

### 2.1 评分对比

| 维度 | Reviewer-α (架构) | Reviewer-β (产品安全) | 综合 |
|------|:---:|:---:|:---:|
| 方向准确度 | 8/10 | 5/10 | **6/10** |
| 架构合理性 | 5/10 | 4/10 | **5/10** |
| 实施完整度 | 4/10 | — | **4/10** |
| 开源就绪度 | 3/10 | 3/10 | **3/10** |
| 安全模型 | — | 4/10 | **4/10** |
| 竞品差异化 | — | 4/10 | **4/10** |

### 2.2 Reviewer-α 关键发现（架构与可行性）

#### 🔴 致命问题 1: `usage_stats` 在 YAML frontmatter 中

**问题**：三个 Agent 可能同时引用同一条经验。Agent A 读到 `ref_count: 5`，Agent B 也读到 5，各自 +1 写回 → 最终 6 而非 7。YAML 文件没有行级锁，整个 frontmatter 是原子写入单位，后写覆盖前写的全部 frontmatter。

**更致命的是**：团队场景下 Git 仓库中，`usage_stats` 每次被引用都修改同一文件同一位置 → merge conflict 永动机。这与 "Git for Experiences" 定位直接矛盾。

**修复**：冷热分离。经验文件只存不可变本体，热数据移至独立存储。

#### 🔴 致命问题 2: `corrections` 链条不可控

**问题**：
- `corrected_from` 是单向链接，无反向索引。查找 "这条经验被纠正了吗？" 需要全目录 O(n) 扫描
- 链条长度无限制（A→B→C→D...），消费时需遍历到最新版本
- Phase 1 Task 列表中完全没有 Correction PR 工作流的实现任务 — 字段存在于 schema 但无人写入，是死代码

**修复**：限制链深度 ≤ 2，增加 `superseded_by` 反向链接，Phase 1 不实现则从 schema 移除。

#### 🔴 致命问题 3: 写权限隔离是 honor system

**问题**：所有 Agent 以同一 Unix 用户 `huluobo` 运行。文件权限无法区分同一用户的不同进程。任何 Agent 可直接写 `promoted/`。

**修复**：签名验证替代文件权限（详见修正 5）。

#### 🟡 结构性遗漏

| 研报中的关键模块 | Phase 1 Task 是否覆盖 |
|---|---|
| Memory Graph 写入工具 | 创建了文件但无写入逻辑 |
| Memory Graph 查询器 | **完全缺失** |
| Strategy Stats 聚合器 | **完全缺失** |
| Anti-Stagnation 检测 | **完全缺失** |
| verify → experience 写入 hook | **无独立任务** |
| Adapter 抽象层 | **完全缺失** |
| CLI 命令行工具 | **完全缺失** |

### 2.3 Reviewer-β 关键发现（产品与安全）

#### 🔴 竞品定位撞车 — Letta Context Repositories

**发现**：Letta 已发布 Context Repositories，核心概念是 "git-backed memory versioning for coding agents"。hive-exp 的 "Git for AI Agent Experiences" 定位高度重叠。

**建议**：放弃 "Git for" 类比。差异化路径 → **"OpenTelemetry for AI Agent Experiences"**：一个开放的经验遥测标准，而非又一个 memory platform。

> **后续第三方验证结论**：Letta 与 hive-exp 实际在不同抽象层工作。Letta 是单 Agent 记忆管理层（"海马体"），hive-exp 是跨 Agent 经验流通层（"教科书"）。**不是直接竞品，是上下游关系**。但 "Git for" 这个营销定位确实需要避开 Letta 的话术。真正需要关注的竞品是 **Mem0**（44K stars，跨 Agent 共享记忆）。

#### 🔴 `auto_promoted` 7 天回退的逻辑漏洞

**问题**：auto_promoted 经验立即进入全局信任区，其他 Agent 在 7 天内消费它。7 天后如果回退，已做出的决策无法撤回。更危险的是：有毒经验在 7 天内被引用 5 次 → ref_count=5 → 看起来更 "可信"。

**修复**：auto_promoted 经验标记为 `provisional`，不进入 `promoted/`，留在原 Agent 目录。其他 Agent 可读但标注 `[PROVISIONAL]`，ref_count 不计入信任度。

#### 🔴 Memory Graph append-only 保证是空话

**问题**：任何以 `huluobo` 用户运行的进程都可以 truncate 或覆盖 memory-graph.jsonl。

**修复**：纳入 git 版本控制 + 每 N 条 / 每 M 秒 auto-commit + 读取时校验行数单调递增。macOS 可加 `chflags sappend`。

#### 🟡 ref_count 增长机制完全未定义

**问题**：`usage_stats.ref_count` 是淘汰和排行的核心指标，但实施计划没有说明**谁在什么时候 +1**。

**建议**：
- `ref_count` +1 触发点：经验被注入 prompt（advisory context）时，由写入 advisory 的脚本负责
- `success_count / fail_count` +1 触发点：Zhukong verify 阶段，结合本次执行结果更新
- 更新操作必须原子化（file lock 或 SQLite transaction）

### 2.4 Round 1 共识（无分歧）

| # | 共识 | α 证据 | β 证据 |
|---|------|--------|--------|
| C1 | `usage_stats` 必须从 YAML frontmatter 分离 | 并发写入冲突 + Git merge conflict | ref_count 增长机制未定义 |
| C2 | 文件系统权限隔离是幻觉 | 三个 Agent 同一 Unix 用户 | 任何进程可写 promoted/ |
| C3 | Task 列表有结构性遗漏 | 缺 7 个关键模块 | 缺 ref_count 触发 + Anti-Pattern |
| C4 | 开源就绪度严重不足 | 路径硬编码、零测试、零 CLI | 深度绑定特定 Agent 工具链 |
| C5 | Dashboard 范围过大 | 8 模块中 3 个无数据源 | 砍到 P0 的 3 个模块 |
| C6 | corrections 字段是过度设计 | 单向链接无反向索引 | 单人版无 PR 审核者 |
| C7 | Observer → Experience 转化逻辑空白 | Task 3 无转化管道 | — |

### 2.5 Round 1 分歧与裁决

| # | 分歧点 | α 立场 | β 立场 | 裁决 |
|---|--------|--------|--------|------|
| D1 | 产品定位 | 方向准确 (8/10) | Letta 已做，需重新定位 (5/10) | **β 赢** — 需调研后决策 |
| D2 | usage_stats 替代方案 | SQLite (`hive-exp.db`) | 追加式 usage-log.jsonl + flock | **α 赢** — SQLite WAL 天然解决并发 |
| D3 | auto_promoted 7 天回退 | 好的折中 | 改为 provisional，不进 promoted/ | **β 赢** — 更安全 |
| D4 | Dashboard 技术选型 | Preact (3KB) | htmx + Alpine.js | **搁置** — CLI 优先 |
| D5 | Phase 划分 | 补齐 Phase 1 遗漏 | 增加 Phase 0.5 | **β 赢** — Core 先行 |
| D6 | Memory Graph append-only | JSONL rotation/compaction | chflags sappend + git auto-commit | **综合** — 两者都做 |

### 2.6 Round 1 主控收敛：6 条必须修正

**修正 1: 数据模型重构 — 冷热分离**
```
experience.yaml      → 不可变本体（signals, strategy, outcome, confidence 初始值）
                       移除 usage_stats、corrections 字段
hive-exp.db (SQLite) → WAL 模式，存 usage_log 表 + usage_stats 视图
memory-graph.jsonl   → 追加式因果链，git auto-commit
```

**修正 2: 竞品定位重审**
从 "Git for AI Agent Experiences" 转向 "跨厂商 Agent 经验互操作协议"（类比 OpenTelemetry）。需深度调研 Letta/Mem0/LangMem 后做最终定位决策。

**修正 3: Phase 重新划分**

| 阶段 | 内容 | 时间 |
|------|------|------|
| Phase 0.5 | Core 核心库（schema validator + sanitizer + memory-graph lib + stats aggregator）+ npm 包 | 1 周 |
| Phase 1 | Claude Code adapter + Codex adapter + CLI 工具 | 2 周 |
| Phase 2 | Dashboard (P0 3 模块) + Gemini adapter + 跨 Agent 共识 + 衰减 cron | 3 周 |
| Phase 3 | 开源发布 + 社区 + 第三方 Adapter 开发指南 | 2 周 |

**修正 4: auto_promoted → provisional 机制**
auto_promoted 经验不进入 `promoted/`，留在原 Agent 目录添加 `provisional: true` + `cross_agent_consensus: true`。其他 Agent 可读但标注 `[PROVISIONAL]`。7 天后未人工确认 → 回退。provisional 期间 ref_count 不计入信任度。

**修正 5: 权限模型 — 签名验证**
每个 Agent 写入时附带 HMAC-SHA256 签名（密钥存各 Agent config），读取时验证。promoted/ 写入需通过 `hive-exp promote` CLI 并验证人工交互。

**修正 6: Core/Adapter 分层架构**
```
hive-exp/
├── packages/
│   └── core/              # @hive-exp/core — Agent 无关
│       ├── schema/        # JSON Schema + validator
│       ├── memory-graph/  # JSONL 读写 + 查询
│       ├── sanitizer/     # 内容消毒
│       ├── stats/         # Strategy stats (SQLite)
│       └── types/         # TypeScript 类型定义
├── adapters/
│   ├── claude-code/
│   ├── codex/
│   └── gemini/
├── apps/
│   ├── cli/               # CLI 工具
│   └── dashboard/         # Web UI (Phase 2)
└── docs/
```

---

## 3. Round 2 — Codex MCP 独立审查

Codex 在 Round 1 收敛的 6 条修正基础上，做了独立复审。以下是其**增量发现**（与 Round 1 不重复的部分）。

### 3.1 两个关键升级

#### 升级 1: events.jsonl 必须是唯一可变真相源（Single Source of Truth）

**Round 1 方案**：三层存储（experience.yaml + hive-exp.db + memory-graph.jsonl）各自是某类数据的 source of truth。

**Codex 挑战**：三层存储 = 三个版本的真相，早晚出分歧。

**Codex 修正**：
```
events.jsonl  →  唯一可变的 source of truth（所有写操作 append here）
hive-exp.db   →  projection cache（从 events.jsonl 重建，可删可重建）
experience/   →  immutable snapshots（创建后不再修改）
```

这本质上是 **Event Sourcing** 架构：任何状态都可以从 events.jsonl 重放得出。SQLite 只是加速查询的缓存层，不持有独立真相。

**主控评估**：✅ 接受。这比 Round 1 的方案更干净。events.jsonl 是 append-only log，SQLite 是 materialized view，experience.yaml 是 immutable snapshot。任何时候删掉 SQLite，从 events.jsonl 重建即可。

> **⚠️ 补充（第三方 Review 指出的遗漏）**：events.jsonl 作为唯一真相源，其 event schema 必须在 Phase 0.5 中明确定义。详见本文 §4.5 Event Schema 定义 和 §4.6 SQLite Projection 重建逻辑。

#### 升级 2: 签名方案从 HMAC-SHA256 升级到 Ed25519

**Round 1 方案**：HMAC-SHA256（对称密钥，所有 Agent 共享 secret）。

**Codex 挑战**：HMAC 是对称密钥方案。团队场景下，共享 secret 意味着任何人都能以任何 Agent 身份伪造签名。无法实现 "谁写了这条经验" 的不可否认性。

**Codex 修正**：
```
Phase 0.5: HMAC-SHA256（单人场景够用，零依赖）
Phase 1+:  Ed25519（非对称密钥，每个 Agent/用户一对密钥）
```

**主控评估**：✅ 接受方向，但调整节奏。Phase 0.5 的签名接口设计为可插拔（`SignerInterface`），HMAC 作为默认实现。Ed25519 作为 Phase 1 的可选升级，不阻塞 Phase 0.5 交付。

> **⚠️ 设计约束**：`SignerInterface` 必须足够抽象 — 接口只暴露 `sign(payload): signature` 和 `verify(payload, signature): boolean`，不能泄露 HMAC 的实现细节（如 `secret` 参数不应出现在接口层）。密钥管理策略（对称 vs 非对称）完全封装在具体实现内部。

### 3.2 五个新增 Schema 字段

Codex 建议在 experience record 中新增以下字段（Round 1 未涉及）：

| 字段 | 类型 | 用途 |
|------|------|------|
| `scope` | string | 经验适用范围（`project` / `language` / `universal`），防止项目特定经验污染全局 |
| `preconditions` | string[] | 经验生效的前提条件（如 "TypeScript 5.x"、"monorepo 结构"），减少误用 |
| `evidence_digest` | string (SHA-256) | 验证日志的摘要哈希，防止事后篡改证据 |
| `supersedes` | string (exp_id) | 替代关系的反向链接（解决 Round 1 的 corrections 单向链接问题） |
| `risk_level` | enum | `low` / `medium` / `high`，消费经验时的风险提示 |

**主控评估**：
- `scope` ✅ 接受 — 解决经验适用范围问题，是真需求
- `preconditions` ✅ 接受 — 减少误用，成本低
- `evidence_digest` ✅ 接受 — 审计需要，SHA-256 计算成本可忽略
- `supersedes` ✅ 接受 — 正好解决 Round 1 的 corrections 单向链接问题
- `risk_level` ⚠️ 降级为可选 — 大多数经验是 low risk，强制填写是无意义负担

### 3.3 四个新发现的风险

#### 风险 1: Signal 语义漂移

**问题**：不同 Agent 对同一类错误的命名不一致。Claude Code 可能记录 `tsc_error`，Codex 记录 `typescript_compilation_failed`，Gemini 记录 `build_error_ts`。三条经验本质上解决同一问题，但信号名不同 → 无法匹配 → 跨 Agent 共识失效。

**建议**：建立 **Signal Semantic Convention Table**（类比 OpenTelemetry 的 Semantic Conventions），预定义常见信号的规范名称。Adapter 层负责将各 Agent 的原始信号映射到规范信号。

**主控评估**：✅ 关键发现。这是跨厂商互操作的核心挑战。**Signal Semantic Convention Table 必须在 Phase 0.5 交付**（而非仅"预埋接口"），否则 Phase 1 的 adapter 写出的信号名是自由格式，后续补规范等于全量重构。至少需要交付：常见信号的规范名列表（v0.1，覆盖 top 20 常见错误类型）+ adapter 层的 signal normalization 接口。

#### 风险 2: 缺乏离线回放评估基准

**问题**：系统声称 "策略推荐能提高成功率"，但没有评估机制证明这一点。需要一个 benchmark：用历史 run 数据回放，对比 "有策略推荐" vs "无策略推荐" 的成功率差异。

**主控评估**：✅ 有价值，但优先级放在 Phase 2。Phase 0.5/1 先跑起来积累数据。

#### 风险 3: 合规边界不清

**问题**：经验中可能包含代码片段、文件路径、错误堆栈 — 团队共享场景下有 IP/隐私风险。消毒规则目前只过滤恶意代码（exec/eval/rm -rf），不过滤敏感信息（API keys、内部路径、proprietary code patterns）。

**主控评估**：✅ 接受。消毒规则需要分两层：
1. **安全消毒**（Phase 0.5）：过滤恶意代码注入
2. **隐私消毒**（Phase 1）：过滤 API keys、绝对路径、敏感文件名

#### 风险 4: 安全边缘案例

Codex 补充发现了以下 Round 1 未提及的安全风险：
- **Symlink/路径穿越**：experience.yaml 中的 `evidence` 路径可能是 symlink，指向系统敏感文件
- **Sanitizer 绕过**：Unicode 变体字符（如全角 `ｅｖａｌ`）可能绕过正则消毒
- **Git auto-commit 泄露**：自动 commit 可能将敏感数据写入 git 历史
- **JSONL 无限增长**：无 rotation/compaction → 磁盘 DoS

**主控评估**：✅ 全部接受，纳入 Phase 0.5 的 sanitizer 和 validator 实现中。

### 3.4 时间线校准

| 阶段 | Round 1 估时 | Codex 估时 | 最终估时 |
|------|:---:|:---:|:---:|
| Phase 0.5 | 1 周 | 1-1.5 周 | **1.5 周** |
| Phase 1 | 2 周 | 2.5-3 周 | **2.5 周** |
| Phase 2 | 3 周 | 3-4 周 | **3 周** |
| Phase 3 | 2 周 | 1.5-2 周 | **2 周** |
| **总计** | **8 周** | **8-10.5 周** | **9 周** |

### 3.5 Codex 的 10 条优先级排序建议

| 优先级 | 建议 | 主控裁决 |
|:---:|------|:---:|
| P0 | events.jsonl 作为唯一可变真相源，SQLite 仅为 projection | ✅ 接受 |
| P0 | 新增 5 个 schema 字段（scope, preconditions, evidence_digest, supersedes, risk_level） | ✅ 接受（risk_level 降为可选） |
| P0 | 签名方案升级路径：HMAC → Ed25519（接口可插拔） | ✅ 接受 |
| P1 | provisional 经验默认 opt-out（不主动推荐） | ✅ 接受 |
| P1 | Phase 0.5 扩展到 1.5 周，含 conformance test suite | ✅ 接受 |
| P1 | 重新定位为 "auditable experience interoperability spec" | ⚠️ 方向接受，具体 slogan 待竞品分析后确定 |
| P2 | CLI 优先于 Dashboard（validate/sign/query/promote/replay） | ✅ 接受 |
| P2 | 建立 Signal Semantic Convention Table | ✅ 接受，Phase 0.5 预埋接口 |
| P2 | 离线回放评估 benchmark | ⚠️ 接受方向，Phase 2 实施 |
| P3 | spec/core/adapter 包分离 + 版本兼容规则 | ✅ 接受 |

---

## 4. 最终收敛：修正后的 Phase 1 计划骨架

### 4.1 修正后的数据架构

```
~/.agents/shared-knowledge/
│
├── experiences/                     # 不可变经验快照
│   ├── claude-code/                 # 按 source_agent 分目录
│   │   └── exp_1709280000_a1b2c3d4.yaml
│   ├── codex/
│   └── gemini/
│
├── events/                          # 唯一可变真相源（append-only）
│   ├── events-2026-03.jsonl         # 按月分文件（rotation 策略）
│   ├── events-2026-04.jsonl         # 新月份自动创建
│   └── ...                          # 详见 §4.5 Event Schema + §4.7 Rotation 策略
│
├── hive-exp.db                      # SQLite WAL — projection cache（可从 events.jsonl 重建）
│                                    # 表：usage_log, experience_stats, strategy_stats
│
├── memory-graph.jsonl               # 因果链（signal→strategy→outcome）
│                                    # git auto-commit，chflags sappend
│
├── promoted/                        # 信任区（仅通过 CLI `hive-exp promote` 写入）
│   ├── experiences/                 # 人工确认后的经验副本
│   └── skills/                      # 推广的共享 skill
│
├── quarantine/                      # 可疑经验隔离区
├── archived/                        # 归档区（淘汰经验，保留不删除）
│
├── config.yaml                      # 全局配置
├── signal-conventions.yaml          # Signal 语义规范表（Phase 0.5）
└── .keys/                           # Agent 签名密钥（.gitignore）
    ├── claude-code.key
    ├── codex.key
    └── gemini.key
```

### 4.2 修正后的 Experience Record Schema

```yaml
---
id: "exp_{timestamp}_{hash8}"
type: experience
schema_version: "1.1.0"                    # 升级版本号

# === 触发信号 ===
signals:
  - "tsc_error"                            # 必须使用 signal-conventions.yaml 中的规范名
  - "errsig:Cannot find module './utils'"

# === 适用范围 ===                          # [NEW] Codex Round 2
scope: "universal"                          # project | language | universal
preconditions:                              # [NEW] Codex Round 2
  - "TypeScript >= 5.0"
  - "Node.js >= 18"

# === 使用策略 ===
strategy:
  name: "add_missing_import"
  description: "检查并添加缺失的 import 语句"
  category: "repair"                        # repair | optimize | innovate

# === 执行结果 ===
outcome:
  status: "success"                         # success | failed | partial
  evidence: ".artifacts/agent_runs/RUN_ID/verify.log"
  evidence_digest: "sha256:a1b2c3..."       # [NEW] Codex Round 2 — 防篡改
  blast_radius:
    files: 2
    lines: 15

# === 信任管理 ===
confidence: 0.5
source_agent: "codex"
signature: "hmac-sha256:..."                # [NEW] Round 1 修正 5 — 可插拔签名
validated_by: null
promoted: false
provisional: false                          # [CHANGED] 替代 auto_promoted
provisional_deadline: null                  # provisional=true 时，7天后截止

# === 替代关系 ===                          # [CHANGED] 替代 corrections
supersedes: null                            # 本经验替代的旧经验 ID
superseded_by: null                         # 替代本经验的新经验 ID（反向链接）

# === 风险标记 ===                          # [NEW] Codex Round 2
risk_level: "low"                           # low | medium | high（可选字段）

# === 时间管理 ===
created: "2026-03-01T10:00:00Z"
last_confirmed: "2026-03-01T10:00:00Z"
decay_halflife_days: 30
archived: false
archived_reason: null                       # zero_ref | low_confidence | consecutive_fail
---
# Experience Body (Markdown)
```

**被移除的字段**（相比原始计划）：
- ~~`usage_stats`~~ → 移至 events.jsonl + SQLite projection
- ~~`corrections`~~ → 替换为 `supersedes` / `superseded_by`
- ~~`auto_promoted`~~ → 替换为 `provisional`
- ~~`auto_promote_deadline`~~ → 替换为 `provisional_deadline`

**新增的字段**：
- `scope` — 适用范围
- `preconditions` — 生效前提
- `evidence_digest` — 证据哈希
- `supersedes` / `superseded_by` — 双向替代链接
- `risk_level` — 风险标记（可选）
- `signature` — Agent 签名

### 4.5 Event Schema 定义（第三方 Review 补充）

> **背景**：events.jsonl 被定义为"唯一可变真相源"，但原始报告从未定义 event 的 JSON 格式。这是 Phase 0.5 必须交付的核心 schema。

#### 通用 Event Envelope

```json
{
  "event_id": "evt_1709280000_f3a7b2c1",
  "type": "experience.referenced",
  "timestamp": "2026-03-01T10:05:00Z",
  "source_agent": "codex",
  "signature": "hmac-sha256:...",
  "payload": { ... }
}
```

所有 event 共享 envelope 字段：`event_id`（全局唯一）、`type`（事件类型）、`timestamp`（ISO 8601）、`source_agent`（写入者）、`signature`（可插拔签名）。`payload` 根据 `type` 不同而不同。

#### Event Type 完整列表

| type | 触发时机 | payload 结构 |
|------|---------|-------------|
| `experience.created` | 新经验写入 | `{ exp_id, initial_confidence }` |
| `experience.referenced` | 经验被注入 Agent prompt | `{ exp_id, context_summary }` |
| `experience.outcome_recorded` | 引用后记录结果 | `{ exp_id, ref_event_id, result: "success"\|"failed"\|"partial" }` |
| `experience.promoted` | 人工确认提升到信任区 | `{ exp_id, promoted_by: "human" }` |
| `experience.provisional` | 跨 Agent 共识触发临时提升 | `{ exp_id, consensus_agents: ["claude-code","codex"], deadline }` |
| `experience.provisional_expired` | provisional 7 天到期未确认 | `{ exp_id }` |
| `experience.archived` | 自动淘汰触发 | `{ exp_id, reason: "zero_ref"\|"low_confidence"\|"consecutive_fail" }` |
| `experience.quarantined` | 人工/自动隔离 | `{ exp_id, reason }` |
| `experience.superseded` | 新经验替代旧经验 | `{ old_exp_id, new_exp_id, reason }` |
| `confidence.decayed` | 定时衰减批量处理 | `{ affected_exp_ids: [...], decay_factor }` |
| `strategy.banned` | 策略被禁用 | `{ strategy_name, reason, banned_by }` |

#### Event Payload 示例

```json
// experience.referenced
{
  "event_id": "evt_1709280300_a1b2c3d4",
  "type": "experience.referenced",
  "timestamp": "2026-03-01T10:05:00Z",
  "source_agent": "codex",
  "signature": "hmac-sha256:e3b0c44298fc1...",
  "payload": {
    "exp_id": "exp_1709280000_f3a7b2c1",
    "context_summary": "Codex encountered tsc_error in src/utils.ts, injected experience as advisory"
  }
}

// experience.outcome_recorded
{
  "event_id": "evt_1709280600_d4e5f6a7",
  "type": "experience.outcome_recorded",
  "timestamp": "2026-03-01T10:10:00Z",
  "source_agent": "codex",
  "signature": "hmac-sha256:7f83b1657ff1...",
  "payload": {
    "exp_id": "exp_1709280000_f3a7b2c1",
    "ref_event_id": "evt_1709280300_a1b2c3d4",
    "result": "success"
  }
}
```

### 4.6 SQLite Projection 重建逻辑（第三方 Review 补充）

> **原则**：SQLite 是 events 的 materialized view。`hive-exp replay` 命令扫描所有 `events/*.jsonl`，按 timestamp 顺序逐条处理，重建以下三张表。

#### 表结构

```sql
-- 引用日志（每条 referenced + outcome 事件生成一行）
CREATE TABLE usage_log (
  event_id      TEXT PRIMARY KEY,
  exp_id        TEXT NOT NULL,
  source_agent  TEXT NOT NULL,
  result        TEXT,             -- NULL(仅 referenced) / success / failed / partial
  ref_event_id  TEXT,             -- outcome 关联的 referenced event
  timestamp     TEXT NOT NULL
);

-- 经验统计（聚合视图，按 exp_id 汇总）
CREATE VIEW experience_stats AS
SELECT
  exp_id,
  COUNT(*)                                          AS ref_count,
  COUNT(CASE WHEN result = 'success' THEN 1 END)   AS success_count,
  COUNT(CASE WHEN result = 'failed'  THEN 1 END)   AS fail_count,
  ROUND(
    CAST(COUNT(CASE WHEN result = 'success' THEN 1 END) AS REAL) /
    NULLIF(COUNT(CASE WHEN result IS NOT NULL THEN 1 END), 0),
    4
  )                                                 AS success_rate,
  MAX(timestamp)                                    AS last_used,
  json_group_array(DISTINCT source_agent)           AS used_by_agents
FROM usage_log
GROUP BY exp_id;

-- 策略统计（聚合视图，按 strategy_name 汇总）
-- 需要 JOIN experience.yaml 的 strategy.name（通过 exp_id 关联）
CREATE TABLE experience_meta (
  exp_id          TEXT PRIMARY KEY,
  strategy_name   TEXT NOT NULL,
  strategy_category TEXT,          -- repair / optimize / innovate
  created         TEXT NOT NULL,
  archived        INTEGER DEFAULT 0,
  archived_reason TEXT
);

CREATE VIEW strategy_stats AS
SELECT
  em.strategy_name,
  em.strategy_category,
  COUNT(ul.event_id)                                AS total_refs,
  COUNT(CASE WHEN ul.result = 'success' THEN 1 END) AS successes,
  COUNT(CASE WHEN ul.result = 'failed'  THEN 1 END) AS failures,
  ROUND(
    CAST(COUNT(CASE WHEN ul.result = 'success' THEN 1 END) AS REAL) /
    NULLIF(COUNT(CASE WHEN ul.result IS NOT NULL THEN 1 END), 0),
    4
  )                                                  AS success_rate
FROM experience_meta em
LEFT JOIN usage_log ul ON em.exp_id = ul.exp_id
GROUP BY em.strategy_name;
```

#### Replay 映射规则（event type → SQL 操作）

| event type | SQL 操作 |
|-----------|---------|
| `experience.created` | `INSERT INTO experience_meta (exp_id, strategy_name, ...)` |
| `experience.referenced` | `INSERT INTO usage_log (event_id, exp_id, source_agent, result=NULL, ...)` |
| `experience.outcome_recorded` | `UPDATE usage_log SET result=payload.result WHERE event_id=payload.ref_event_id` |
| `experience.promoted` | `UPDATE experience_meta SET promoted=1 WHERE exp_id=...` |
| `experience.archived` | `UPDATE experience_meta SET archived=1, archived_reason=... WHERE exp_id=...` |
| `experience.superseded` | `UPDATE experience_meta SET superseded_by=new_exp_id WHERE exp_id=old_exp_id` |
| `confidence.decayed` | 不写 SQLite（confidence 实时计算：`initial_confidence * 2^(-age_days/halflife)`）|
| `strategy.banned` | `INSERT INTO banned_strategies (strategy_name, reason, ...)` |

#### Replay 幂等性保证

- 每条 event 的 `event_id` 是全局唯一的
- Replay 前 `DROP` 所有表再重建（或 `INSERT OR IGNORE` 保证幂等）
- 重建后验证：`SELECT COUNT(*) FROM usage_log` 应等于 events 文件中 `experience.referenced` + `experience.outcome_recorded` 的总行数

### 4.7 events.jsonl Rotation 策略（第三方 Review 补充）

> **问题**：单个 events.jsonl 无限增长 → 磁盘 DoS + 查询性能退化。

#### 策略：按月分文件

```
events/
├── events-2026-03.jsonl    # 3 月的所有事件
├── events-2026-04.jsonl    # 4 月自动创建
└── ...
```

- **写入**：`writer.ts` 根据当前月份决定写入哪个文件
- **读取/replay**：`reader.ts` 按文件名排序，依次读取所有 `.jsonl` 文件
- **查询**：`projector.ts` 在 SQLite 重建时扫描全部文件；日常查询走 SQLite，不直接读 JSONL
- **归档**：超过 6 个月的 JSONL 文件可 gzip 压缩（`events-2026-03.jsonl.gz`），replay 时自动解压
- **命名规则**：`events-{YYYY}-{MM}.jsonl`，严格 ISO 8601 月份格式

#### Phase 0.5 交付要求

- [ ] `EventWriter` 自动按月创建新文件
- [ ] `EventReader` 可顺序读取多个 JSONL 文件（含 .gz）
- [ ] `Projector` 的 `replay()` 方法支持增量重建（记录上次处理到的 event_id，只处理新增事件）

### 4.3 修正后的 Phase 划分

#### Phase 0.5: Core 核心库（1.5 周）

```
@hive-exp/core
├── schema/
│   ├── experience.schema.json       # JSON Schema 定义
│   ├── validator.ts                 # 写入时 schema 验证
│   └── signal-conventions.ts        # Signal 规范名映射
├── sanitizer/
│   ├── security.ts                  # 安全消毒（exec/eval/rm -rf/Unicode变体）
│   └── privacy.ts                   # 隐私消毒（API keys/绝对路径）
├── events/
│   ├── writer.ts                    # append-only 写入 + flock
│   ├── reader.ts                    # 读取 + 行数校验
│   └── projector.ts                 # events.jsonl → SQLite 投影
├── memory-graph/
│   ├── writer.ts                    # 因果链追加
│   └── query.ts                     # 按 signal/strategy/agent 查询
├── stats/
│   ├── aggregator.ts                # Strategy stats 聚合
│   └── decay.ts                     # Confidence 衰减计算
├── signer/
│   ├── interface.ts                 # SignerInterface（可插拔）
│   └── hmac.ts                      # HMAC-SHA256 默认实现
├── types/
│   └── index.ts                     # 所有 TypeScript 类型
└── __tests__/
    └── conformance/                 # MCP conformance test suite
```

交付标准：
- [ ] `npm test` 全量通过
- [ ] schema validator 覆盖所有必填字段 + 类型检查（experience record + event record）
- [ ] sanitizer 覆盖 OWASP top 10 注入模式 + Unicode 变体
- [ ] events projector 可从 events/*.jsonl 完整重建 SQLite（删除 hive-exp.db 后执行 `hive-exp replay`，所有 stats 恢复）
- [ ] conformance test suite 可供 MCP tool 开发者使用
- [ ] Signal Semantic Convention Table v0.1 交付（覆盖 top 20 常见错误信号的规范名 + MCP 层 signal normalization 接口）
- [ ] SignerInterface 接口不暴露任何 HMAC 实现细节（接口审查通过）
- [ ] events.jsonl rotation 策略实现（按月分文件，跨文件查询正常）

#### Phase 1: MCP Server + CLI + Hook（2 周）

> **架构变更**：2026 年 3 月，Claude Code、Codex、Gemini CLI、Gemini Antigravity 全部支持 MCP。不再需要 per-agent adapter，一个 `@hive-exp/mcp` 统一接入。详见 [`agent-integration-design.md`](./agent-integration-design.md)。

```
packages/mcp/                        # @hive-exp/mcp（MCP stdio server）
├── src/
│   ├── server.ts                   # MCP stdio server 入口
│   ├── tools/
│   │   ├── query.ts               # hive_exp_query — 查询匹配经验
│   │   ├── record.ts              # hive_exp_record — 记录新经验
│   │   ├── outcome.ts             # hive_exp_outcome — 记录引用结果
│   │   ├── stats.ts               # hive_exp_stats — 查看统计
│   │   └── promote.ts             # hive_exp_promote — 提升经验
│   └── index.ts
├── package.json
└── tsconfig.json

hooks/
└── signal-detector.py               # Claude Code PostToolUse hook（提醒型，可选）

apps/cli/
└── hive-exp                         # CLI 命令
    ├── init                         # 初始化目录结构 + 生成密钥
    ├── add                          # 手动添加经验
    ├── validate                     # 验证经验文件
    ├── sign                         # 签名/验签
    ├── query                        # 查询经验（按 signal/strategy/agent）
    ├── promote                      # 提升到信任区（需人工确认）
    ├── archive                      # 手动归档
    ├── stats                        # 查看策略统计
    └── replay                       # 从 events.jsonl 重建 SQLite
```

MCP Server 是 `@hive-exp/core` 的薄壳 — 只做 MCP 协议适配，所有逻辑在 core：
```
@hive-exp/mcp ──→ @hive-exp/core（schema + events + stats + signer）
@hive-exp/cli ──→ @hive-exp/core（同一套逻辑）
```

#### Phase 2: Dashboard + 高级功能（3 周）

Dashboard P0 模块（仅 3 个）：
1. 系统总览 — 各 Agent 状态 + 经验数量 + 待审核 badge
2. 经验审核台 — 按 Agent 分组 + promote/quarantine 操作
3. 审计日志 — memory-graph.jsonl 实时流

Dashboard P1 模块（视资源追加）：
4. 策略统计面板
5. 经验排行榜

其他 Phase 2 工作：
- 跨 Agent 共识检测
- Confidence 衰减 cron
- 三条自动淘汰规则实施

#### Phase 3: 开源发布（2 周）

- README + Contributing Guide + MCP Tool 开发指南
- npm 发布 @hive-exp/core + @hive-exp/mcp
- GitHub Actions CI
- 社区模板（Issue/PR template）

### 4.4 修正后的项目结构

```
~/workSpace/hive-exp/
├── packages/
│   ├── core/                        # @hive-exp/core（npm 包）
│   └── mcp/                         # @hive-exp/mcp（MCP Server）
├── hooks/
│   └── signal-detector.py          # Claude Code PostToolUse hook（可选）
├── apps/
│   ├── cli/                         # hive-exp CLI
│   └── dashboard/                   # Web Dashboard (Phase 2)
├── docs/
│   ├── review-convergence-report.md # 本文档
│   ├── signal-conventions.md        # Signal 语义规范
│   ├── agent-integration-design.md  # Agent 接入设计（MCP 统一架构）
│   └── mcp-tool-guide.md           # MCP Tool 开发指南
├── specs/                           # 需求与设计文档
├── package.json                     # monorepo root
├── turbo.json                       # Turborepo 配置（或 pnpm workspace）
├── LICENSE                          # MIT
└── README.md
```

---

## 5. 竞品定位矩阵（已完成深度分析）

> 完整竞品分析详见 [`competitive-analysis.md`](./competitive-analysis.md)

### 5.1 市场地图

```
             记忆（What was said）               经验（What worked）
             ─────────────────                   ─────────────────
                  │                                    │
  云端 API   Mem0 (48K★,$24M) ─────────────┐          │
  ─────────  Zep Cloud                     │          │  ← 空白地带
             Cognee (12K★,$7.5M)           │          │     无直接竞品
                  │                        │          │
  开源框架   Letta (16K★)                  │     hive-exp ← 我们在这里
  ─────────  LangMem                       │          │
             Graphiti (20K★)               │          │
                  │                        │          │
  IDE 内置   Cursor Memories               │          │
  ─────────  Windsurf Memories             │          │
                  │                        │          │
                  └──── 全部在抢这个赛道 ───┘          │
```

### 5.2 关键竞品关系定性（已验证）

| 竞品 | 关系 | 核心区别 | 证据 |
|------|------|---------|------|
| **Mem0** (48K★) | **邻居，非竞品** | Mem0 存"用户说了什么"（对话事实），hive-exp 存"什么方法管用"（结构化经验）。Mem0 质量靠 LLM 猜（准确率 53%），hive-exp 靠 outcome 数据证明。 | Mem0 无 outcome tracking、无 confidence decay、无人工审核 |
| **Letta** (16K★) | **上下游** | Letta 管单 Agent 上下文状态（海马体），hive-exp 管跨 Agent 解题经验（教科书）。hive-exp 可作为 Letta archival memory 的数据源。 | 第三方调研确认不同层，Context Repositories 是文件级记忆非结构化经验 |
| **Zep/Graphiti** (20K★) | **潜在底层依赖** | Graphiti 是时序知识图谱原语，hive-exp 未来可用作 Memory Graph 后端。但 Phase 0.5-1 用 JSONL+SQLite 够了。 | Graphiti MCP 1.0 生态成熟 |
| **LangMem** | **部分重叠** | Procedural Memory 概念接近，但深度绑定 LangGraph 生态且 P50 延迟 18s，生产不可用。 | 无跨厂商支持，无 TypeScript SDK |
| **Cursor/Windsurf** | **完全不同层** | 本质是自动生成的 `.cursorrules` 文本文件。无 schema、无验证、单 IDE 锁定。 | prompt injection with marketing |

### 5.3 hive-exp 的差异化空间

所有 6 个竞品在以下两个维度上均为 ❌：

| 能力 | Mem0 | Letta | Zep | LangMem | Cursor/WS | **hive-exp** |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **结果追踪**（outcome tracking） | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| **人工审核**（promote flow） | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |

### 5.4 确认定位

> **"The experience protocol for AI agents"**
> — 不是 memory platform，是 experience protocol。

**差异化叙事（三句话）**：
1. Mem0 记住用户说了什么 → hive-exp 记住什么方法管用
2. Cursor 的经验锁在 Cursor 里 → hive-exp 的经验可以流通到任何 Agent
3. 所有竞品的记忆质量靠 LLM 猜 → hive-exp 的经验质量靠 outcome 数据证明

**类比**：OpenTelemetry 解决了可观测性数据的跨厂商互操作，hive-exp 解决解题经验的跨 Agent 互操作。

### 5.5 最大风险

Mem0（48K★ + $24M 融资 + AWS 合作）如果决定增加 "structured experience" 类型 + outcome tracking，可以在 3-6 个月内做出类似功能。

**防御策略**：协议标准化 + 厂商中立。Mem0 做的是自己平台的功能，hive-exp 做的是跨平台的开放标准。设计 `@hive-exp/adapter-mem0` 接口（Phase 1 定义 interface，不实现），表明互补而非竞争姿态。

---

## 6. 遗留问题（需后续决策）

| # | 问题 | 状态 | 决策时机 | 依赖 |
|---|------|------|---------|------|
| ~~O1~~ | ~~最终产品 slogan~~ | ✅ **已决** | — | "The experience protocol for AI agents" |
| O2 | Python SDK 优先级 | 待定 | Phase 1 | 社区反馈 + Codex 建议（"Python SDK needed early"） |
| O3 | Ed25519 引入时机 | 待定 | Phase 1 中期 | 单人 vs 团队场景需求验证 |
| O4 | Adaptive Risk Control 参数 | 待定 | Phase 2 | Memory Graph 数据积累量 |
| O5 | RAG 集成具体方案 | 待定 | Phase 2 | RAG endpoint 选型 |
| O6 | Letta MCP 集成需求 | 待定 | Phase 3 | Letta 社区接口稳定性 |
| O7 | Mem0 互操作接口定义 | 待定 | Phase 1 | 互补姿态验证（仅定义 interface，不实现） |

---

## 附录 A: 审查者信息

| 角色 | 模型 | 审查重点 |
|------|------|---------|
| Reviewer-α | Claude Opus 4.6 | 架构合理性、数据模型、技术可行性 |
| Reviewer-β | Claude Opus 4.6 | 产品定位、安全模型、竞品差异化 |
| Codex Reviewer | GPT-5.3-Codex | 独立复审、增量发现、时间线校准 |
| 主控 Controller | Claude Opus 4.6 | 收敛分歧、裁决优先级、最终方案确认 |

## 附录 B: 相关文件索引

| 文件 | 路径 |
|------|------|
| 可行性研报 | `~/workSpace/evolver_feasibility_report.md` |
| 原始 Phase 1 计划 | `~/.gemini/antigravity/brain/27cff12f-285d-4486-80c1-c1443d6608be/prompt_phase1_implementation.md.resolved` |
| 本收敛报告 | `~/workSpace/hive-exp/docs/review-convergence-report.md` |
| 竞品分析（待产出） | `~/workSpace/hive-exp/docs/competitive-analysis.md` |
