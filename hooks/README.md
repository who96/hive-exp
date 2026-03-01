# hooks/ — Claude Code Signal Detector

## What it does

`signal-detector.py` is a **PostToolUse** hook for Claude Code. After every `Bash` tool invocation, it scans the command output for known error signals (TypeScript errors, build failures, test failures, etc.) and injects a reminder into the conversation so the Agent can decide whether to query hive-exp for known solutions.

The hook **does not** call hive-exp itself — the Agent decides autonomously.

## Signal patterns

Patterns are defined in `signal-conventions.yaml` (17 entries across 7 categories: build, module, test, lint, runtime, security, config). The Python script loads this file at startup.

If PyYAML is not installed, the script falls back to 3 hardcoded patterns (tsc_error, build_failed, test_failed).

### Customizing patterns

Edit `signal-conventions.yaml` to add, remove, or modify patterns. Each entry has:

```yaml
- name: tsc_error          # unique signal name
  category: build           # grouping category
  detect_pattern: "error TS\\d+"  # Python regex
  aliases: [ts_error]       # alternative names (for documentation)
```

You can also place a copy at `~/.hive-exp/signal-conventions.yaml` — the script checks both locations.

## Setup

### Prerequisites

- Python 3.8+
- PyYAML (`pip install pyyaml`) — optional, enables full pattern set

### Configure in Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 /path/to/hooks/signal-detector.py",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/hooks/` with the actual absolute path to this directory.

### Make executable

```bash
chmod +x hooks/signal-detector.py
```

## Testing

```bash
cd hooks && python3 -m pytest test_signal_detector.py -v
# or
cd hooks && python3 -m unittest test_signal_detector -v
```
