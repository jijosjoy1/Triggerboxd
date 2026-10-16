"""Optional model comparison, using only models included in the subscription.

The offline rules engine stays the baseline and the fallback: this module adds a
second opinion, it never replaces the deterministic path.

Guardrails, in order of importance:

* Only models on the free/included allowlist can be called. A paid model cannot
  be selected even by accident, and there is no paid fallback path.
* Cue ids and timestamps are never rewritten: findings reference the cue they
  came from.
* Output must be schema-valid JSON. Anything else is discarded.
* Every returned reference is checked against the real cue text. A finding whose
  quote does not appear in the cue it cites is rejected as fabricated, along with
  any unknown category or cue id.
* Token usage is measured and a run stops before the included allowance is
  exhausted.

This route sends non-coding inference traffic. Provider permission for that use
must be confirmed before enabling live classification; the request is not
disguised as coding-agent traffic.
"""

from __future__ import annotations

import http.client
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path


# Models observed working through the local router. Nothing outside this list is
# callable, so a paid model can never be reached from here.
FREE_MODELS = (
    "deepseek-v4.1-flash",
    "deepseek-v4-flash",
    "glm-5.3-flash",
    "mimo-v2.6-flash",
)
DEFAULT_MODEL = "deepseek-v4.1-flash"

CHUNK_CUES = 25
CHUNK_OVERLAP = 5
# Reasoning consumes the output budget before any answer is written. At 40 cues
# with 1200 tokens the live model returned stop_reason=max_tokens and an *empty*
# string; at 25 cues with this budget it answered normally (136 tokens). Both the
# smaller window and the headroom are required, not one or the other.
MAX_TOKENS_PER_CHUNK = 2000
DAILY_TOKEN_BUDGET = 200_000
MAX_CHUNKS = 60

ROUTER_BASE_URL = os.environ.get("TB_MODEL_BASE_URL", "http://127.0.0.1:4202")
ROUTER_SECRET_PATH = Path.home() / ".codex" / "codex-router" / "caller-secret"
ROUTER_CALLER_PREFIX = "/_codex-router"

SYSTEM_PROMPT = (
    "You classify movie subtitle cues for content warnings. "
    "Reply with JSON only, no prose and no markdown fences. "
    "Shape: {\"findings\":[{\"category\":\"<slug>\",\"cueId\":\"<cue id>\",\"quote\":\"<exact words from that cue>\"}]}. "
    "Rules: only use cue ids that appear in the input; the quote must be copied exactly from that cue; "
    "only use the allowed categories; report nothing you cannot quote; return an empty findings list if unsure. "
    "Never speculate about anything not present in the text."
)


class ModelUnavailable(RuntimeError):
    """No usable model route (router down, no secret, or budget exhausted)."""


class ModelError(RuntimeError):
    """The model answered but the answer could not be used."""


@dataclass(frozen=True)
class Finding:
    category: str
    cue_id: str
    quote: str

    def as_dict(self) -> dict:
        return {"category": self.category, "cueId": self.cue_id, "quote": self.quote, "source": "model"}


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0
    rejected: int = 0
    chunks: int = 0
    failed_chunks: int = 0
    chunk_errors: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens

    def as_dict(self) -> dict:
        return {"inputTokens": self.input_tokens, "outputTokens": self.output_tokens,
                "totalTokens": self.total, "calls": self.calls, "chunks": self.chunks,
                "failedChunks": self.failed_chunks, "chunkErrors": self.chunk_errors[:10],
                "rejectedFindings": self.rejected}


@dataclass
class Result:
    findings: list[Finding]
    usage: Usage
    model: str
    stopped: str | None = None  # reason the run stopped early, if any


def chunk_cues(cues, size: int = CHUNK_CUES, overlap: int = CHUNK_OVERLAP) -> list[list]:
    """Split cues into overlapping windows, preserving original order and ids."""
    if size < 1:
        raise ValueError("size must be >= 1")
    if not 0 <= overlap < size:
        raise ValueError("overlap must be >= 0 and < size")
    windows: list[list] = []
    step = size - overlap
    for start in range(0, max(1, len(cues)), step):
        window = list(cues[start:start + size])
        if not window:
            break
        windows.append(window)
        if start + size >= len(cues):
            break
    return windows


