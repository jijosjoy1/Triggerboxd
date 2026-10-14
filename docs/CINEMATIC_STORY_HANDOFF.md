# Cinematic Story card — Sol architecture and Terra handoff

Status: implemented by Sol after explicit user authorization to take over. Luna accepted the revised visual result. Visual specification is in CINEMATIC_STORY_DESIGN.md. No approved reference image was supplied in this request; the detailed written visual contract is authoritative.

## Workspace
- Repository: https://github.com/jijosjoy1/Triggerboxd
- Local: C:/Users/jijos/Documents/Codex/Triggerboxd
- Branch inspected: feat/working-mvp; HEAD 3ef8add. Working tree clean before this planning work. Inspect again before editing; preserve changes.
- Framework: Next.js 16.4, React 19.3, TypeScript, custom CSS, OpenNext Cloudflare. No new renderer service or dependencies required.

## Architecture assessment
- src/components/movie-story.tsx owns preview, image readiness, personal/community state, family-summary retrieval, PNG File preparation and native sharing/download/link sticker flow.
- src/lib/story-card.ts draws the same 1080x1920 canvas used by preview and exported PNG. Keep this single-source rendering; do not introduce a separately styled HTML preview.
- src/lib/signature-questions.ts already owns the five exact funny verdicts. storyLevel preserves provisional/unknown rules; never alter voting calculations or derive family awkwardness from warning categories or LGBTQ+ representation.
- MovieDetail -> MovieShare -> MovieStory and MovieDetail -> QuickContribution -> QuickForm -> MovieStory are both integration paths. Preserve saved-warning spoiler protection.
- MoviePage already loads year and getMoviePresentation loads genres/runtime/India certification through one TMDb detail request. That payload also supports backdrop_path; expose a validated optional backdropPath from that same request. No new TMDb request, database column, or image proxy is needed.
- GET /api/v1/movies/[id]/family-vote returns the authenticated own vote. POST /api/v1/movies/[id]/family-summary is an explicit community-check action. Preserve auth, CSRF and existing reveal semantics.
- Existing image loading uses anonymous CORS before src, an eight-second fallback and stale-load guards. w500 avoids reusing the non-CORS page thumbnail cache. Exported File is prepared before share tap, preserving user activation.

## Minimal dependency-ordered plan
1. Review Luna's design specification, including safe-area bounds and illustration poses.
2. Add exactly five original, cohesive transparent SVG family reactions under frontend public assets (this repo uses public/, not frontend/public/). Existing wordmark is text; reuse it. No new movie scenes, emoji replacements or image-generation-per-movie.
3. Centralize level -> existing verdict, colour, reaction asset mapping. Unknown/early community ratings remain neutral with no family-safe illustration or reassuring verdict.
4. Extend existing presentation metadata and props for year/genres/backdropPath along both Story paths. Keep image utilities restricted to TMDb paths and fixed origins.
5. Replace the cream thumbnail renderer with Luna's continuous full-bleed cinematic composition in story-card.ts. Artwork layer may cover/fade; preserve aspect ratio. Use poster by default for portrait composition and backdrop when its placement suits the hero. No movie-specific positioning or face-recognition assumptions. Keep text legible even if all artwork fails.
6. Preload selected artwork, transparent SVG and any used fonts before canvas export. Use existing/system fonts where possible. Derive restrained accent from CORS-safe image pixels; fall back to brand gold for grayscale/missing art. Do not apply orange to every film.
7. Provide clearly labelled My rating / Community rating controls. Use existing own vote when already loaded; fetch only if needed on opening, and keep community check explicit. Unavailable modes show an honest state. Switching modes must never leave a stale PNG or mislabel a personal vote as community. Keep own-warning text protected in either mode.
8. Keep PNG preparation/download/native share/copy-link intact. Reset state and cancel late callbacks on close, movie changes, mode changes and unmount.
9. Verify six artwork cases and five reactions with separate, explicitly labelled fixture ratings. Never write fixture votes into Supabase or present a sample as a genuine film rating.
10. Luna reviews screenshots before Sol accepts integration. Commit/push/deploy only according to current user authorization after final acceptance.

## Terra execution prompt
You are Terra, implementation and QA, inside Codex. Read AGENTS.md, this handoff and CINEMATIC_STORY_DESIGN.md. Implement only the cinematic Instagram Story card in the existing Triggerboxd repo. Follow the user's detailed visual contract. Reuse canvas export/native sharing/auth/ratings; change no database schema, voting formula, unrelated page or infrastructure. Preserve all uncommitted work. Use current Context7 and bundled Next documentation where relevant. Implement five reusable SVG family reactions, recognizable full-bleed TMDb art with gradual fade, one large humorous verdict, selected five-segment meter, explicit personal/community/unknown evidence, safe margins and compact branded footer. Wire existing year/genres and validated backdrop from the already executed TMDb detail call; preserve both Story entry points and protected warnings. No unrestricted proxy, generated movie imagery, invented counts, LGBTQ-to-awkwardness inference, or automated Instagram publishing. Execute the validation below and provide screenshot paths for Luna review. Do not invoke Astra, DeepSeek or OpenCode. Report blockers rather than replacing the visual direction.

## Acceptance and verification
- Automated: npm test; npm run typecheck; npm run build:worker. Baseline prior completed feature: 105 tests passed.
- Tests: exact 1080x1920 output, centralized five-level mapping, unknown/provisional rules, personal vs community attribution, spoiler-protected payloads, safe URL restrictions, image timeout/error/CORS fallback, stale callbacks, fonts/SVG readiness, export preparation before user gesture and bounded long-title wrapping.
- Browser: preview/export parity; inspect actual PNG; desktop and 320/390px preview; no clipping/overflow/console errors; real save/share controls and mode switching; valid movie URL for Link sticker.
- Visual fixtures: dark action, bright romance, colourful animation, minimalist/grayscale, no backdrop, very long title. Check recognizable art, continuous fade, safe critical text, no competing boxes, legible punchline and consistent family art.
- Physical phone: native share -> Instagram Story handoff requires a real phone; distinguish this from browser tests. Nothing is auto-published.

## Delegation limitation
Codex's available model overrides include gpt-6-luna and Sol variants, but no Terra model. Luna was directly dispatched with gpt-6-luna. Terra is a manual handoff, not a silently relabelled Sol agent. The user subsequently authorized Sol to implement directly; product code and integration are now completed. This paragraph records why initial Terra delegation was unavailable.

## Sol integration review of Luna specification
- Reviewed the complete Luna spec: five 176px meter segments plus four 14px gaps fit the 936px safe width; footer text must finish by y=1670. Artwork and five SVGs remain reusable and the same canvas is the PNG source.
- Reserve a measured own-warning text slot above the family question (within y=770–820), without increasing disclosure. Fit title/metadata earlier in the hero when this slot is present; never push the verdict or footer out of the safe area. Protected warnings retain generic text.
- Do not automatically choose a backdrop by aspect ratio alone: use a consistent artwork-choice option if needed, defaulting to portrait poster when landscape cropping is destructive. Do not claim face detection.
- A neutral unknown motif can be drawn directly, so the asset set stays exactly five SVGs.
- Unavailable reference image and unavailable Terra model are explicit constraints. Luna accepted the final implementation screenshots after header contrast, compact-title and unknown-state refinements. Physical-phone Instagram handoff remains unverified.
