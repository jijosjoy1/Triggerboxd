"""Turn rule hits into a draft analysis block.

Two invariants hold here:
  * severity is never asserted - it stays null until a human reviews the film;
  * no match is never reported as absence - a category with no evidence is
    `unknown`, which is not the same as `none`.
Visual-only categories are always `unknown` because subtitle text cannot
establish them.
"""

from __future__ import annotations

from .report import CATEGORY_SLUGS
from .rules import Hit, Lexicon
from .subtitles import SubtitleFile

MAX_EVIDENCE_PER_CATEGORY = 40
SCORER_VERSION = "family-dialogue-1"

LIMITATION_VISUAL_ONLY = "Subtitle text cannot establish this category; it stays unknown until a human reviews the film."
LIMITATION_NO_RULES = "No offline rule coverage for this category yet; it stays unknown."
LIMITATION_NO_MATCH = "No matching cue found. This is not evidence of absence."

STATE_CANDIDATE = "candidate"
STATE_UNKNOWN = "unknown"

FAMILY_VERDICTS = {
    1: "Even grandma can join.",
    2: "A few awkward silences.",
    3: "Suddenly, WhatsApp looks interesting.",
    4: "The ceiling fan deserves an Oscar.",
    5: "The remote won't save you.",
}


def _cue_count(hits: list[Hit], predicate) -> int:
    """Count affected cues, not matching words, so one line cannot inflate a score."""
    return len({hit.cue_id for hit in hits if predicate(hit)})


def _family_awkwardness_estimate(hits: list[Hit], *, score_version: str) -> dict:
    """Estimate family awkwardness from dialogue evidence only.

    Language is deliberately capped at level 3 by itself. Higher estimates need
    family-sensitive sexual dialogue, sexual-violence references, or slurs. The
    estimate is review material and never changes content-warning severity.
    """
    factors = {
        "mildProfanityCues": _cue_count(hits, lambda hit: hit.rule_id.startswith("lang-mild-")),
        "strongProfanityCues": _cue_count(hits, lambda hit: hit.rule_id.startswith("lang-strong-")),
        "slurCues": _cue_count(hits, lambda hit: hit.rule_id.startswith("lang-slur-")),
        "sexualContentCues": _cue_count(hits, lambda hit: hit.category == "sexual_content"),
        "sexualViolenceReferenceCues": _cue_count(hits, lambda hit: hit.category == "sexual_violence"),
    }

    points = (
        min(factors["mildProfanityCues"], 10) * 0.1
        + min(factors["strongProfanityCues"], 8) * 1.5
        + min(factors["slurCues"], 5) * 1.5
        + min(factors["sexualContentCues"], 6) * 3.0
        + min(factors["sexualViolenceReferenceCues"], 4) * 2.5
    )
    rounded_points = round(points, 1)
    common = {
        "basis": "subtitle_dialogue_rules",
        "scoreVersion": score_version,
        "visualCoverage": "unknown",
        "factors": factors,
        "points": rounded_points,
        "limitations": [
            "This estimates dialogue awkwardness only; subtitles cannot establish nudity, intimacy, or what is shown on screen.",
            "A reference to sexual violence does not establish that it is depicted.",
            "This is a private provisional estimate, not a community rating.",
        ],
    }
    if points == 0:
        return {**common, "state": STATE_UNKNOWN, "rating": None, "verdict": None, "confidence": "low"}

    if points <= 1:
        rating = 1
    elif points <= 5:
        rating = 2
    elif points <= 15:
        rating = 3
    elif points <= 24:
        rating = 4
    else:
        rating = 5
    confidence = "medium" if sum(factors.values()) >= 6 else "low"
    return {
        **common,
        "state": "provisional",
        "rating": rating,
        "verdict": FAMILY_VERDICTS[rating],
        "confidence": confidence,
    }


def _capped(hits: list[Hit]) -> tuple[list[dict], bool]:
    truncated = len(hits) > MAX_EVIDENCE_PER_CATEGORY
    return [hit.as_dict() for hit in hits[:MAX_EVIDENCE_PER_CATEGORY]], truncated


def analyze(subtitle: SubtitleFile, lexicon: Lexicon, *, context_window: int = 1) -> dict:
    hits = lexicon.scan(subtitle.cues, context_window)
    by_category: dict[str, list[Hit]] = {}
    for hit in hits:
        by_category.setdefault(hit.category, []).append(hit)

    categories: list[dict] = []
    for slug in CATEGORY_SLUGS:
        if slug in lexicon.visual_only:
            categories.append({
                "category": slug,
                "severity": None,
                "state": STATE_UNKNOWN,
                "evidence": [],
                "evidenceCount": 0,
                "limitation": LIMITATION_VISUAL_ONLY,
            })
            continue

        found = by_category.get(slug, [])
        if not found:
            categories.append({
                "category": slug,
                "severity": None,
                "state": STATE_UNKNOWN,
                "evidence": [],
                "evidenceCount": 0,
                "limitation": LIMITATION_NO_MATCH if slug in lexicon.text_evidenced else LIMITATION_NO_RULES,
            })
            continue

        evidence, truncated = _capped(found)
        entry = {
            "category": slug,
            "severity": None,
            "state": STATE_CANDIDATE,
            "evidence": evidence,
            "evidenceCount": len(found),
        }
        if truncated:
            entry["evidenceTruncated"] = True
        if slug not in lexicon.text_evidenced:
            entry["limitation"] = LIMITATION_NO_RULES
        categories.append(entry)

    limitations: list[str] = []
    if lexicon.provenance.get("notCovered"):
        limitations.extend(str(item) for item in lexicon.provenance["notCovered"])

    return {
        "analysis": {
            "method": "offline-rules",
            "engine": "tbpipe.rules",
            "rulesVersion": lexicon.version,
            "scorerVersion": SCORER_VERSION,
            "model": None,
            "contextWindow": context_window,
        },
        "categories": categories,
        "familyAwkwardnessEstimate": _family_awkwardness_estimate(hits, score_version=SCORER_VERSION),
        "limitations": limitations,
    }


def draft_for(*, movie: dict, subtitle: SubtitleFile, analysis: dict, window: dict | None, region: str | None,
              source: str | None = None) -> dict:
    """Assemble a private draft. Still not verified, still not published."""
    subtitle_facts = subtitle.as_dict()
    subtitle_facts["source"] = source
    return {
        "draftVersion": 1,
        "reviewStatus": "draft_pending_human",
        "publication": "none",
        "movie": movie,
        "ottWindow": window,
        "territory": region,
        "subtitle": subtitle_facts,
        "analysis": analysis["analysis"],
        "categories": analysis["categories"],
        "familyAwkwardnessEstimate": analysis["familyAwkwardnessEstimate"],
        "limitations": analysis["limitations"],
    }
