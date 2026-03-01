# hive-exp Agent Configuration Templates

This directory contains configuration templates used by `hive-exp init` to auto-configure MCP integration for supported AI agents.

## Directory Structure

```
configs/
├── claude-code/
│   ├── mcp.json              # MCP server entry for ~/.mcp.json
│   └── CLAUDE.md.append      # Behavior guidance appended to CLAUDE.md
├── codex/
│   ├── config.toml.append    # MCP server entry for ~/.codex/config.toml
│   └── instructions.md.append # Behavior guidance for Codex instructions
├── gemini-cli/
│   ├── mcp.json              # MCP server entry for ~/.gemini/mcp.json
│   └── instructions.md.append # Behavior guidance for Gemini
├── antigravity/
│   └── mcp_config.json       # MCP server entry for ~/.gemini/antigravity/mcp_config.json
└── cursor/
    └── mcp.json              # MCP server entry for .cursor/mcp.json
```

## How `hive-exp init` Uses These Templates

1. **Detection**: Checks for agent config file existence to determine which agents are installed
2. **Preview**: Shows what configuration would be added (dry-run by default)
3. **Apply**: With `--force`, merges MCP config into existing agent config files

JSON files are deep-merged (existing keys are preserved). TOML files have sections appended if not already present.

## Manual Setup

If you prefer manual configuration, add the hive-exp MCP server entry to your agent's config:

### Claude Code (`~/.mcp.json`)
Merge contents of `claude-code/mcp.json` into your existing `~/.mcp.json`.

### Codex (`~/.codex/config.toml`)
Append contents of `codex/config.toml.append` to your `~/.codex/config.toml`.

### Gemini CLI (`~/.gemini/mcp.json`)
Merge contents of `gemini-cli/mcp.json` into your existing `~/.gemini/mcp.json`.

### Antigravity (`~/.gemini/antigravity/mcp_config.json`)
Merge contents of `antigravity/mcp_config.json` into your existing config.

### Cursor (`.cursor/mcp.json` in project root)
Merge contents of `cursor/mcp.json` into your project's `.cursor/mcp.json`.

### Windsurf (`.windsurf/mcp.json` in project root)
Same format as Cursor. Merge into `.windsurf/mcp.json`.
