# hive-exp

**AI Agent 经验管理系统** — 结构化、跨 Agent、人机协同审核的 AI 工具知识库。

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

[![npm](https://img.shields.io/npm/v/hive-exp)](https://www.npmjs.com/package/hive-exp)
[![CI](https://img.shields.io/github/actions/workflow/status/hive-exp/hive-exp/ci.yml)](https://github.com/hive-exp/hive-exp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## hive-exp 是什么？

当 AI Agent 解决了一个复杂问题——TypeScript 编译报错、构建失败、测试不通过——解决方案在会话结束时就消失了。下次遇到同样的错误（不同项目、不同 Agent、甚至同一个 Agent 的第二天），一切又从零开始。hive-exp 通过记录**经验**来解决这个问题：以 `信号 → 策略 → 结果` 的标准结构，持久化存储在本地，毫秒级可查。

知识不会被锁在单个 Agent 里。因为 hive-exp 使用 MCP（Model Context Protocol）协议，Claude Code、Codex、Gemini CLI、Cursor、Windsurf 都能读写同一个经验库。Claude Code 修复 TypeScript 路径别名问题时录入的经验，Codex 下次遇到相同信号时立即可用。经验库是共享大脑，不是每个 Agent 的临时便签。

人类始终在回路中。经验以*待审核*状态录入，只有通过人类在 CLI 或 Dashboard 上的明确操作才能*晋升*到信任区。置信度按指数半衰期衰减；连续失败或 30 天零引用的经验会被自动归档。Dashboard 实时展示每条经验的当前置信度和使用统计。

## 快速开始

```bash
# 全局安装 CLI
npm install -g hive-exp

# 为 AI Agent 初始化（自动检测已安装的 Agent）
hive-exp init --force

# 或直接启动 MCP Server
npx @hive-exp/mcp
```

## Agent 配置

`hive-exp init --force` 会自动写入配置。手动配置方式如下：

### Claude Code — `~/.mcp.json`

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

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.hive-exp]
type = "stdio"
command = "npx"
args = ["-y", "@hive-exp/mcp"]
```

### Gemini CLI — `~/.gemini/mcp.json`

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

### Antigravity — `~/.gemini/antigravity/mcp_config.json`

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

### Cursor — `.cursor/mcp.json`

```json
{
  "hive-exp": {
    "command": "npx",
    "args": ["-y", "@hive-exp/mcp"]
  }
}
```

### Windsurf — `.windsurf/mcp.json`

```json
{
  "hive-exp": {
    "command": "npx",
    "args": ["-y", "@hive-exp/mcp"]
  }
}
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `hive-exp init [--force] [--agent <type>]` | 自动检测 AI Agent 并写入 MCP 配置 |
| `hive-exp add [--file <path>] [--signals ...] [--strategy <name>]` | 添加一条新的经验记录 |
| `hive-exp validate <path>` | 校验经验 JSON 文件是否符合 Schema |
| `hive-exp sign <path> [--secret <secret>]` | 使用 HMAC-SHA256 签名经验文件 |
| `hive-exp query [--signal] [--strategy] [--scope] [--limit] [--format]` | 按信号、策略或作用域查询经验 |
| `hive-exp promote <exp_id> [--confirm]` | 将经验晋升到信任区（需人工确认） |
| `hive-exp archive <exp_id> [--reason]` | 归档经验（软删除） |
| `hive-exp stats [--type] [--format]` | 查看策略统计和经验健康概览 |
| `hive-exp replay [--from <date>] [--verbose]` | 从事件日志重建 SQLite 投影 |
| `hive-exp export [--format] [--min-confidence] [--scope] [--agent] [--promoted-only] [--output]` | 导出经验用于 RAG 或外部消费 |

## MCP 工具

MCP Server 向连接的 Agent 暴露五个工具：

| 工具 | 说明 |
|------|------|
| `hive_exp_query` | 搜索匹配错误信号的经验；按成功率和置信度排序返回策略 |
| `hive_exp_record` | 成功解决非平凡问题后录入一条新经验 |
| `hive_exp_outcome` | 应用查询到的策略后记录结果 |
| `hive_exp_stats` | 获取策略统计和经验健康概览（`overview`、`strategy_ranking`、`at_risk`） |
| `hive_exp_promote` | 提议将经验晋升到信任区（设置 `pending_promotion`；实际晋升需人工确认） |

## Dashboard

```bash
# 启动 Dashboard（需先安装 CLI）
hive-exp dashboard

# 或从源码直接启动
npx tsx apps/dashboard/src/server.ts
```

Dashboard 运行在 `http://localhost:3333`，展示所有经验、当前置信度、使用统计，以及供人工审核的晋升队列。

## 架构

```
packages/core/           — 核心库（Schema、事件、签名、清洗、共识、定时任务）
packages/mcp/            — MCP Server（5 个工具，stdio 传输，零外部依赖）
packages/signer-ed25519/ — 可选 Ed25519 签名器（HMAC-SHA256 的替代方案）
apps/cli/                — CLI 工具（10 个命令）
apps/dashboard/          — Web Dashboard（Express + HTML/CSS/JS）
hooks/                   — Claude Code PostToolUse 钩子（signal-detector.py）
```

数据默认存储在 `~/.hive-exp/` 下：

```
~/.hive-exp/
├── experiences/
│   ├── provisional/   — 新录入的待审核经验
│   ├── promoted/      — 人工确认的信任经验
│   ├── archived/      — 自动归档（零引用、低置信度、连续失败）
│   └── superseded/    — 被去重替代的经验（备份）
├── events/            — 仅追加的 JSONL 事件日志（yyyy-mm.jsonl）
├── db.sqlite          — SQLite 投影（快速查询）
└── signal-conventions.yaml
```

## 横向对比

| 特性 | hive-exp | Mem0 | Letta | 向量数据库 |
|------|----------|------|-------|-----------|
| 结构化 信号→策略→结果 | 支持 | 不支持（自由文本） | 不支持 | 不支持 |
| 多 Agent 跨厂商共享 | 支持 | 不支持 | 不支持 | 不支持 |
| 人机协同审核晋升 | 支持 | 不支持 | 有限支持 | 不支持 |
| MCP 原生（零适配代码） | 支持 | 不支持 | 不支持 | 不支持 |
| 置信度衰减 + 自动归档 | 支持 | 不支持 | 不支持 | 不支持 |
| 零外部依赖（无需 Docker/Postgres/Neo4j） | 支持 | 不支持 | 不支持 | 不支持 |

## 贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT — 详见 [LICENSE](LICENSE)。

---

*Python SDK 即将推出。*
