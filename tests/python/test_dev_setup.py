"""Developer setup must fail before mutation when dependencies are missing."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("hail_dev", Path(__file__).parents[2] / "scripts/dev.py")
dev = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dev)


class DevSetupTests(unittest.TestCase):
    def test_tools_and_browsers_use_project_local_paths(self):
        root = Path("/tmp/hail development")
        with patch.dict("os.environ", {"PLAYWRIGHT_BROWSERS_PATH": "/unwritable/shared", "HAIL_LIVE": "1"}):
            env = dev.environment(root)
        self.assertEqual(env["PLAYWRIGHT_BROWSERS_PATH"], str(root / ".dev-tools/browsers"))
        self.assertTrue(env["PATH"].startswith(str(root / ".dev-tools/bin")))
        self.assertEqual(env["HAIL_LIVE"], "0")

    def test_missing_tools_are_reported_without_running_setup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = io.StringIO()
            with patch.object(dev, "missing_tools", return_value=["terraform", "node >=22"]), patch.object(dev, "run") as run, contextlib.redirect_stderr(output):
                self.assertEqual(dev.setup(root), 1)
            run.assert_not_called()
            self.assertIn("make deps", output.getvalue())
            self.assertIn("terraform", output.getvalue())
            self.assertFalse((root / ".dev-tools/activate").exists())

    def test_activation_handles_spaces_and_quotes_without_expanding_shell_code(self):
        with tempfile.TemporaryDirectory(prefix="hail ' setup ") as directory:
            root = Path(directory) / '$(touch should-not-exist)'
            root.mkdir()
            activation = dev.write_activation(root)
            result = subprocess.run(["bash", "-c", 'source "$1"; printf "%s" "$HAIL_DEV_ROOT"', "bash", str(activation)], check=True, capture_output=True, text=True)
            self.assertEqual(result.stdout, str(root))
            self.assertFalse((Path.cwd() / "should-not-exist").exists())

    def test_setup_uses_backend_free_initialization_and_local_hooks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(dev, "missing_tools", return_value=[]), patch.object(dev, "run") as run:
                self.assertEqual(dev.setup(root), 0)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertIn(["pre-commit", "install", "--hook-type", "pre-push"], commands)
            inits = [cmd for cmd in commands if cmd[0] == "terraform"]
            self.assertEqual(len(inits), 5)
            self.assertTrue(all("-backend=false" in cmd and "-lockfile=readonly" in cmd for cmd in inits))
            self.assertFalse(any("apply" in cmd or "plan" in cmd for cmd in commands))

    def test_setup_does_not_emit_ready_shell_after_command_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(dev, "missing_tools", return_value=[]), patch.object(dev, "run", side_effect=subprocess.CalledProcessError(1, ["npm"])):
                with self.assertRaises(subprocess.CalledProcessError):
                    dev.setup(root)
            self.assertFalse((root / ".dev-tools/activate").exists())
