"""Tests for signal-detector.py"""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

# Import from signal-detector.py (hyphenated filename requires importlib)
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "signal_detector",
    Path(__file__).parent / "signal-detector.py",
)
signal_detector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(signal_detector)

load_patterns = signal_detector.load_patterns
detect_signals = signal_detector.detect_signals


class TestLoadPatterns(unittest.TestCase):
    """Tests for load_patterns()."""

    def test_fallback_patterns(self):
        """Without YAML, load_patterns returns at least 3 built-in patterns."""
        with patch.object(signal_detector, "yaml", None):
            patterns = load_patterns()
            self.assertIsInstance(patterns, dict)
            self.assertGreaterEqual(len(patterns), 3)
            self.assertIn("tsc_error", patterns)
            self.assertIn("build_failed", patterns)
            self.assertIn("test_failed", patterns)

    def test_yaml_patterns(self):
        """With YAML file present, load_patterns returns all 17 patterns."""
        yaml_path = Path(__file__).parent / "signal-conventions.yaml"
        if not yaml_path.exists():
            self.skipTest("signal-conventions.yaml not found")
        try:
            import yaml as _yaml
        except ImportError:
            self.skipTest("PyYAML not installed")
        patterns = load_patterns()
        self.assertEqual(len(patterns), 17)


class TestDetectSignals(unittest.TestCase):
    """Tests for detect_signals()."""

    def setUp(self):
        self.patterns = load_patterns()

    def test_detect_tsc_error(self):
        text = "src/index.ts(5,3): error TS2304: Cannot find name 'foo'."
        detected = detect_signals(text, self.patterns)
        self.assertIn("tsc_error", detected)

    def test_detect_test_failed(self):
        text = "FAIL src/foo.test.ts\n  Test Suites: 1 failed"
        detected = detect_signals(text, self.patterns)
        self.assertIn("test_failed", detected)

    def test_detect_build_failed(self):
        text = "Build failed with errors\nnpm ERR! code ELIFECYCLE"
        detected = detect_signals(text, self.patterns)
        self.assertIn("build_failed", detected)

    def test_no_detection(self):
        text = "All tests passed. Build succeeded."
        detected = detect_signals(text, self.patterns)
        self.assertEqual(detected, [])

    def test_multiple_signals(self):
        text = "error TS2304: Cannot find name\nFAIL src/foo.test.ts"
        detected = detect_signals(text, self.patterns)
        self.assertIn("tsc_error", detected)
        self.assertIn("test_failed", detected)


class TestOutputFormat(unittest.TestCase):
    """Tests for main() JSON output format."""

    def test_output_format(self):
        hook_input = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "npm run build"},
            "tool_output": "error TS2304: Cannot find name 'x'",
        })
        import subprocess
        script = str(Path(__file__).parent / "signal-detector.py")
        result = subprocess.run(
            [sys.executable, script],
            input=hook_input,
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(result.returncode, 0)
        output = json.loads(result.stdout)
        self.assertIn("hookSpecificOutput", output)
        hook_out = output["hookSpecificOutput"]
        self.assertEqual(hook_out["hookEventName"], "PostToolUse")
        self.assertIn("additionalContext", hook_out)
        self.assertIn("tsc_error", hook_out["additionalContext"])


if __name__ == "__main__":
    unittest.main()
