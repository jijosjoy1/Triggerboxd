# Triggerboxd draft-warning pipeline

Standalone, **manually launched** pipeline that finds recent OTT releases in
India, pulls matching subtitles, analyses them, and writes **private draft**
content warnings for human review.

It is deliberately independent of the Next.js app: it never writes to the
Triggerboxd database, never touches community aggregation, and never publishes.
"Final draft" means processing finished, not that a warning is verified.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | OTT discovery + verification + skipped list + report | **implemented, tested, run live** |
| 2 | Local subtitle import, `pysubs2` parse, offline rules, drafts | **implemented, 65 tests** |
| 3 | SubDL adapter under quota + terms | **implemented, verified with a real download** |
| 3b | OpenSubtitles adapter | **implemented, verified with a real download** |
| 4 | Included-model comparison | **implemented, run live against a real subtitle** |

## Run it

```powershell
cd pipeline
.\.venv\Scripts\python.exe run_last_week.py               # previous 7 complete days, cap 10
.\.venv\Scripts\python.exe run_last_week.py --limit 3 --dry-run
.\.venv\Scripts\python.exe run_last_week.py --window 2026-10-01 2026-10-07

# Phase 2: analyse subtitle files you already have (no provider, no key, no model)
.\.venv\Scripts\python.exe run_local.py --subtitles .\subs
.\.venv\Scripts\python.exe run_local.py --subtitles .\subs --index .\out\2026-10-09_2026-10-15\index.json

.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
```

Put subtitle files in `pipeline/subs/` (gitignored). File names may carry identity:
`<tmdbId>[.<lang>][.<edition>].<ext>` - e.g. `1422822.en.srt` - and `--index` links
them to a discovery run so the draft inherits the verified OTT date and platform.

