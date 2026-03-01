# hive-exp Agent 接入设计

> **日期**: 2026-03-01
> **状态**: v1.0
> **决策**: 提醒型（Agent 自主决策），非自动注入型

---

## 0. 核心结论

**一个 MCP Server 接入所有 Agent。** 2026 年 3 月，Claude Code、Codex、Gemini CLI、Gemini Antigravity 全部支持 MCP。hive-exp 只需发布 `@hive-exp/mcp`，四个 Agent 各加一行配置即可接入。

```
                        ┌─── Claude Code  （~/.mcp.json）
                        │
@hive-exp/mcp  ◄────────┼─── Codex        （~/.codex/config.toml）
  (stdio)               │
                        ├─── Gemini CLI   （~/.gemini/mcp.json）
                        │
                        └─── Antigravity  （~/.gemini/antigravity/mcp_config.json）
```

不需要为每个 Agent 写 adapter。MCP 就是 adapter。

---

## 1. 架构：三层集成模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: 行为指导（CLAUDE.md / Codex instructions / etc.） │
│  "什么时候该用 hive-exp"                                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: MCP Server（@hive-exp/mcp）                        │
│  "怎么读写经验" — 5 个 MCP Tools                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Hook（可选增强，仅 Claude Code）                    │
│  "自动提醒" — 检测错误信号后提示 Agent 查询 hive-exp           │
└─────────────────────────────────────────────────────────────┘
```

- **Layer 2（MCP）是唯一必须的层**。Layer 1 和 3 是增强，不是前置。
- **提醒型设计**：Hook 只注入提示文本，不直接查询或修改。Agent 自主决策是否调用 MCP tool。

---

## 2. Layer 2: MCP Server 设计

### 2.1 包结构

```
packages/
└── mcp/                        # @hive-exp/mcp
    ├── src/
    │   ├── server.ts           # MCP stdio server 入口
    │   ├── tools/
    │   │   ├── query.ts        # hive_exp_query
    │   │   ├── record.ts       # hive_exp_record
    │   │   ├── outcome.ts      # hive_exp_outcome
    │   │   ├── stats.ts        # hive_exp_stats
    │   │   └── promote.ts      # hive_exp_promote
    │   └── index.ts
    ├── package.json
    └── tsconfig.json
