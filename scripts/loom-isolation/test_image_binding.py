"""Source/image binding units using only synthetic local files, never Podman."""
import tempfile
import unittest
import json
from pathlib import Path

import image_binding


class BindingTests(unittest.TestCase):
    def test_configuration_and_receipt_refuse_alternate_entrypoint_or_image(self):
        image = "sha256:" + "a" * 64
        record = {"Id": image, "Config": {"User": "node", "WorkingDir": "/workspace",
                  "Entrypoint": image_binding.ENTRYPOINT, "Cmd": image_binding.COMMAND,
                  "Env": [key + "=" + value for key, value in image_binding.REQUIRED_ENV.items()],
                  "Labels": {image_binding.SOURCE_LABEL: "source", image_binding.GATE_LABEL: "gate"}}}
        receipt = {"image": image, "source": {"sha256": "source"}, "gateSha256": "gate",
                   "imageConfiguration": image_binding.configuration(record)}
        image_binding.verify_configuration(record, receipt)
        record["Config"]["Entrypoint"] = ["bash"]
        with self.assertRaises(image_binding.Refusal):
            image_binding.verify_configuration(record, receipt)
        record["Config"]["Entrypoint"] = image_binding.ENTRYPOINT
        record["Id"] = "sha256:" + "b" * 64
        with self.assertRaises(image_binding.Refusal):
            image_binding.verify_configuration(record, receipt)

    def test_head_is_provenance_but_manifest_tampering_is_not_publication_only(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            gate = root / image_binding.GATE_INPUT
            gate.parent.mkdir(parents=True)
            gate.write_text("synthetic gate")
            entries = image_binding.file_entries(root, [image_binding.GATE_INPUT])
            receipt = {"schema": "loom-test-image-build/v1", "status": "verified",
                       "image": "sha256:" + "a" * 64, "gateSha256": entries[0]["sha256"],
                       "source": {"entries": entries, "sha256": image_binding.digest(entries), "head": "old"}}
            path = root / "receipt.json"
            path.write_text(json.dumps(receipt))
            image_binding.load_receipt(path, root)
            receipt["source"]["head"] = "new-publication-head-same-bytes"
            path.write_text(json.dumps(receipt))
            image_binding.load_receipt(path, root)
            receipt["source"]["entries"][0]["sha256"] = "b" * 64
            path.write_text(json.dumps(receipt))
            with self.assertRaises(image_binding.Refusal):
                image_binding.load_receipt(path, root)

    def test_selected_byte_and_mode_manifest_is_verifiable_not_just_a_head(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "source.py").write_bytes(b"synthetic source\n")
            (root / "source.py").chmod(0o644)
            entries = image_binding.file_entries(root, ["source.py"])
            self.assertEqual(image_binding.verify_files(root, entries)["files"], 1)
            (root / "source.py").write_bytes(b"other bytes\n")
            with self.assertRaises(image_binding.Refusal):
                image_binding.verify_files(root, entries)
            (root / "source.py").write_bytes(b"synthetic source\n")
            (root / "source.py").chmod(0o755)
            with self.assertRaises(image_binding.Refusal):
                image_binding.verify_files(root, entries)

    def test_receipt_without_binding_or_outside_scope_is_refused(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            receipt = root / "receipt.json"
            receipt.write_text('{"schema":"loom-test-image-build/v1","status":"verified"}')
            with self.assertRaises(image_binding.Refusal):
                image_binding.load_receipt(receipt, root)
            with self.assertRaises(image_binding.Refusal):
                image_binding.load_receipt(receipt, root / "different-scope")

    def test_manifest_rejects_escape_duplicate_and_symlink_input(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "source.py").write_text("synthetic")
            entries = image_binding.file_entries(root, ["source.py"])
            for value in (entries + entries, [{**entries[0], "path": "../outside"}]):
                with self.assertRaises(image_binding.Refusal):
                    image_binding.verify_files(root, value)
            (root / "source.py").unlink()
            (root / "source.py").symlink_to(root / "missing")
            with self.assertRaises(image_binding.Refusal):
                image_binding.verify_files(root, entries)


if __name__ == "__main__":
    unittest.main()
