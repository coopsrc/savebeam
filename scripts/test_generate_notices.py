"""Dependency-closure regressions; isolated files, no registry or user installation access."""
import json
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("notices", Path(__file__).with_name("generate-notices.py"))
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)
npm_packages = notices.npm_packages


class ProductionDependencies(unittest.TestCase):
    def package(self, root, name, **fields):
        directory = root / "node_modules" / name
        directory.mkdir(parents=True)
        (directory / "package.json").write_text(json.dumps({
            "name": name, "version": "1.0.0", "license": "MIT", **fields
        }))
        return directory

    def test_shared_transitive_and_peer_packages_are_not_lost_to_list_deduplication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "package.json").write_text(json.dumps({
                "dependencies": {"ui": "1"}, "devDependencies": {"compiler": "1"}
            }))
            self.package(root, "ui", dependencies={"styles": "1", "scheduler": "1"},
                         peerDependencies={"types": "1", "uninstalled-peer": "1"})
            self.package(root, "styles", dependencies={"nonce": "1"})
            self.package(root, "scheduler")
            self.package(root, "nonce")
            self.package(root, "types", dependencies={"styles": "1"})
            self.package(root, "compiler")
            self.assertEqual({p[1] for p in npm_packages(root)},
                             {"ui", "styles", "scheduler", "nonce", "types"})

    def test_missing_required_dependencies_fail_instead_of_silently_omitting_notices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "package.json").write_text('{"dependencies":{"missing":"1"}}')
            with self.assertRaisesRegex(ValueError, "Missing installed production dependency"):
                npm_packages(root)


if __name__ == "__main__":
    unittest.main()
