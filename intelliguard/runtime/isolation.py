from __future__ import annotations

import json
from typing import Any

from intelliguard.adk.manifest import RuntimeManifest


WRITE_SIDE_EFFECTS = {"write", "writes", "external_side_effect", "destructive"}
SECRET_VALUE_MARKERS = ("sk-", "xoxb-", "ghp_", "AKIA", "-----BEGIN")


def determine_worker_pool(manifest: RuntimeManifest) -> str:
    if manifest.environment == "production" and not manifest.metadata.get("data_classification"):
        return "human-review"
    if _has_untrusted_code(manifest):
        return "isolated-agent-code"
    if _has_write_tools(manifest):
        return "shared-governed-write"
    return "shared-readonly"


def validate_manifest_has_no_secret_values(manifest: RuntimeManifest) -> None:
    payload = manifest.model_dump(mode="json")
    _validate_no_secret_values(payload)


def _has_untrusted_code(manifest: RuntimeManifest) -> bool:
    return any(
        node.runtime.get("code_trust") == "untrusted"
        or node.metadata.get("code_trust") == "untrusted"
        or node.metadata.get("custom_code") is True
        for node in manifest.nodes
    )


def _has_write_tools(manifest: RuntimeManifest) -> bool:
    for node in manifest.nodes:
        side_effects = node.metadata.get("tool_side_effects") or {}
        for tool_name in node.allowed_tools:
            if str(side_effects.get(tool_name, "read_only")).lower() in WRITE_SIDE_EFFECTS:
                return True
        if str(node.metadata.get("side_effect_level", "read_only")).lower() in WRITE_SIDE_EFFECTS:
            return True
    return False


def _validate_no_secret_values(value: Any, *, parent_key: str = "") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _validate_no_secret_values(item, parent_key=key)
        return
    if isinstance(value, list):
        for item in value:
            _validate_no_secret_values(item, parent_key=parent_key)
        return
    if not isinstance(value, str):
        return
    if value.startswith("vault://") or value.startswith("secret://"):
        return
    key = parent_key.lower()
    if any(token in key for token in ("secret", "password", "token", "api_key", "apikey")):
        raise ValueError("Manifest contains a secret value instead of a secret reference.")
    if any(value.startswith(marker) for marker in SECRET_VALUE_MARKERS):
        raise ValueError("Manifest contains a secret value instead of a secret reference.")
    if parent_key and len(value) > 80:
        try:
            json.loads(value)
        except json.JSONDecodeError:
            return
