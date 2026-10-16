"""Offline, versioned phrase/context rule engine.

Deterministic and dependency-free apart from the standard library: it must run
with no network, no model and no GPU. Rules come from a versioned lexicon file
whose version string is recorded in every draft so a result can be reproduced.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_LEXICON = Path(__file__).resolve().parents[1] / "rules" / "lexicon.v1.json"


class LexiconError(RuntimeError):
    pass


@dataclass(frozen=True)
class Rule:
    id: str
    category: str
    pattern: re.Pattern[str]
    note: str = ""
    requires_near: tuple[re.Pattern[str], ...] = ()
    suppress_near: tuple[re.Pattern[str], ...] = ()

    @property
    def has_context(self) -> bool:
        return bool(self.requires_near or self.suppress_near)


@dataclass(frozen=True)
class Hit:
    category: str
    rule_id: str
    cue_index: int
    cue_id: str
    start_ms: int
    end_ms: int
    matched: str
    note: str

    def as_dict(self) -> dict:
        return {
            "category": self.category,
            "ruleId": self.rule_id,
            "cueIndex": self.cue_index,
            "cueId": self.cue_id,
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "matched": self.matched,
            "note": self.note,
        }


def _compile_all(patterns) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(item, re.IGNORECASE) for item in patterns or ())


class Lexicon:
    def __init__(self, *, version: str, rules: tuple[Rule, ...],
                 text_evidenced: tuple[str, ...], visual_only: tuple[str, ...], provenance: dict):
        self.version = version
        self.rules = rules
        self.text_evidenced = text_evidenced
        self.visual_only = visual_only
        self.provenance = provenance
        self._by_category: dict[str, tuple[Rule, ...]] = {}
        for rule in rules:
            self._by_category.setdefault(rule.category, ())
            self._by_category[rule.category] = (*self._by_category[rule.category], rule)

    @property
    def categories(self) -> tuple[str, ...]:
        return tuple(self._by_category)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Lexicon":
        target = Path(path) if path else DEFAULT_LEXICON
        if not target.is_file():
            raise LexiconError(f"lexicon not found: {target}")
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            raise LexiconError(f"lexicon could not be read: {exc}") from None
        except json.JSONDecodeError as exc:
            raise LexiconError(f"lexicon is not valid JSON: {exc}") from None

        version = payload.get("version")
        raw_rules = payload.get("rules")
        if not isinstance(version, str) or not version:
            raise LexiconError("lexicon is missing a version")
        if not isinstance(raw_rules, list) or not raw_rules:
            raise LexiconError("lexicon has no rules")

        rules: list[Rule] = []
        seen: set[str] = set()
        for entry in raw_rules:
            if not isinstance(entry, dict):
                raise LexiconError("every rule must be an object")
            rule_id = entry.get("id")
            category = entry.get("category")
            pattern = entry.get("pattern")
            if not isinstance(rule_id, str) or not rule_id:
                raise LexiconError("every rule needs an id")
            if rule_id in seen:
                raise LexiconError(f"duplicate rule id: {rule_id}")
            seen.add(rule_id)
            if not isinstance(category, str) or not category:
                raise LexiconError(f"rule {rule_id} needs a category")
            if not isinstance(pattern, str) or not pattern:
                raise LexiconError(f"rule {rule_id} needs a pattern")
            try:
                compiled = re.compile(pattern, re.IGNORECASE)
            except re.error as exc:
                raise LexiconError(f"rule {rule_id} has an invalid pattern: {exc}") from None
            if compiled.search(""):
                raise LexiconError(f"rule {rule_id} can match empty text and would cite no evidence")
            rules.append(
                Rule(
                    id=rule_id,
                    category=category,
                    pattern=compiled,
                    note=str(entry.get("note") or ""),
                    requires_near=_compile_all(entry.get("requiresNear")),
                    suppress_near=_compile_all(entry.get("suppressNear")),
                )
            )
        def slug_list(key: str) -> tuple[str, ...]:
            # A bare string would silently become a tuple of characters and
            # corrupt the text-vs-visual classification.
            value = payload.get(key) or []
            if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
                raise LexiconError(f"{key} must be a list of non-empty strings")
            return tuple(value)

        return cls(
            version=version,
            rules=tuple(rules),
            text_evidenced=slug_list("textEvidencedCategories"),
            visual_only=slug_list("visualOnlyCategories"),
            provenance=payload.get("provenance") or {},
        )

    def scan(self, cues, context_window: int = 1) -> list[Hit]:
        """Return every rule hit. Cue order and timestamps are preserved.

        A rule with `requiresNear` only fires when the required phrase appears in
        the cue or within +/- `context_window` cues; `suppressNear` cancels a hit
        when a disqualifying phrase appears in the same window. Widening the
        window trades recall against false positives, so the window is explicit.

        Context is looked up by *position* in `cues`, not by `cue.index`: cues
        with no readable text are dropped when loading, so `index` (the position
        in the source file) has gaps and would select the wrong neighbours.
        """
        window = max(0, context_window)
        cues = list(cues)
        context: list[str] = []
        for position in range(len(cues)):
            low = max(0, position - window)
            high = min(len(cues), position + window + 1)
            context.append(" \n ".join(cues[i].text for i in range(low, high)))

        hits: list[Hit] = []
        for position, cue in enumerate(cues):
            near = context[position]
            for rule in self.rules:
                for match in rule.pattern.finditer(cue.text):
                    if rule.requires_near and not any(p.search(near) for p in rule.requires_near):
                        continue
                    if rule.suppress_near and any(p.search(near) for p in rule.suppress_near):
                        continue
                    hits.append(
                        Hit(
                            category=rule.category,
                            rule_id=rule.id,
                            cue_index=cue.index,
                            cue_id=cue.cue_id,
                            start_ms=cue.start_ms,
                            end_ms=cue.end_ms,
                            matched=match.group(0),
                            note=rule.note,
                        )
                    )
        return hits
