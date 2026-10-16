"""Credential redaction for anything that could reach a log, a message or a file.

Provider and router errors can echo the request URL back at us, and those URLs
carry secrets: `?api_key=...` for SubDL, the caller secret as a path segment for
the local router, and bearer tokens in headers. Any text that is about to be
embedded in an exception message, printed, or written to an artefact is passed
through `redact` first.
"""

from __future__ import annotations

import re

_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'(["\'](?:token|password|api_key|apiKey|link)["\']\s*:\s*["\'])[^"\']+', re.I), r'\1[redacted]'),
    (re.compile(r'https?://[^\s"\']+/(?:download|subtitle)/[^\s"\']+', re.I), '[redacted-download-url]'),
    # Covers `api_key=`, `Api-Key:`, `x-api-key:` and `apiKey:` in any casing.
    (re.compile(r"((?:x[-_])?api[-_]?key['\"]?\s*[:=]\s*['\"]?)[^&\s\"'<>,;)]+", re.I), r"\1[redacted]"),
    (re.compile(r"(_codex-router/)[^/\s\"'<>,;)]+"), r"\1[redacted]"),
    # Generic secret-bearing query parameters that providers may echo back.
    (re.compile(r"([?&](?:token|secret|link|password|pass|key)=)[^&\s\"'<>,;)]+", re.I), r"\1[redacted]"),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{8,}", re.I), r"\1[redacted]"),
    # Long opaque tokens: OpenSubtitles download paths are 250+ hex characters.
    (re.compile(r"\b[A-Fa-f0-9]{64,}\b"), "[redacted-token]"),
)


def redact(value: object, limit: int = 200) -> str:
    """Redact secrets from a message fragment and bound its length."""
    text = value if isinstance(value, str) else str(value)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]