```

MCP server 是 `@hive-exp/core` 的薄壳 — 只做 MCP 协议适配，所有逻辑在 core。

```
@hive-exp/mcp ──→ @hive-exp/core（schema + events + stats + signer）
@hive-exp/cli ──→ @hive-exp/core（同一套逻辑）
```

### 2.2 五个 MCP Tools

#### Tool 1: `hive_exp_query` — 查询匹配经验

```json
{
  "name": "hive_exp_query",
  "description": "Search for experiences matching error signals. Returns top strategies ranked by success rate and confidence. Call this when encountering build errors, test failures, or lint issues to check for known solutions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "signals": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Error signals to match (e.g. ['tsc_error', 'module_not_found']). Use signal convention names."
      },
      "scope": {
        "type": "string",
        "enum": ["universal", "language", "project"],
        "default": "universal",
        "description": "Scope filter for experience applicability"
      },
      "limit": {
        "type": "number",
        "default": 3,
        "description": "Maximum number of experiences to return"
      }
    },
    "required": ["signals"]
  }
}
```

**返回格式**：
```json
{
  "matches": [
    {
      "exp_id": "exp_1709280000_a1b2c3d4",
      "signals": ["tsc_error", "module_not_found"],
      "strategy": {
        "name": "check_tsconfig_paths",
        "description": "Check tsconfig.json paths mapping and baseUrl configuration",
        "category": "repair"
      },
      "confidence": 0.82,
      "stats": {
        "ref_count": 23,
        "success_rate": 0.87
      },
      "preconditions": ["TypeScript >= 5.0"],
      "provisional": false,
      "risk_level": "low"
    }
  ],
  "total_available": 5
}
```

#### Tool 2: `hive_exp_record` — 记录新经验

```json
{
  "name": "hive_exp_record",
  "description": "Record a new experience after successfully solving a non-trivial problem. Do NOT record trivial fixes (typos, simple config, single-line changes). The experience will be validated (minimum complexity: blast_radius.files >= 1 AND blast_radius.lines >= 5), sanitized, and signed automatically. If validation fails due to low complexity, a warning is returned but the record is still accepted in Phase 1 (soft enforcement).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "signals": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Error signals that triggered this fix"
      },
      "strategy": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Short strategy identifier (snake_case)" },
          "description": { "type": "string", "description": "What the strategy does (1-2 sentences)" },
          "category": { "type": "string", "enum": ["repair", "optimize", "innovate"] }
        },
        "required": ["name", "description", "category"]
      },
      "outcome": {
        "type": "object",
        "properties": {
          "status": { "type": "string", "enum": ["success", "failed", "partial"] },
          "evidence": { "type": "string", "description": "Path to verification log or summary" },
          "blast_radius": {
            "type": "object",
            "properties": {
              "files": { "type": "number" },
              "lines": { "type": "number" }
            }
          }
        },
        "required": ["status"]
      },
      "scope": { "type": "string", "enum": ["universal", "language", "project"], "default": "universal" },
      "preconditions": { "type": "array", "items": { "type": "string" } },
      "risk_level": { "type": "string", "enum": ["low", "medium", "high"], "default": "low" }
    },
    "required": ["signals", "strategy", "outcome"]
  }
}
```

**内部流程**：
```
输入 → schema 验证 → 复杂度检查 → signal 规范化 → 内容消毒 → 签名 → 写 experience.yaml → append event → 更新 SQLite
```

**复杂度检查（Phase 1 软执行）**：
- 条件：`blast_radius.files >= 1 AND blast_radius.lines >= 5`
- 不满足时：记录仍被接受（不拒绝），但返回 `{ "warning": "low_complexity" }`，Agent 自行决定是否继续
- 理由：Phase 1 宁可多录少漏，靠后期淘汰机制（30 天零引用自动归档）过滤低价值经验
- Phase 2+ 可改为硬执行（不满足直接拒绝）

#### Tool 3: `hive_exp_outcome` — 记录引用结果

```json
{
  "name": "hive_exp_outcome",
  "description": "Record the outcome after applying a strategy from a queried experience. Call this after attempting a fix that was informed by a hive-exp experience.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "exp_id": { "type": "string", "description": "The experience ID that was referenced" },
      "result": { "type": "string", "enum": ["success", "failed", "partial"] }
    },
    "required": ["exp_id", "result"]
  }
}
```

**内部流程**：
```
输入 → 验证 exp_id 存在 → append experience.outcome_recorded event → 更新 SQLite projection
```

#### Tool 4: `hive_exp_stats` — 查看统计

```json
{
  "name": "hive_exp_stats",
  "description": "Get strategy statistics and experience health overview.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": {
        "type": "string",
        "enum": ["overview", "strategy_ranking", "at_risk"],
        "default": "overview",
        "description": "overview: system summary. strategy_ranking: top strategies by success rate. at_risk: experiences near auto-archival."
      }
    }
  }
}
```

#### Tool 5: `hive_exp_promote` — 提议提升经验

```json
{
  "name": "hive_exp_promote",
  "description": "Propose promoting an experience to the trusted zone. This does NOT immediately promote — it sets the experience to 'pending_promotion' status. Actual promotion requires human confirmation via CLI (hive-exp promote --confirm <exp_id>) or Dashboard. Only call this when a human user explicitly agrees that an experience should be promoted.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "exp_id": { "type": "string" },
      "reason": { "type": "string", "description": "Why this experience should be promoted" }
    },
    "required": ["exp_id"]
  }
}
```

**Promote 流程说明**：

MCP Tool 是 Agent 调用的，无法发起真正的人机交互。因此 promote 分两步：

```
Agent 调用 hive_exp_promote({ exp_id, reason })
       │
       ▼
@hive-exp/mcp 写入 pending_promotion 状态 + 原因
       │
       ▼  ← 到此为止，MCP 的工作结束
       │
  人工确认（二选一）：
  ├── CLI:       hive-exp promote --confirm exp_abc123
  └── Dashboard: 点击 ✅ Promote 按钮
       │
       ▼
  experience.promoted = true
