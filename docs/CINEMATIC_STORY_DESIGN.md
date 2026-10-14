# Triggerboxd cinematic Story card — Luna design specification

## Design intent

Create one 1080 × 1920 (9:16) cinematic poster image for Instagram Stories. The film artwork, typography, family reaction, and warning report should read as one composed poster, not as website UI. Keep the mood warm, premium, playful, and readable. Use only the selected family-awkwardness verdict; the card is not a moral judgment about the film. Never infer awkwardness from LGBTQ+ representation.

No approved visual reference image was supplied with this handoff. The detailed written contract is the design authority; the first rendered screenshots need review against it.

## Canvas and composition

Render once to the existing 1080 × 1920 canvas. That same canvas remains the on-screen preview and the source of the PNG/File used by download and native sharing. Do not build a separate HTML version of the poster. Keep all critical copy inside **x=72–1008 and y=220–1670**. Instagram overlays may cover the outer top 220px and bottom 250px; only background, atmosphere, or nonessential decoration may enter those margins.

The five zones flow together through artwork and gradients; they have no card outlines, section rules, or separate backgrounds:

| Zone | Approximate canvas bounds | Content and treatment |
| --- | --- | --- |
| A · Brand header | y=220–330 | Small Triggerboxd wordmark at left; “SPOILER SAFE” at right; “MOVIE WARNING REPORT” as a small, tracked label below. |
| B · Movie hero | y=300–820 | Full-width TMDb artwork behind the title, year, and optional genres. Title is the strongest element in this zone. Fade the image toward the lower edge. |
| C · Family verdict | y=820–1350 | “WATCH WITH YOUR PARENTS?” then only the selected verdict in expressive large type, followed by the matching family reaction illustration. |
| D · Awkwardness meter | y=1350–1570 | Five compact colored segments, selected number, honest rating source and vote evidence, then a short subjectivity caveat. |
| E · Brand footer | y=1570–1920 | Triggerboxd wordmark, “Know what you’re walking into.”, and triggerboxd.com. Keep all three text baselines at or above y=1670; the rest of this zone is atmospheric background. |

These bounds deliberately move the footer’s readable text above Instagram’s bottom safe area. The zones are compositional guides, not visible containers. The family art may bridge the verdict and meter zones as long as it does not collide with their text.

## Artwork, light, and colour

Use a dark charcoal base across the entire canvas (`#111318`). Place a validated TMDb image behind all foreground content, then layer soft top and lower gradients over it. Keep faces and recognizable artwork visible in the hero. Fade image detail gradually from roughly y=700 through y=1320 into deep charcoal; use a subtle localized dark wash behind title/verdict text only when the art requires it. Never add a visible poster frame, border, rounded thumbnail, or floating image card. Do not stretch an image or heavily blur it.

Choose a portrait poster first for this 9:16 output because it usually preserves more of the supplied composition. Preserve its aspect ratio and align it full-width at the top of the canvas; let the lower fade merge its bottom edge into the charcoal base. If the validated backdrop has a portrait-safe composition and a center crop will not cut its subject, use it for the hero instead. Ordinary landscape backdrops crop severely to 9:16; when that would remove important content, keep the poster. There is no focal-point metadata today, so do not claim automatic face detection or invent per-film crop coordinates. If neither image is safe or loads successfully, use the charcoal base and keep all copy legible.

Sample a small, CORS-readable set of image pixels for a restrained atmospheric accent, then reduce its saturation and brightness so it supports cream text. The accent can tint a soft glow or low-contrast gradient only; the five meter colours remain fixed by rating level. Use a muted, non-orange gold (for example `#D5B875`) only as a fallback when the artwork is missing, grayscale, or inaccessible to pixel sampling. Keep primary copy near cream (`#F7EBD5`) and secondary copy near warm muted gray (`#B9ADA0`). Do not apply an orange filter to every movie.

Load the selected artwork before drawing the final preview/export, using the existing validated TMDb URL path and anonymous CORS behavior. If CORS or loading fails, render the safe no-art variant; never use an unrestricted image proxy. Keep the background full-canvas even when artwork is absent.

## Typography and title fitting

Use at most two existing system families: the current Georgia/serif display face for the film title and verdict, and Arial/Helvetica sans-serif for labels and supporting copy. Wait for `document.fonts.ready` before final rasterization if the renderer uses web fonts; do not add a font dependency for this card.

- Header wordmark: bold sans, about 38px. “SPOILER SAFE”: 20px, medium weight, tracked, subtle ink wash only if needed for contrast.
- Report label: 20px sans, uppercase, letter spacing around 3px.
- Title: 76–112px bold serif, line-height about 1.02, maximum three lines in the 936px safe width. Fit by measuring text and stepping down toward 58px; if it still exceeds three lines, wrap at word boundaries and end the final line with an ellipsis. Never clip.
- Year/genres: 25px sans, with year first; omit unavailable values instead of inventing them. Limit genres to two short names.
- Family question: 34px tracked sans, uppercase.
- Selected verdict: 78–96px bold serif, line-height about 1.05, maximum two lines within 900px. Use a restrained artwork-derived highlight or cream. This is the main punchline and should remain legible at phone size.
- Meter label: 21px tracked sans; rating and evidence: 24–28px sans; caveat and footer copy: 18–22px sans.
- Artwork credit, if needed by the existing TMDb attribution treatment: discreet 15–16px copy near the year/genre line, not in the Instagram-covered footer.

