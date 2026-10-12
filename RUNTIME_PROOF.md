# T1 runtime proof — 2026-10-12

**Local runtime proof passes with an explicit adapter compatibility patch. Deployment remains unverified.** The exact app versions did not need changing. The unmodified adapter builds successfully but fails at runtime; the required patch and its evidence are below. Linux build and Cloudflare CPU checks remain release gates.

## Isolation and scope

Scratch: `C:/Users/jijos/Documents/Codex/Triggerboxd-runtime-proof`.

Copied the repository's tracked source/configuration plus MVP_DESIGN.md/MVP_TASKS.md, including the existing privacy edit. Did not copy `.git`, node_modules, out or .next. No branches, worktrees, commits, pushes, deployments, remote provisioning, paid services or provider credentials were used. This task's only change in the original repository is this report; other implementation work may concurrently change that repository. The original next.config.ts and wrangler.jsonc were untouched by this task.

This bounded proof adds a scratch-only `/api/runtime-proof/` GET/POST endpoint. It demonstrates request-dependent cookies, not real authentication. It must not be shipped as an account endpoint.

## Tested versions

| Component | Exact version | Evidence |
| --- | --- | --- |
| Node.js | 24.21.0 | `node --version` |
| npm | 11.19.0 | `npm --version` |
| Next.js | 16.4.0 | Original manifest, lockfile, installed package and `npm view next@16.4.0 version` agree |
| React / React DOM | 19.3.0 | Original manifest/lock/install; React registry lookup succeeds |
| TypeScript | 5.9.3 | Scratch installed lockfile |
| @opennextjs/cloudflare | 1.20.9 | Explicit pin; peer accepts Next `>=16.3.8` |
| @opennextjs/aws | 4.1.8 | Adapter's pinned transitive dependency |
| Wrangler | 4.149.0 | Explicit pin; Node >=22 |
| workerd | 1.20261006.1 | Wrangler's installed lockfile |

Registry check also found `@supabase/ssr@0.12.7` requires `@supabase/supabase-js@^2.114.0`; current `supabase-js@2.117.3` requires Node >=22. They were not installed in this minimal runtime proof. Their auth/session integration needs separate verification.

## Compatibility failure and required patch

Unmodified OpenNext 1.20.9 completed its build. Local workerd then failed 8/9 HTTP tests with:

```text
Unexpected loadManifest(/.next/server/preview-props.json) call!
```

Only the public PNG passed. Next 16.4's `NextNodeServer.getPreviewProps` loads PREVIEW_PROPS_MANIFEST; `.next/required-server-files.json` includes that file. The adapter's `inlineLoadManifest` glob excludes it. Inspecting the npm-packed latest adapter 1.20.10 confirmed the same omission, so simply upgrading does not resolve it.

Scratch [scripts/patch-opennext-preview-props.mjs](C:/Users/jijos/Documents/Codex/Triggerboxd-runtime-proof/scripts/patch-opennext-preview-props.mjs) adds `preview-props` to the adapter's manifest glob. It asserts adapter version 1.20.9, asserts exactly one expected source pattern and is idempotent. Both postinstall and build:worker run it. No generated output was hand-edited; the Worker was rebuilt from source after this patch.

Pin 1.20.9 intentionally: latest 1.20.10 brought four npm audit high findings through `@opennextjs/aws` → `@node-minify/core` → glob CLI command injection ([GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2)). This is a build-tool advisory; it is not evidence of a production endpoint vulnerability. The chosen 1.20.9 dependency graph reports **0 vulnerabilities**. No broad audit fix or force update was run. npm still emits deprecated glob/node-domexception warnings and unapproved install-script notices; the installed esbuild/workerd binaries successfully built and ran.

This is a maintained compatibility patch, not upstream support proof. Review/remove it when upgrading the adapter; the version guard deliberately stops unknown versions. Prefer a future officially fixed adapter over widening the patch.

## Checks and results

| Check | Result | Scratch evidence |
| --- | --- | --- |
| Baseline HTTP test before endpoint | Expected fail: 8 pass / 1 fail; GET returned 404 | runtime-smoke-red.log |
| `npm run typecheck` | Exit 0 | runtime-typecheck-final.log |
| `npm run build` | Exit 0; marketing prerendered, proof API dynamic | runtime-next-build.log |
| `npm ci` from scratch lockfile | Exit 0, postinstall hook runs, audit 0 | runtime-fresh-install.log |
| `npm run build:worker` with patch | Exit 0 after fresh install | runtime-opennext-build-final.log |
| HTTP smoke against Next dev | 9 pass / 0 fail | runtime-smoke-next.log |
| HTTP smoke against rebuilt local workerd | 9 pass / 0 fail | runtime-smoke-workerd-final.log |
| `npm run size:worker` | Exit 0, dry run only | runtime-worker-size-final.log |

