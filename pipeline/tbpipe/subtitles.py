"""Local subtitle loading and parsing via pysubs2.

Import from local files is the always-available fallback: it needs no provider,
no key and no network. Timestamps and cue identifiers are preserved so evidence
can be traced back to an exact position in the file.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pysubs2

SUPPORTED_SUFFIXES = (".srt", ".vtt", ".ass", ".ssa", ".sub")
MAX_SUBTITLE_BYTES = 1_000_000
MAX_CUES = 10_000

# File name convention: <tmdbId>[.<language>][.<edition>].<ext>
NAME_PATTERN = re.compile(r"^(?P<tmdb>\d{1,10})(?:\.(?P<lang>[A-Za-z]{2,3}))?(?:\.(?P<edition>[A-Za-z0-9_-]{1,40}))?$")

# Positional override tags ({\an8}), HTML-ish tags and speaker dashes, plus the
# music glyph that carries no content meaning.
_TAG_PATTERN = re.compile(r"\{[^}]*\}|<[^>]+>|♪+")


class SubtitleError(RuntimeError):
    pass


@dataclass(frozen=True)
class Cue:
    index: int
    cue_id: str
    start_ms: int
    end_ms: int
    text: str

    def as_dict(self) -> dict:
        return {"cueIndex": self.index, "cueId": self.cue_id, "startMs": self.start_ms, "endMs": self.end_ms, "text": self.text}


@dataclass(frozen=True)
class SubtitleFile:
    path: Path
    sha256: str
    language: str | None
    edition: str | None
    declared_tmdb_id: int | None
    cues: tuple[Cue, ...]

    @property
    def cue_count(self) -> int:
        return len(self.cues)

    def as_dict(self) -> dict:
        return {
            "file": self.path.name,
            "sha256": self.sha256,
            "language": self.language,
            "edition": self.edition,
            "declaredTmdbId": self.declared_tmdb_id,
            "cues": self.cue_count,
        }


def normalize(text: str) -> str:
    """NFC normalise, strip position/formatting tags, collapse whitespace."""
    if not text:
        return ""
    stripped = _TAG_PATTERN.sub(" ", text.replace("\\N", " ").replace("\\n", " "))
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", stripped)).strip()


def parse_name(path: Path) -> tuple[int | None, str | None, str | None]:
    match = NAME_PATTERN.match(path.stem)
    if not match:
        return None, None, None
    return (
        int(match.group("tmdb")) if match.group("tmdb") else None,
        match.group("lang"),
        match.group("edition"),
    )


def _srt_ids(raw: str) -> list[str]:
    """Declared SRT cue numbers, in file order. Empty when the file is not SRT."""
    ids: list[str] = []
    for block in re.split(r"\r?\n\s*\r?\n", raw.strip()):
        lines = [line for line in block.splitlines() if line.strip()]
        if len(lines) >= 2 and re.fullmatch(r"\d+", lines[0].strip()) and "-->" in lines[1]:
            ids.append(lines[0].strip())
    return ids


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_subtitle(path: str | Path, *, language: str | None = None, edition: str | None = None) -> SubtitleFile:
    target = Path(path)
    if not target.is_file():
        raise SubtitleError(f"subtitle not found: {target}")
    if target.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise SubtitleError(f"unsupported subtitle format: {target.suffix}")
    if target.stat().st_size > MAX_SUBTITLE_BYTES:
        raise SubtitleError(f"{target.name} exceeds subtitle size limit")

    try:
        subs = pysubs2.load(str(target))
    except Exception as exc:  # pysubs2 raises a variety of parse errors
        raise SubtitleError(f"could not parse {target.name}: {exc}") from None
    if len(subs) > MAX_CUES:
        raise SubtitleError(f"{target.name} exceeds cue count limit")

    declared = _srt_ids(target.read_text(encoding="utf-8", errors="replace")) if target.suffix.lower() == ".srt" else []
    # Declared ids are only usable when they line up one-for-one with the parsed
    # events. Otherwise every citation after a skipped block would name the wrong
    # cue in the source file, so positional ids are used instead.
    aligned = len(declared) == len(subs)
    cues: list[Cue] = []
    for index, event in enumerate(subs):
        text = normalize(event.text)
        if not text:
            continue
        cue_id = declared[index] if aligned else str(index)
        cues.append(Cue(index=index, cue_id=cue_id, start_ms=int(event.start), end_ms=int(event.end), text=text))

    if not cues:
        raise SubtitleError(f"{target.name} contains no readable cues")

    name_tmdb, name_lang, name_edition = parse_name(target)
    return SubtitleFile(
        path=target,
        sha256=sha256_of(target),
        language=language or name_lang,
        edition=edition or name_edition,
        declared_tmdb_id=name_tmdb,
        cues=tuple(cues),
    )


def discover_subtitles(root: str | Path) -> list[Path]:
    base = Path(root)
    if base.is_file():
        return [base] if base.suffix.lower() in SUPPORTED_SUFFIXES else []
    if not base.is_dir():
        raise SubtitleError(f"not a file or directory: {base}")
    return sorted(p for p in base.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES)