Python 3.14 with `pysubs2` and `tzdata` (for `Asia/Kolkata` on Windows). Create
the environment with `python -m venv .venv` then
`.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.

## What phase 1 actually guarantees

- The window is the previous **7 complete days in Asia/Kolkata**; the day in
  progress is excluded, so a 09:00 and a 23:00 run cover the same range. Exact
  start/end are recorded in every report and every draft.
- **A TMDB primary release date, or a current provider listing, is not accepted
  as an OTT premiere.** Only a dated Digital release (`release_dates` type 4 for
  the territory) inside the window verifies a movie.
- Anything else is skipped **with a reason** rather than treated as a premiere:
  `theatrical_only_in_window`, `digital_release_outside_window`,
  `provider_listing_without_dated_digital_release`, `region_not_listed`,
  `no_digital_release_found`, `lookup_failed`.
- Deduplicates by TMDB id across the language passes. Series are excluded
  (`/discover/movie`). Default cap: 10 verified movies.
- Language priority: `ml, ta, te, hi, en`.

Because the run stops as soon as the cap is reached, the skipped list only
covers candidates examined up to that point.

## Phase 2: offline classification

`run_local.py` is the baseline and the fallback. It needs no provider, no key, no
model, no network and no GPU.

- Parses SRT/VTT/ASS/SSA through `pysubs2`, **preserving declared SRT cue numbers
  and millisecond timestamps**, and records the file's SHA-256.
- Normalises text (NFC, strips `{\an8}`-style tags, HTML, music glyphs) and drops
  cues with no readable content.
- Applies versioned phrase/context rules from `rules/lexicon.v1.json`. Each rule
  can require nearby context or suppress itself on a disqualifying phrase, which
  is how "a bar of soap" avoids being read as a drinking venue and
  "you're killing me" avoids being read as violence.
- Records the rules version in every draft so a result is reproducible.

The lexicon is a **hand-curated English seed, not a complete classifier**. It has
no Malayalam, Tamil, Telugu or Hindi vocabulary yet (those need a normalisation
and tokenisation pass first), and no LDNOOBW list is bundled. Both are stated in
the draft's `limitations` rather than hidden.

## Drafts

`drafts` use the existing Triggerboxd category identifiers (13 slugs). Every
category starts as `{state: "unknown", severity: null}` with empty evidence:
the pipeline **never asserts a severity** - that requires human review. Missing
evidence is recorded as unknown, never as absence. Visual-only categories
(`nudity`, `gore_graphic_violence`, `graphic_violence`) are always `unknown`
because subtitle text cannot establish them, and that reason is written into the
draft.

Each analysed draft also carries a separate `familyAwkwardnessEstimate`. This is
a provisional 1-5 estimate of **dialogue awkwardness**, not a content-warning
severity or community vote. It weighs unique subtitle cues for mild/strong
profanity, slurs, sexual content and sexual-violence references. Profanity alone
is capped at 3/5; levels 4-5 require stronger family-sensitive dialogue. A file
with no matching dialogue stays unrated rather than being labelled safe. Visual
coverage always remains `unknown`, and the factors, points, rule version and
limitations are stored so a reviewer can audit the result.

A category with a hit becomes `state: "candidate"` carrying private,
timestamped evidence capped at 40 hits per category:

```
sexual_violence   severity=null  evidence=1  cue 6 @16000ms  'raped'     (sv-1)
drugs             severity=null  evidence=1  cue 5 @13000ms  'overdosed' (drg-2)
alcohol           severity=null  evidence=2  cue 2 @4000ms   'beer'      (alc-1)
```

## Phase 3: eligible subtitle fetching (SubDL)

`run_fetch.py` takes verified releases from a Phase 1 run (or `--movie <tmdbId>`),
finds a matching subtitle, downloads it inside the provider's allowance, validates
that it parses, and optionally runs the offline classifier.

Before anything is downloaded the **movie identity must be verified**: the search
has to resolve to a single title whose TMDB/IMDb id matches the request.
Selection is deterministic and reported - it prefers a digital/web release name
over a camera source, prefers a non-hearing-impaired copy, and records why it
chose what it chose. Anything else is skipped with a reason
(`ambiguous_movie_results`, `movie_id_mismatch`, `no_subtitle_in_language`,
`download_failed`, `unreadable_subtitle`, `download_allowance_nearly_exhausted`).

Three things learned from the live API and encoded in the adapter:

1. **The response echoes your API key inside each subtitle `url`**
   (`/subtitle/1-2.zip?api_key=...`). The adapter strips it immediately, so no
   artefact, report or state file ever contains the key. Verified by scanning
   `out/` and `state.sqlite`.
2. **`hi=1` does the opposite of the documentation.** The contract says it adds
   the hearing-impaired flag; in practice it *filters* the result set to
   hearing-impaired uploads only (observed: 23 results to 0). It is never sent.
3. Downloads go to `dl.subdl.com` **without** the key, so they use the provider's
   anonymous per-IP allowance rather than a paid account quota.

Allowances are counted separately per provider and action, per day, in
`state.sqlite`: search and download counters are independent, and a run stops
short of the ceiling (1900 of 2000 searches, 250 of 300 downloads) rather than
exhausting the account.

`release_name` describes the *video* release, not the subtitle language - a
"HINDI WEBRip" release can still ship English subtitles, so the `language` field
is authoritative. Ad-hoc `--movie` runs have no title metadata because no TMDB
lookup is made on that path; use `--index` for fully populated drafts.

## Credentials

Read from the environment first, then from the repository `.env.local`. Values
are never printed, logged, or written into artefacts.

| Variable | Needed for | Have it? |
|---|---|---|
| `TMDB_READ_ACCESS_TOKEN` | discovery (phase 1) | **yes - verified live** |
| `SUBDL_API_KEY` | subtitle search/download (phase 3) | **yes - stored in `.env.local`, verified live** |
| `OPENSUBTITLES_API_KEY` | subtitle search/download (phase 3b) | **yes - stored in `.env.local`, verified live** |
| `OPENSUBTITLES_USERNAME` / `_PASSWORD` | account-quota downloads | **optional - not needed, anonymous downloads are enabled** |

## Phase 3b: OpenSubtitles

`run_fetch.py --provider opensubtitles` (the default) searches by TMDB id, verifies
the returned feature matches, selects deterministically, and downloads.

Facts established against the live API and encoded in the adapter:

1. **Two credentials, only one required.** `Api-Key` (the consumer key)
   authenticates the *application* and is needed on every request. A login token
   authenticates the *user* and only changes whose download allowance is spent.
   Anonymous downloads are enabled for this key, so **no password is needed** -
   the adapter calls `/login` only when username and password are both present.
2. **A descriptive `User-Agent` is mandatory.** A generic or library default gets
   `403 User agent required`.
3. **Query parameters must be canonical:** alphabetical, lowercased values, empty
   values dropped, and IMDb ids **without** the `tt` prefix.
4. **The `/download` response contains a one-time `link` with an embedded
   secret.** It is fetched immediately and never stored - confirmed by scanning
   `out/`, `subs/` and `state.sqlite` for both keys and the download host.
5. **The search response does not echo the API key** (unlike SubDL), but tokens
   are still cached for their 24 hour life rather than re-logging each run,
   because login is rate limited to 1 request per second.

Selection prefers a trusted, non-machine-translated upload with the most
downloads, and never picks a `foreign_parts_only` copy while a complete one
exists. The reason is recorded on every draft.

## Phase 4: included-model comparison

`run_compare.py` runs the rules engine and an included model over the same
subtitle and reports where they agree and disagree. The offline engine stays the
baseline; if the model route is unavailable the run degrades to offline-only and
says so.

**Only models on the free/included allowlist are callable**
(`deepseek-v4.1-flash`, `deepseek-v4-flash`, `glm-5.3-flash`, `mimo-v2.6-flash`).
A paid or unknown model name raises rather than falling back, so there is no path
to a paid model and no paid fallback.

Guardrails:

- Cue ids and timestamps are never rewritten; each finding cites the cue it came from.
- The reply must be schema-valid JSON. Prose, wrong shapes and empty replies are refused.
- **Every reference is verified against real cue text.** A finding whose quote is
  not found in the cue it cites is rejected as fabricated, as are unknown
  categories and unknown cue ids. Rejections are counted, never silently dropped.
- Token usage is measured per chunk and written to `state.sqlite`; a run stops
  when the budget is reached rather than continuing blind.
- One unusable chunk does not discard the run. Failures are counted and reported;
  the run only aborts if *every* chunk fails.

Two facts learned by running it against the live model:

1. **Reasoning consumes the output budget before the answer.** At 40 cues with
   `max_tokens=1200` the model returned `stop_reason=max_tokens` and an *empty*
   string - nothing to parse. At 25 cues with 2000 tokens it answers normally.
   Both the smaller window and the larger budget are required.
2. Chunks still truncate occasionally, which is exactly why per-chunk isolation
   exists rather than all-or-nothing parsing.

Real run against the RRR subtitle (`--budget 40000`):

```
offline : disturbing_content=1  language=19  physical_violence=24  horror=1
model   : animal_harm=1  disturbing_content=1  language=5  physical_violence=13
agree   : disturbing_content, language, physical_violence
offline-only: horror
model-only  : animal_harm
tokens 40592 | chunks 24 | failed 8 | rejected 0 | stopped token_budget_reached
```

The model caught real animal harm the English lexicon has no rule for
(`"he will break its teeth, pry its jaws open and take the lamb back to its herd"`),
and nothing it returned failed quote verification.

The models are used here for non-coding inference, which is permitted for this
pipeline; the request is not disguised as coding-agent traffic.

Classification uses the models already included in the account through the local
codex-router; that needs **no new API key**. Paid fallback is disabled.

## Output

```
pipeline/out/<start>_<end>/index.json    # machine-readable run
pipeline/out/<start>_<end>/report.md     # human review
pipeline/state.sqlite                    # run history, retry state, quota counters
```

`out/` and `state.sqlite` are gitignored.

## Non-goals for this pilot

No recurring schedule. No automatic publication. No fabricated contributors,
votes or watched claims. No pooled provider keys or account rotation. No use of
a separately billed API.