```

Agent 调用 `hive_exp_promote` 后会收到返回：`{ "status": "pending_promotion", "message": "Awaiting human confirmation via CLI or Dashboard" }`。

### 2.3 MCP Server 运行模式

**stdio 模式**（推荐，零配置）：
```bash
npx @hive-exp/mcp
```

进程由各 Agent CLI 自动管理（启动/停止），无需手动运行。

---

## 3. 各 Agent 接入配置（一行接入）

### 3.1 Claude Code

**文件**: `~/.mcp.json`（追加）

```json
{
  "mcpServers": {
    "hive-exp": {
      "command": "npx",
      "args": ["-y", "@hive-exp/mcp"]
    }
  }
}
```

### 3.2 Codex

**文件**: `~/.codex/config.toml`（追加）

```toml
[mcp_servers.hive-exp]
type = "stdio"
command = "npx"
args = ["-y", "@hive-exp/mcp"]
```

### 3.3 Gemini CLI

**文件**: `~/.gemini/mcp.json`（追加）

```json
{
  "mcpServers": {
    "hive-exp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@hive-exp/mcp"],
      "env": {}
    }
  }
}
```

### 3.4 Gemini Antigravity

**文件**: `~/.gemini/antigravity/mcp_config.json`（追加）

```json
{
  "mcpServers": {
    "hive-exp": {
      "command": "npx",
      "args": ["-y", "@hive-exp/mcp"]
    }
  }
}
```

### 3.5 Cursor / Windsurf（附赠）

如果用户使用 Cursor 或 Windsurf，同一个 MCP Server 零修改可用：

```json
// .cursor/mcp.json 或 .windsurf/mcp.json
{
  "hive-exp": {
    "command": "npx",
    "args": ["-y", "@hive-exp/mcp"]
  }
}
```

---

## 4. Layer 1: Hook 增强（可选，仅 Claude Code）

### 4.1 设计决策：提醒型

Hook **只注入一段提示文本**，不直接调用查询。Agent 自主决定是否调用 `hive_exp_query`。

理由：
- 避免噪音 — 不是每个错误都需要查经验库
- Agent 有上下文判断能力 — 知道哪些是 typo、哪些是真问题
- 保持 Agent 自主权 — 符合 hive-exp "辅助不替代" 的定位

### 4.2 Hook 配置

**文件**: `~/.claude/settings.json`（追加到 `hooks.PostToolUse`）

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "python3 ~/.hive-exp/hooks/signal-detector.py",
    "timeout": 3
  }]
}
```

### 4.3 Signal Detector 实现

```python
#!/usr/bin/env python3
"""
PostToolUse hook for Claude Code.
Detects error signals in Bash output, reminds Agent to check hive-exp.
Does NOT query hive-exp directly — Agent decides autonomously.

Signal patterns loaded from signal-conventions.yaml (not hardcoded).
"""
import json, sys, re, os
from pathlib import Path

try:
    import yaml
except ImportError:
    # PyYAML not available — fallback to inline minimal patterns
    yaml = None

def load_patterns():
    """Load signal patterns from signal-conventions.yaml. Falls back to minimal built-in set."""
    conventions_path = Path.home() / ".hive-exp" / "signal-conventions.yaml"
    if yaml and conventions_path.exists():
        with open(conventions_path) as f:
            conventions = yaml.safe_load(f)
        # conventions.signals[].detect_patterns → { signal_name: regex }
        return {
            sig["name"]: sig["detect_pattern"]
            for sig in conventions.get("signals", [])
            if "detect_pattern" in sig
        }
    # Fallback: minimal built-in patterns (kept small — full set lives in YAML)
    return {
        "tsc_error":        r"error TS\d+",
        "build_failed":     r"Build failed|ELIFECYCLE|ERR!",
        "test_failed":      r"FAIL\s+.*\.test\.|Tests:\s+\d+\s+failed",
    }

data = json.load(sys.stdin)
tool_output = str(data.get("tool_output", ""))

PATTERNS = load_patterns()
detected = [sig for sig, pat in PATTERNS.items() if re.search(pat, tool_output)]

if detected:
    hint = (
        f"[hive-exp] Detected error signals: {', '.join(detected)}. "
        f"You may call hive_exp_query with these signals to check for known solutions."
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": hint
        }
    }))
# No output if no signals detected (silent pass)
```

**Pattern 加载策略**：
- 优先从 `~/.hive-exp/signal-conventions.yaml` 读取（与 Phase 0.5 的 Signal Semantic Convention Table 共用同一数据源）
- YAML 不存在或 PyYAML 未安装时，回退到内置 3 条最基础的 pattern
- 新增 signal pattern 只需编辑 YAML 文件，无需改代码

**行为**：
- `tsc --noEmit` 失败 → hook 检测到 `tsc_error` → 注入提醒
- Agent 看到提醒 → **自主决定**是否调用 `hive_exp_query`
- 如果查到经验 → 应用策略 → 调用 `hive_exp_outcome` 记录结果

