"""Server-side configuration. Secrets are read, never printed, never logged."""

from __future__ import annotations

import os
from pathlib import Path

# Repository .env.local is the existing source for the TMDB read token.
DEFAULT_ENV_FILE = Path(__file__).resolve().parents[2] / ".env.local"

WANTED = (
    "TMDB_READ_ACCESS_TOKEN",
    "SUBDL_API_KEY",
    "OPENSUBTITLES_API_KEY",
    "OPENSUBTITLES_USERNAME",
    "OPENSUBTITLES_PASSWORD",
)


def read_env_file(path: Path | None = None) -> dict[str, str]:
    """Very small KEY=VALUE reader. Values containing '=' are kept intact."""
    target = Path(path) if path else DEFAULT_ENV_FILE
    values: dict[str, str] = {}
    if not target.is_file():
        return values
    for raw in target.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key in WANTED:
            values[key] = value.strip().strip('"').strip("'")
    return values


def load_secrets(env_file: Path | None = None) -> dict[str, str]:
    """Prefer real environment variables; fall back to the env file."""
    file_values = read_env_file(env_file)
    resolved: dict[str, str] = {}
    for key in WANTED:
        value = os.environ.get(key) or file_values.get(key)
        if value:
            resolved[key] = value
    return resolved


def present(secrets: dict[str, str]) -> dict[str, bool]:
    """Which credentials exist, for reporting. Never returns the values."""
    return {key: key in secrets for key in WANTED}
