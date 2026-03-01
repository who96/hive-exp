#!/usr/bin/env python3
"""
PostToolUse hook for Claude Code.
Detects error signals in Bash output, reminds Agent to check hive-exp.
Does NOT query hive-exp directly — Agent decides autonomously.
Signal patterns loaded from signal-conventions.yaml (not hardcoded).
"""
import json, sys, re
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


def load_patterns():
    """Load signal patterns from signal-conventions.yaml."""
    candidates = [
        Path(__file__).parent / "signal-conventions.yaml",
        Path.home() / ".hive-exp" / "signal-conventions.yaml",
    ]
    for path in candidates:
        if yaml and path.exists():
            with open(path) as f:
                data = yaml.safe_load(f)
            return {
                sig["name"]: sig["detect_pattern"]
                for sig in data.get("signals", [])
                if "detect_pattern" in sig
            }
    return {
        "tsc_error": r"error TS\d+",
        "build_failed": r"Build failed|ELIFECYCLE|ERR!",
        "test_failed": r"FAIL\s+.*\.test\.|Tests:\s+\d+\s+failed",
    }


def detect_signals(text, patterns):
    """Return list of signal names detected in text."""
    return [name for name, pat in patterns.items() if re.search(pat, text)]


def main():
    data = json.load(sys.stdin)
    tool_output = str(data.get("tool_output", ""))
    if not tool_output.strip():
        return
    patterns = load_patterns()
    detected = detect_signals(tool_output, patterns)
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


if __name__ == "__main__":
    main()