---

## 5. Layer 3: 行为指导（各 Agent 的指令文件）

### 5.1 Claude Code — CLAUDE.md 追加

```markdown
## hive-exp 经验系统

当本项目配置了 hive-exp MCP Server 时，遵循以下规则：

### 何时查询（hive_exp_query）
- 遇到构建/测试/Lint 错误且不是显而易见的 typo 时
- 收到 hook 的 [hive-exp] 提醒时
- 不确定修复策略时

### 何时记录（hive_exp_record）
- 成功解决了一个非平凡问题，且策略有通用复用价值
- 不记录：typo 修复、项目特定配置、包含敏感信息的上下文

### 何时反馈（hive_exp_outcome）
- 查询了经验并应用了推荐策略后，记录实际结果（success/failed/partial）
- 这是经验质量的核心数据源，务必记录

### 信号命名
- 使用 signal-conventions.yaml 中的规范信号名
- 不确定时查看 hive_exp_stats(type: "overview") 获取已有信号列表
```

### 5.2 Codex — instructions 追加

```markdown
## hive-exp

When hive-exp MCP is available:
- **ALWAYS** call hive_exp_query BEFORE attempting to fix build errors, test failures, or lint errors. Check known solutions first, then fix.
- After successful non-trivial fix (changed ≥2 files or ≥5 lines): call hive_exp_record
- After applying a queried strategy: ALWAYS call hive_exp_outcome with result (success/failed/partial)
```

### 5.3 Gemini — skill 或 knowledge 追加

```markdown
## hive-exp integration

hive-exp MCP tools are available for experience management:
- hive_exp_query: **ALWAYS call this first** when encountering build/test/lint errors, before attempting a fix. This checks for known solutions with proven success rates.
- hive_exp_record: save successful strategies after non-trivial fixes
- hive_exp_outcome: record whether a referenced strategy worked — this is critical for experience quality
```

### 5.4 关于 Hook 覆盖差异的说明

Claude Code 有 PostToolUse Hook（Layer 1），可以在错误发生时自动提醒 Agent 查询 hive-exp。但 Codex/Gemini/Cursor 没有等价的 Hook 机制。

**应对策略**：对无 Hook 的 Agent，**Layer 3 行为指导必须使用更强的触发语言**（"ALWAYS call... BEFORE attempting"），补偿 Hook 缺失带来的提醒缺口。Claude Code 因为有 Hook 兜底，Layer 3 指令可以相对宽松（"遇到错误时"而非"ALWAYS"）。

```
Agent 提醒强度对比：

Claude Code:  Layer 1 (Hook 自动提醒) + Layer 3 (柔性指导)  = 双保险
Codex:        Layer 3 (ALWAYS 强指令)                       = 单层但语气强
Gemini:       Layer 3 (ALWAYS 强指令)                       = 单层但语气强
Cursor:       Layer 3 (ALWAYS 强指令)                       = 单层但语气强
```

---

## 6. 完整数据流

```
Agent 遇到 tsc error
       │
       ├─── [Claude Code only] PostToolUse Hook 检测信号
       │    注入提醒: "You may call hive_exp_query..."
       │
       ▼
Agent 自主决策: 要不要查 hive-exp?
       │
       ├── 是 ──→ 调用 MCP: hive_exp_query({ signals: ["tsc_error"] })
       │          │
       │          ▼
       │   ┌─ @hive-exp/mcp ──────────────────────────┐
       │   │ 1. signal 规范化 (tsc_error → tsc_error)  │
       │   │ 2. SQLite 查询 experience_stats            │
       │   │ 3. 按 success_rate × confidence 排序       │
       │   │ 4. 返回 top-3 经验                         │
       │   └──────────────┬────────────────────────────┘
       │                  │
       │                  ▼
       │   Agent 收到 advisory:
       │   ┌────────────────────────────────────────────┐
       │   │ exp_abc123 | confidence: 0.82               │
       │   │ Strategy: check_tsconfig_paths              │
       │   │ Success rate: 87% (23 refs)                 │
       │   └────────────────────────────────────────────┘
       │                  │
       │                  ▼
       │   Agent 应用策略 → 修复 → 验证通过
       │                  │
       │                  ▼
       │   调用 MCP: hive_exp_outcome({ exp_id: "exp_abc123", result: "success" })
       │                  │
       │                  ▼
       │   ┌─ @hive-exp/mcp ──────────────────────────┐
       │   │ append event → events-2026-03.jsonl       │
       │   │ 更新 SQLite: ref_count 23→24              │
       │   │               success_count 20→21         │
       │   └──────────────────────────────────────────┘
       │
       ├── 否 ──→ Agent 自己修复
       │          │
       │          ▼
       │   修复成功 + 策略有通用价值?
       │          │
       │          ├── 是 ──→ 调用 MCP: hive_exp_record({
       │          │            signals: ["tsc_error"],
       │          │            strategy: { name: "fix_circular_import", ... },
       │          │            outcome: { status: "success", ... }
       │          │          })
       │          │          │
       │          │          ▼
       │          │   ┌─ @hive-exp/mcp ─────────────────────┐
       │          │   │ 1. schema 验证                       │
       │          │   │ 2. signal 规范化                      │
       │          │   │ 3. 内容消毒（安全 + 隐私）            │
       │          │   │ 4. HMAC 签名                         │
       │          │   │ 5. 写入 experience.yaml               │
       │          │   │ 6. append experience.created event    │
       │          │   │ 7. 更新 SQLite projection             │
       │          │   └─────────────────────────────────────┘
       │          │
       │          └── 否 ──→ 结束（typo 级修复不记录）
       │
       └── 结束
```