def render_chunk(window) -> str:
    lines = [f"{cue.cue_id}\t{cue.start_ms}\t{cue.text}" for cue in window]
    return "cue id\tstart ms\ttext\n" + "\n".join(lines)


def _safe_int(value) -> int:
    """Provider metadata must never be able to abort a run."""
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def parse_findings(raw: str, window, categories: tuple[str, ...]) -> tuple[list[Finding], int]:
    """Validate a model reply. Returns (accepted findings, rejected count)."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?|```$", "", text).strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        raise ModelError("model reply was not valid JSON")
    if not isinstance(payload, dict) or not isinstance(payload.get("findings"), list):
        raise ModelError("model reply did not match the required schema")

    allowed = set(categories)
    texts = {cue.cue_id: cue.text for cue in window}
    accepted: list[Finding] = []
    rejected = 0
    for item in payload["findings"]:
        if not isinstance(item, dict):
            rejected += 1
            continue
        category = item.get("category")
        cue_id = item.get("cueId")
        quote = item.get("quote")
        if not isinstance(category, str) or category not in allowed:
            rejected += 1
            continue
        if not isinstance(cue_id, str) or cue_id not in texts:
            rejected += 1
            continue
        if not isinstance(quote, str) or len(quote.strip()) < 2:
            rejected += 1
            continue
        needle = quote.strip()
        # Locate the quote in the original cue, case-insensitively, so the stored
        # span is real text even when lower-casing would change string length.
        found = re.search(re.escape(needle), texts[cue_id], re.IGNORECASE)
        if found is None:
            rejected += 1
            continue
        actual = texts[cue_id][found.start():found.end()]
        accepted.append(Finding(category=category, cue_id=cue_id, quote=actual))
    return accepted, rejected


def resolve_model_path(model: str, family: str = "opencode-go") -> str:
    """Build the route for an exact included model in the approved family."""
    if family != "opencode-go" or model not in FREE_MODELS:
        raise ModelError("model route is not on the included-model allowlist")
    return f"codex_router/anthropic/opencode-go/{model}"


class _RouterTransport:
    """Local codex-router, the supported mechanism available on this machine."""

    def __init__(self, base_url: str = ROUTER_BASE_URL, secret_path: Path = ROUTER_SECRET_PATH):
        self.base_url = base_url.rstrip("/")
        self.secret_path = secret_path

    def secret(self) -> str:
        env = os.environ.get("TB_MODEL_SECRET")
        if env:
            return env.strip()
        if not self.secret_path.is_file():
            raise ModelUnavailable(f"router caller secret not found at {self.secret_path}")
        return self.secret_path.read_text(encoding="utf-8").strip()

    def message(self, model: str, prompt: str, *, max_tokens: int = MAX_TOKENS_PER_CHUNK, timeout: int = 120,
                system: str = SYSTEM_PROMPT):
        secret = self.secret()
        url = f"{self.base_url}{ROUTER_CALLER_PREFIX}/{secret}/anthropic/v1/messages"
        body = json.dumps({
            "model": resolve_model_path(model),
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        request = urllib.request.Request(url, data=body, method="POST", headers={
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": "triggerboxd-pipeline/0.2 (manual review, non-coding inference)",
        })
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            # A non-UTF-8 or non-JSON body must fail as a chunk, not as a bare
            # ValueError escaping the ModelError contract.
            try:
                return json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ModelError("model route returned a malformed body") from None
        except urllib.error.HTTPError as exc:
            # The router may echo the secret-bearing request URL in its body.
            # Surface only the status code.
            if exc.code in (401, 402, 403):
                raise ModelUnavailable(f"model route refused the request (HTTP {exc.code})") from None
            raise ModelError(f"model route HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
            raise ModelUnavailable(f"model route unreachable: {type(exc).__name__}") from None


class ModelClient:
    def __init__(self, *, model: str = DEFAULT_MODEL, transport=None, token_budget: int = DAILY_TOKEN_BUDGET,
                 tokens_already_used: int = 0, max_chunks: int = MAX_CHUNKS, sleep=time.sleep,
                 usage_callback=None):
        if model not in FREE_MODELS:
            raise ModelError(f"{model} is not on the included-model allowlist")
        self.model = model
        self._transport = transport or _RouterTransport()
        self._budget = token_budget
        self._used = tokens_already_used
        self._max_chunks = max_chunks
        self._sleep = sleep
        self._usage_callback = usage_callback

    def tokens_used(self) -> int:
        return self._used

    def available(self) -> bool:
        """True when a usable model route exists (secret present)."""
        checker = getattr(self._transport, "secret", None)
        if checker is None:
            return True  # injected transport (tests, or an in-process route)
        try:
            checker()
            return True
        except ModelUnavailable:
            return False

    def classify(self, cues, categories: tuple[str, ...]) -> Result:
        usage = Usage()
        findings: list[Finding] = []
        seen: set[tuple[str, str, str]] = set()
        stopped: str | None = None
        succeeded = 0
        # Tokens already spent before this call must keep counting toward the
        # allowance; `usage` only tracks this call.
        # _used includes reservations for every dispatched request.
        for index, window in enumerate(chunk_cues(cues)):
            if index >= self._max_chunks:
                stopped = "max_chunks_reached"
                break
            if self._used >= self._budget:
                stopped = "token_budget_reached"
                break
            prompt = (
                f"Allowed categories: {', '.join(categories)}\n"
                f"Classify these {len(window)} cue(s).\n\n{render_chunk(window)}"
            )
            # Reserve headroom: the call cost is unknown until it returns, so stop
            # before dispatching rather than overshooting the allowance after.
            # Bytes, not characters: non-ASCII cue text costs about a token per byte-ish unit.
            estimate = len(prompt.encode("utf-8")) + len(SYSTEM_PROMPT.encode("utf-8")) + MAX_TOKENS_PER_CHUNK + 512
            if self._used + estimate > self._budget:
                stopped = "token_budget_reached"
                break
            if self._usage_callback:
                self._usage_callback(estimate)
            self._used += estimate
            try:
                payload = self._transport.message(self.model, prompt)
            except ModelError as exc:
                # A transient provider error on one chunk must not discard the run.
                # ModelUnavailable still propagates: an absent route is fatal.
                usage.failed_chunks += 1
                usage.chunk_errors.append(f"chunk {index}: {exc}")
                continue
            if not isinstance(payload, dict):
                usage.failed_chunks += 1
                usage.chunk_errors.append(f"chunk {index}: reply was not a JSON object")
                continue
            usage.calls += 1
            usage.chunks += 1
            block = payload.get("usage")
            block = block if isinstance(block, dict) else {}
            measured_input = _safe_int(block.get("input_tokens"))
            measured_output = _safe_int(block.get("output_tokens"))
            measured = measured_input + measured_output
            if measured:
                delta = measured - estimate
                if self._usage_callback:
                    self._usage_callback(delta)
                self._used += delta
                usage.input_tokens += measured_input
                usage.output_tokens += measured_output
            else:
                stopped = "usage_unavailable"
            parts = payload.get("content")
            parts = parts if isinstance(parts, list) else []
            text = "".join(
                (part.get("text") or "") for part in parts
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            )
            # One unusable chunk must not discard the whole run. A truncated or
            # empty reply usually means reasoning ate the output budget.
            try:
                if payload.get("stop_reason") == "max_tokens" or not text.strip():
                    raise ModelError("reply was empty or truncated before the answer")
                accepted, rejected = parse_findings(text, window, categories)
            except ModelError as exc:
                usage.failed_chunks += 1
                usage.chunk_errors.append(f"chunk {index}: {exc}")
                continue
            succeeded += 1
            usage.rejected += rejected
            # Overlapping windows re-see the same cues; identical findings must not
            # be emitted twice.
            for finding in accepted:
                key = (finding.category, finding.cue_id, finding.quote)
                if key not in seen:
                    seen.add(key)
                    findings.append(finding)
            # Re-check after the call so a chunk cannot overshoot the allowance.
            if stopped == "usage_unavailable":
                break
            if self._used >= self._budget:
                stopped = "token_budget_reached"
                break
        if succeeded == 0 and usage.failed_chunks:
            raise ModelError(usage.chunk_errors[0] if usage.chunk_errors else "every chunk failed")
        return Result(findings=findings, usage=usage, model=self.model, stopped=stopped)