Use measured wrapping for every dynamic string. Do not shrink critical copy below 58px for the title or 72px for the verdict; apply the bounded ellipsis behavior instead. Do not repeat a title as a second headline. Prefer a clean backdrop for the hero where available; when a poster itself has prominent embedded title lettering, keep the metadata title to one restrained treatment rather than printing a competing second title. Do not use OCR or movie-specific hard-coded placement.

## Family reaction assets

Create exactly five reusable original transparent SVGs, one for each established level. Suggested files: `public/story/reactions/level-1-grandma.svg` through `level-5-remote.svg`. Each uses the same `viewBox` (for example `0 0 720 360`), transparent background, shared line weight, warm restrained palette, rounded editorial shapes, soft grounded shadow, and readable expressions at a 300px canvas height. Use no emojis, clipart, photorealism, movie-specific imagery, or generated-per-film scenes. The family is a few adults and an older relative watching television; appearance conveys only the described reaction.

| Level | Existing verdict (source of truth: `signature-questions.ts`) | SVG action |
| --- | --- | --- |
| 1 | “Even grandma can join.” | Relaxed family on a sofa; grandma smiles, tea nearby. |
| 2 | “A few awkward silences.” | Three family members; one uncomfortable glance, one sideways glance, one pretending all is normal. |
| 3 | “Suddenly, WhatsApp looks interesting.” | Family members discreetly looking down at their phones. |
| 4 | “The ceiling fan deserves an Oscar.” | Family members looking dramatically up at an ordinary ceiling fan. |
| 5 | “The remote won't save you.” | Family members reach awkwardly for one remote while avoiding eye contact. |

Place the selected reaction around **x=220–860, y=1045–1345** (about 300px or 16% of canvas height). Keep it visually printed into the artwork with a soft localized light/shadow, never inside a panel. It must not cover the selected verdict. Reuse the same asset in preview and PNG.

When the rating is unknown or too early to publish, do not choose one of these reassuring or comedic level illustrations. Use a quiet neutral “?” motif on the same transparent canvas, paired with the explicit “NOT RATED YET” label. This is the only non-level fallback and must not imply a rating of one.

## Verdict, rating source, and meter

Use the existing five strings and existing `storyLevel` eligibility rules. Do not copy or redefine vote calculations in the component. Personal mode displays the authenticated viewer’s own saved family vote; community mode displays only the existing eligible community result (at least three votes and not provisional). The printed source must say **“MY VERDICT”** or **“COMMUNITY VERDICT”** and match the actual selected data. If the requested source is unavailable, show **“NOT RATED YET”** and neutral meter segments; do not silently substitute the other source or invent counts. If community data is early/provisional, use the existing honest early-results state and no numbered family verdict.

The meter spans x=72–1008 at approximately y=1380. Use five equal segments about 176px wide and 52px high, separated by about 14px. Colours are ordered 1 green (`#4A986C`), 2 yellow (`#D5B84E`), 3 orange (`#E58B43`), 4 red (`#D65C4D`), 5 dark red (`#8D3438`). The selected segment has the strongest fill, a fine cream keyline, and restrained glow; unselected segments stay visibly muted charcoal. Place “3/5” (or the selected value) below the bar at y≈1465, then source and truthful existing vote count around y≈1510. Unknown has no active segment, no `0/5`, and no count. Keep the existing short subjectivity caveat near y≈1550.

Family awkwardness is its own viewer opinion. Do not derive it from sexual content, nudity, sexuality, identity, or any other content-warning category. When sharing a saved warning, continue to pass it through the current spoiler-safety function; protected category, severity, descriptors, notes, timestamps, and user identity must never leak. A “my warning” line is distinct from the family meter and must not relabel a community family rating as personal.

## Brand, accessibility, and fallbacks

There is no Triggerboxd logo asset in `public/`; the existing brand is a text wordmark. Use that exact wordmark instead of inventing a symbol. `public/tmdb-logo.svg` is TMDb’s provider mark, not Triggerboxd’s. Keep the footer small and typographic. Preserve any existing required TMDb artwork attribution in a discreet, readable place above the bottom safe area.

All text and the meter’s selected state must remain understandable without colour. Use explicit rating numbers and source labels. Keep contrast high over every image with gradients or a localized dark wash. The accessible canvas label should name the film, rating source, selected verdict or “Not rated yet,” and any saved-warning state without exposing hidden warning details.

If an SVG or artwork fails to load, cancel stale callbacks and draw a fully usable dark-background card with the selected text and meter. Preview and export must use the same completed draw; prepare the `File` before the share tap so existing native-share activation remains intact. Do not change rating, share, download, or Link-sticker behavior as part of this visual redesign.

## Review checklist

- [ ] Exact 1080 × 1920 output, with preview and exported PNG visually identical.
- [ ] Critical text remains inside x=72–1008, y=220–1670; readable at 320px and 390px phone widths.
- [ ] Poster/backdrop merges into a continuous charcoal gradient with no visible thumbnail edge, border, distortion, or unnecessary face crop.
- [ ] Test dark action, bright romance, colourful animation, minimalist/grayscale, missing backdrop, and a long title.
- [ ] The title and only the selected funny verdict fit without clipping; unknown never receives a reassuring verdict or level illustration.
- [ ] Five reaction SVGs share one style, each clearly depicts its assigned level, and no SVG looks like clipart.
- [ ] Five meter segments use correct fixed level colours and selected number; unknown is neutral and unselected.
- [ ] Personal/community label, actual count, provisional handling, saved-warning privacy, and fallback source are accurate.
- [ ] Missing/CORS-blocked poster and missing SVG still produce a readable, shareable card; no unrestricted proxy is used.
- [ ] Native share, PNG download, and movie-link sticker flow remain available.