---

## 7. 对 convergence report 架构的影响

### 7.1 项目结构更新

```diff
  ~/workSpace/hive-exp/
  ├── packages/
- │   └── core/                  # @hive-exp/core
+ │   ├── core/                  # @hive-exp/core
+ │   └── mcp/                   # @hive-exp/mcp（MCP Server）
- ├── adapters/
- │   ├── claude-code/           # 被 MCP 替代
- │   ├── codex/                 # 被 MCP 替代
- │   └── gemini/                # 被 MCP 替代
  ├── apps/
  │   ├── cli/                   # hive-exp CLI
  │   └── dashboard/             # Web Dashboard (Phase 2)
+ ├── hooks/                     # 可选 Hook 脚本
+ │   └── signal-detector.py     # Claude Code PostToolUse hook
  └── docs/
```

**关键变化**：`adapters/` 目录可能不再需要独立的 per-agent adapter。MCP Server 就是统一 adapter。除非某个 Agent 有 MCP 之外的特殊集成需求，否则不需要写 adapter 代码。

### 7.2 Phase 划分影响

| 阶段 | 原计划 | 更新 |
|------|--------|------|
| Phase 0.5 | Core 核心库 | **不变** |
| Phase 1 | Claude Code adapter + Codex adapter + CLI | **改为**: MCP Server + CLI + Hook 脚本 |
| Phase 2 | Dashboard + Gemini adapter | **改为**: Dashboard only（Gemini 也走 MCP，无需 adapter）|

MCP 统一接入**砍掉了 3 个 adapter 的开发工作量**，Phase 1 交付时间可能从 2.5 周缩短到 2 周。

---

## 8. 与竞品的接入方式对比

| 产品 | 接入方式 | 配置复杂度 | 跨 Agent |
|------|---------|:---:|:---:|
| **Mem0 OpenMemory** | MCP Server（Docker） | 中（需要 Docker + Postgres + Qdrant） | ✅ |
| **Graphiti** | MCP Server（npm） | 低（需要 Neo4j） | ✅ |
| **Context7** | MCP Server（npm） | 极低（npx 一行） | ✅ |
| **hive-exp** | MCP Server（npm） | **极低（npx 一行，零外部依赖）** | ✅ |

hive-exp 的接入体验对标 Context7 — `npx @hive-exp/mcp` 一行启动，零外部依赖（SQLite 内嵌，无需 Docker/Postgres/Neo4j）。这是相比 Mem0 OpenMemory 的体验优势。

---

## 附录: 当前环境 MCP 配置验证

| Agent | 配置文件 | 已有 MCP Server | 验证状态 |
|-------|---------|----------------|:---:|
| Claude Code | `~/.mcp.json` | xhs, supabase | ✅ 可追加 |
| Codex | `~/.codex/config.toml` `[mcp_servers]` | playwright, Context7, XcodeBuildMCP, Figma | ✅ 可追加 |
| Gemini CLI | `~/.gemini/mcp.json` | context7, grep, playwright, specs-workflow, OpenZeppelin, xcodebuildmcp, Figma | ✅ 可追加 |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | supabase, sequential-thinking, github | ✅ 可追加 |
