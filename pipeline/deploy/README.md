# Private subtitle worker pilot

This template is not installed or enabled automatically. Inspect the existing GCP
instance's CPU, memory, free disk and billing first; the service has not been
verified on that instance. Do not interrupt the Keralamemeverse workload.

Deploy the internal authenticated job API and its migration first. Copy only the
Python pipeline code and rules to `/opt/triggerboxd-pipeline`; do not copy app
environment files, saved provider responses, `.env.local`, or review outputs.
Use an isolated Python virtual environment with the existing requirements file.
Create the dedicated non-login `triggerboxd-worker` user and give it ownership of
the pipeline directory. Code may be root-owned with narrowly writable cache and
SQLite files once provisioned; the initial template allows pipeline-local writes.

An administrator must create `/etc/triggerboxd-pipeline.env` (root-owned, mode 600):

```text
TRIGGERBOXD_PIPELINE_ORIGIN=https://triggerboxd.com
TRIGGERBOXD_PIPELINE_TOKEN=<dedicated worker token, never a user session>
SUBDL_API_KEY=<existing provider key>
```

Set the same dedicated token securely in the app server. Never paste keys into
commands, Git, screenshots or logs. OpenSubtitles is optional if its API key and
credentials are separately configured and the service's provider argument is
changed. The worker uses the existing atomic daily provider quota counters.
These counters only cover processes sharing this pipeline's `state.sqlite`;
usage on other machines or devices is not included. Provider enforcement may be
stricter. Copy no credential-bearing SQLite data from unrelated applications.

Manually run `run_worker.py --once --provider subdl` under the service environment
for a smoke test before enabling the service. Install the service file only after
checking its absolute paths, resource limits and isolation on the target VM.
The worker opens no listening port and consumes one job at a time. Polls are 60
seconds apart. HTTPS redirects are refused. It uses Python rules exclusively.

Existing matching English files in `subs/` are reused before any provider call.
Worker downloads go into `worker-cache/` (at most 100 files of up to 1 MB each,
retained for seven days and pruned on each poll). Manual `subs/` files and private
draft outputs are never deleted. Remote results contain only ratings, factor
counts, versions, hash, language and cue count; subtitle text and excerpts stay
local. The process logs only fixed status names, never remote error bodies.

The worker holds a local SQLite write lease for its whole job. The server issues
a 30-minute job lease. If completion delivery is uncertain, the worker leaves the
lease to expire instead of sending a conflicting failure. It reuses cached
subtitles on a retry. No heartbeat is required for bounded single-movie jobs.
Provider calls are sequential and bounded by their existing adapter timeouts.
Review evidence is not uploaded in this pilot; moderators must independently
watch the movie. A score with no matched evidence remains null.

Do not share the service environment with the public web app or other services.
Monitor memory and disk after enabling. Stop the service if capacity is insufficient;
this template does not promise free hosting or provider access.