HTTP smoke verifies GET without cookie returns null; POST sets HttpOnly/SameSite=Lax cookie; subsequent GET reads the value; a separate cookie-free request remains null; personalized responses are private/no-store. It also checks `/`, `/about/`, `/privacy/`, `/demo/`, PNG, robots, sitemap and a real 404. This is HTTP integration, not browser/physical-device/OAuth testing. The Node built-in runner avoids a duplicative testing dependency; real DB and browser suites belong to their later tasks.

## Bundle and free-tier gate

Final Wrangler dry run:

```text
Total Upload: 5283.94 KiB / gzip: 1105.68 KiB
--dry-run: exiting now.
```

The gzip bundle is **1.080 MiB**, below the plan's conservative **3 MiB** target by about **1.920 MiB**. This is the minimal runtime proof, not the completed auth/database app; remeasure after integration.

Current official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) now specify **64 MiB uncompressed**, with no compressed-size limit, for Free and Paid. The measured uncompressed bundle is approximately **5.160 MiB**. The earlier plan's 3 MiB provider claim is stale, although this proof passes that stricter project target too. Free still has 100,000 requests/day and 10 ms CPU per HTTP request. Local wall times and laptop CPU profiles cannot prove that CPU gate; authorized staging must inspect actual Cloudflare invocation CPU, including cold/warm SSR/auth requests and errors.

Config uses compatibility date 2026-10-11, `nodejs_compat`, `global_fetch_strictly_public`, ASSETS and WORKER_SELF_REFERENCE only. No R2, KV, D1, image optimization, queues, cron or paid-only binding was configured.

## Reproduce in scratch

PowerShell, from the scratch directory:

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_LOG_PATH = "$PWD/logs"
npm ci
npm run typecheck
npm run build
npm run build:worker
npm run size:worker
npm run preview:worker
```

In a second terminal:

```powershell
$env:RUNTIME_BASE_URL = 'http://127.0.0.1:3108'
npm run test:runtime
```

Stop dev/preview watchers before rebuilding on Windows to avoid file-handle locks. This environment's sandbox rejected esbuild's ancestor-directory traversal and Wrangler's default roaming log path; local commands were rerun with approved host execution, logs in scratch and telemetry disabled. These were filesystem restrictions, not deployment or credential requirements.

## Migration edits and outstanding gates

For continued local integration, carry over the pinned adapter/Wrangler dependencies and lockfile, guarded patch script/postinstall/build:worker, `open-next.config.ts` using `defineCloudflareConfig()`, and the OpenNext Wrangler main/assets/flags/self-reference config. Remove `output: 'export'` only as the accepted runtime migration; retain trailingSlash and unoptimized images. Use actual Worker identity only after reconciling preview/live names. Do not copy scratch's proof endpoint or scratch Worker name into production.

- **Linux build not verified:** WSL lists only docker-desktop; it has no Linux node. Its embedded Docker CLI explicitly refuses invocation there; Windows Docker CLI was unavailable. No distribution/image was installed or downloaded. OpenNext documents qualified [Windows support](https://opennext.js.org/cloudflare#windowssupport); repeat lockfile build/smoke on Linux CI/WSL before release.
- **Staging not authorized/performed:** no 10 ms Cloudflare CPU, real Google callback/redirect, Supabase session refresh, confirmed email/reset delivery, provider identity handling, live domain routing or production quota proof.
- **HTTP privacy proof only:** generic private/no-store cookies work in adapter output; this does not prove Supabase refresh-cookie propagation or real auth cache isolation.
- **Outbound integrations absent:** no secrets, TMDb calls, database mutations or OAuth provider operations were exercised.

If final integration or staging fails Free CPU/size, return the measured evidence and propose keeping the existing static Next shell with a small same-origin Worker API. That fallback sacrifices request-rendered movie SEO and changes auth integration. It was not implemented in parallel, and no architecture switch is inferred from this local proof.

Docs consulted through Context7: [OpenNext setup](https://opennext.js.org/cloudflare/get-started), [Next cookies](https://nextjs.org/docs/app/api-reference/functions/cookies), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Next16.4's bundled cookies/route documentation was also inspected. Official limits and OpenNext compatibility/Windows statements were independently checked on the live official pages.
