# Notes and scene reports: owner runbook

Phase 3 owner operations run in Supabase SQL Editor as the trusted database owner,
not through a browser client, application secret, or public moderator role. Do not
grant table access to `anon`, `authenticated`, `service_role` or user-editable claims.
The narrow writer can create reports but cannot insert operator audit events.

## Inspect an open report

```sql
select r.id as report_id, r.note_id, r.target_revision, r.reason, r.correction,
       r.created_at, n.movie_id, n.category_slug, n.comment, n.start_seconds,
       n.end_seconds, n.version, n.spoiler_level, n.severity,
       n.revision as current_revision, n.visibility
from private.note_reports r
join private.movie_notes n on n.id = r.note_id
where r.status = 'open'
order by r.created_at, r.id
limit 50;
```

This result includes private corrections and potentially spoilers. Keep it inside
the owner tooling; never copy it into logs, public pages, support screenshots or
share cards. If current and target revisions differ, inspect the current text
before hiding it. Reports do not automatically hide notes or establish truth.

## Hide or restore a note atomically

Replace the UUID, expected revision, operator reference and reason below. Change
`action_name` to `restore` for a verified restoration. An explicit note lock and
expected revision prevent action on a concurrently edited entry. A deleted entry
cannot be restored. Moderation advances the shared revision so stale clients
cannot silently overwrite it. Audit records contain identifiers and reasons,
never a copy of the comment or correction.

```sql
begin;
do $$
declare
  target_id uuid := 'REPLACE-WITH-NOTE-UUID';
  expected_revision bigint := 0; -- replace with inspected current_revision
  action_name text := 'hide'; -- hide or restore
  operator_ref text := 'owner';
  reason_text text := 'REPLACE-WITH-PRIVATE-REASON';
  n private.movie_notes%rowtype;
begin
  if action_name not in ('hide','restore') then raise exception 'INVALID_ACTION'; end if;
  select * into n from private.movie_notes where id=target_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  if n.revision <> expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  if n.visibility='deleted' then raise exception 'NOTE_DELETED'; end if;
  update private.movie_notes
  set visibility=case action_name when 'hide' then 'hidden' else 'active' end,
      revision=nextval('private.contribution_revision'),
      updated_at=statement_timestamp()
  where id=target_id;
  insert into private.note_operator_actions
    (operator_reference,note_id,action,reason,target_revision)
  values(operator_ref,target_id,action_name,reason_text,expected_revision);
end $$;
commit;
```

Hidden notes immediately stop influencing category spoiler maxima and public
timelines. They remain inaccessible to author edits, including attempts to
recreate the same UUID. Restoration immediately restores their disclosure policy.

## Resolve or dismiss a report

Hiding/restoring a note and resolving a report are distinct decisions. Replace the
report UUID and the inspected target revision below. Resolve marks the report
actioned; dismiss marks it rejected. Never edit somebody's factual warning or
publish their proposed correction as a side effect.

```sql
begin;
do $$
declare
  target_report uuid := 'REPLACE-WITH-REPORT-UUID';
  expected_target_revision bigint := 0;
  outcome text := 'resolve'; -- resolve or dismiss
  operator_ref text := 'owner';
  reason_text text := 'REPLACE-WITH-PRIVATE-REASON';
  r private.note_reports%rowtype;
begin
  if outcome not in ('resolve','dismiss') then raise exception 'INVALID_ACTION'; end if;
  select * into r from private.note_reports where id=target_report for update;
  if not found or r.status<>'open' then raise exception 'REPORT_NOT_OPEN'; end if;
  if r.target_revision<>expected_target_revision then raise exception 'REVISION_CONFLICT'; end if;
  update private.note_reports
  set status=case outcome when 'resolve' then 'resolved' else 'dismissed' end,
      resolved_at=statement_timestamp()
  where id=target_report;
  insert into private.note_operator_actions
    (operator_reference,note_id,report_id,action,reason,target_revision)
  values(operator_ref,r.note_id,target_report,outcome,reason_text,r.target_revision);
end $$;
commit;
```

## Contracts and retention

- `get_movie_notes(movie,categories,level,limit,offset)` returns only visible
  notes and a visible-only `nextOffset`. No hidden count/presence indicator.
- Effective category disclosure is the maximum of active authors' note and rating
  spoiler levels. Level 1 retains category/explicit severity and masks prose,
  version and timestamps; level 2 omits the whole category until selected reveal.
- Own-note reads require an active, verified actor and must remain `no-store`.
- `put_movie_note` requires UUID, expected revision, watched confirmation,
  category, optional plaintext <=280 characters, optional times 0..86400,
  version <=80, spoiler level 0..2, idempotency key and optional severity 0..3.
  At least prose or a start timestamp is required; unanswered severity is null.
- PUT/DELETE/report reuse actor locking and bounded contribution quotas.
- Twenty active notes per actor/movie prevents unbounded per-film writes.
- DELETE creates a private tombstone to prevent UUID/revision reuse and retain
  report history. Account deletion removes notes and associated private reports;
  audit foreign keys become null, preserving non-text operational evidence.
- No report auto-publishing, public moderator/self-role or confirmation votes.
- Local migration/tests are distinct from hosted application. Apply the migration
  before enabling the client on a hosted environment; inspect role grants/advisors.

## Local checks

`npm run test:db` applies every migration to embedded PostgreSQL and runs
transaction-isolated fixtures. It uses no live credentials and creates no public
ratings. Physical-device behavior and a real hosted multi-user flow require
separate verification.
