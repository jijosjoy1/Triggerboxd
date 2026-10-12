-- Launch only: no notes, reports, public contributor identities, or moderator roles.
-- Apply through the Supabase migration role, never a browser/service client.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
create role triggerboxd_writer nologin noinherit nobypassrls;
create role triggerboxd_reader nologin noinherit nobypassrls;
grant triggerboxd_writer, triggerboxd_reader to postgres;
grant usage, create on schema private, public to triggerboxd_writer, triggerboxd_reader;
grant usage on schema auth to triggerboxd_writer;
grant execute on function auth.uid() to triggerboxd_writer;
grant select (id, email_confirmed_at, is_anonymous) on auth.users to triggerboxd_writer;
-- Do not leave future functions callable by PUBLIC by default.
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);
create table private.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  revision bigint not null default 1 check (revision > 0),
  changed_at timestamptz not null default now()
);
create table public.movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id bigint not null unique check (tmdb_id between 1 and 9007199254740991),
  title text not null check (char_length(title) between 1 and 300),
  original_title text not null check (char_length(original_title) between 1 and 300),
  release_date date,
  original_language text check (original_language is null or original_language ~ '^[a-z]{2,3}$'),
  production_countries text[] not null default '{}' check (cardinality(production_countries) <= 50),
  poster_path text check (poster_path is null or poster_path ~ '^/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$'),
  synopsis text check (synopsis is null or char_length(synopsis) <= 10000),
  metadata_fetched_at timestamptz not null default now(),
  visibility text not null default 'published' check (visibility in ('published', 'hidden')),
  created_at timestamptz not null default now()
);
create table public.warning_categories (
  slug text primary key,
  label text not null,
  guidance text not null,
  sort_order smallint not null unique check (sort_order between 1 and 6)
);
insert into public.warning_categories (slug, label, guidance, sort_order) values
  ('nudity', 'Nudity', 'Exposed bodies; assess presentation and detail.', 1),
  ('sexual_content', 'Sexual content', 'Sexual activity; distinguish it from coercion or assault.', 2),
  ('sexual_violence', 'Sexual violence', 'Threats, coercion or assault. Severity describes presentation, not the seriousness of harm.', 3),
  ('gore_graphic_violence', 'Gore / graphic violence', 'Visible injury, blood and graphic violence.', 4),
  ('disturbing_content', 'Disturbing content', 'Intense distress outside the other listed categories.', 5),
  ('suicide_self_harm', 'Suicide / self-harm', 'References or depictions. Severity describes presentation, not the seriousness of harm.', 6);
-- Global increasing revisions prevent a stale revision matching a recreated contribution.
create sequence private.contribution_revision as bigint maxvalue 9007199254740991;
create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete restrict,
  revision bigint not null check (revision between 1 and 9007199254740991),
  watched boolean not null check (watched),
  visibility text not null default 'active' check (visibility in ('active', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, movie_id)
);
create index contributions_movie_eligible_idx on public.contributions(movie_id, visibility);
create table public.category_ratings (
  contribution_id uuid not null references public.contributions(id) on delete cascade,
  category_slug text not null references public.warning_categories(slug) on delete restrict,
  severity smallint not null check (severity between 0 and 3),
  primary key (contribution_id, category_slug)
);
create index ratings_category_contribution_idx on public.category_ratings(category_slug, contribution_id);
create table private.request_buckets (
  action text not null check (action in ('contribution', 'import', 'search')),
  subject_hash text not null check (char_length(subject_hash) between 1 and 64),
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds in (60, 86400)),
  count integer not null check (count > 0),
  expires_at timestamptz not null,
  primary key (action, subject_hash, window_start, window_seconds)
);
create index request_buckets_expiry_idx on private.request_buckets(expires_at);
create table private.idempotency_keys (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('put', 'delete', 'import')),
  key text not null check (key ~ '^[A-Za-z0-9_-]{8,128}$'),
  body jsonb not null,
  response jsonb not null,
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (actor_id, operation, key)
);
create index idempotency_expiry_idx on private.idempotency_keys(expires_at);
create table private.operator_actions (
  id uuid primary key default gen_random_uuid(),
  operator_reference text not null check (char_length(operator_reference) between 1 and 100),
  target_user_id uuid references auth.users(id) on delete set null,
  target_movie_id uuid references public.movies(id) on delete set null,
  action text not null check (action in ('suspend_account', 'restore_account', 'hide_contribution', 'restore_contribution', 'hide_movie', 'restore_movie', 'delete_account')),
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now()
);
create index operator_actions_user_idx on private.operator_actions(target_user_id);
create index operator_actions_movie_idx on private.operator_actions(target_movie_id);

alter table public.profiles enable row level security;
alter table public.movies enable row level security;
alter table public.warning_categories enable row level security;
alter table public.contributions enable row level security;
alter table public.category_ratings enable row level security;
alter table private.user_access enable row level security;
alter table private.request_buckets enable row level security;
alter table private.idempotency_keys enable row level security;
alter table private.operator_actions enable row level security;
-- Clear inherited/default API table grants before granting intended reads.
revoke all on public.profiles, public.movies, public.warning_categories, public.contributions,
  public.category_ratings from public, anon, authenticated, service_role;
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
grant select on public.movies, public.warning_categories to anon, authenticated;
grant select on public.profiles, public.contributions, public.category_ratings to authenticated;
create policy movies_published on public.movies for select to anon, authenticated using (visibility = 'published');
create policy categories_public on public.warning_categories for select to anon, authenticated using (true);
create policy profiles_owned on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy contributions_owned on public.contributions for select to authenticated using (user_id = (select auth.uid()));
create policy ratings_owned on public.category_ratings for select to authenticated using (exists (
  select 1 from public.contributions c where c.id = contribution_id and c.user_id = (select auth.uid())
));
grant select, insert on public.profiles, private.user_access to triggerboxd_writer;
grant select, insert, update on public.movies to triggerboxd_writer;
grant select on public.warning_categories to triggerboxd_writer;
grant select, insert, update, delete on public.contributions, public.category_ratings,
  private.request_buckets, private.idempotency_keys to triggerboxd_writer;
grant usage on sequence private.contribution_revision to triggerboxd_writer;
grant select on public.movies, public.warning_categories, public.contributions, public.category_ratings,
  private.user_access to triggerboxd_reader;
create policy profiles_internal on public.profiles to triggerboxd_writer using (true) with check (true);
create policy access_internal on private.user_access for select to triggerboxd_writer, triggerboxd_reader using (true);
create policy access_initialize on private.user_access for insert to triggerboxd_writer with check (true);
create policy movies_internal on public.movies to triggerboxd_writer using (true) with check (true);
create policy movies_summary on public.movies for select to triggerboxd_reader using (visibility = 'published');
create policy categories_internal on public.warning_categories for select to triggerboxd_writer, triggerboxd_reader using (true);
create policy contributions_internal on public.contributions to triggerboxd_writer using (true) with check (true);
create policy contributions_summary on public.contributions for select to triggerboxd_reader using (true);
create policy ratings_internal on public.category_ratings to triggerboxd_writer using (true) with check (true);
create policy ratings_summary on public.category_ratings for select to triggerboxd_reader using (true);
create policy quota_internal on private.request_buckets to triggerboxd_writer using (true) with check (true);
create policy idempotency_internal on private.idempotency_keys to triggerboxd_writer using (true) with check (true);

create function private.initialize_account() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, display_name) values (
    new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 60), ''), 'Viewer')
  );
  insert into private.user_access(user_id) values (new.id);
  return new;
end $$;
alter function private.initialize_account() owner to triggerboxd_writer;
revoke all on function private.initialize_account() from public, anon, authenticated, service_role;
create trigger triggerboxd_new_account after insert on auth.users for each row execute function private.initialize_account();
-- Additive backfill for accounts that predate this migration.
insert into public.profiles(user_id, display_name)
  select id, coalesce(nullif(left(btrim(raw_user_meta_data ->> 'display_name'), 60), ''), 'Viewer') from auth.users;
insert into private.user_access(user_id) select id from auth.users;

create function private.require_actor(p_actor uuid) returns void language plpgsql security invoker set search_path = '' as $$
declare v_status text; v_confirmed timestamptz; v_anonymous boolean;
begin
  if p_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Account-wide lock serializes quotas, idempotency and contribution mutation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text, 0));
  select a.status, u.email_confirmed_at, u.is_anonymous into v_status, v_confirmed, v_anonymous
    from private.user_access a join auth.users u on u.id = a.user_id where a.user_id = p_actor;
  if not found then raise exception 'AUTH_REQUIRED'; end if;
  if v_status <> 'active' then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_confirmed is null or coalesce(v_anonymous, false) then raise exception 'EMAIL_NOT_VERIFIED'; end if;
end $$;
alter function private.require_actor(uuid) owner to triggerboxd_writer;
revoke all on function private.require_actor(uuid) from public, anon, authenticated, service_role;

create function private.consume_quota(p_action text, p_subject text, p_limit integer, p_seconds integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_window timestamptz; v_count integer;
begin
  v_window := case p_seconds when 60 then date_trunc('minute', statement_timestamp())
    when 86400 then date_trunc('day', statement_timestamp() at time zone 'UTC') at time zone 'UTC' end;
  insert into private.request_buckets(action, subject_hash, window_start, window_seconds, count, expires_at)
    values (p_action, p_subject, v_window, p_seconds, 1, v_window + interval '48 hours')
    on conflict (action, subject_hash, window_start, window_seconds) do update
      set count = private.request_buckets.count + 1 where private.request_buckets.count < p_limit
    returning count into v_count;
  if not found then raise exception 'RATE_LIMITED'; end if;
end $$;
alter function private.consume_quota(text,text,integer,integer) owner to triggerboxd_writer;
revoke all on function private.consume_quota(text,text,integer,integer) from public, anon, authenticated, service_role;

create function private.read_own(p_actor uuid, p_movie_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('contribution', (
    select jsonb_build_object('revision', c.revision, 'watched', c.watched, 'ratings', coalesce((
      select jsonb_agg(jsonb_build_object('category', r.category_slug, 'severity', r.severity) order by w.sort_order)
      from public.category_ratings r join public.warning_categories w on w.slug = r.category_slug where r.contribution_id = c.id
    ), '[]'::jsonb)) from public.contributions c where c.user_id = p_actor and c.movie_id = p_movie_id
  ))
$$;
alter function private.read_own(uuid,uuid) owner to triggerboxd_writer;
revoke all on function private.read_own(uuid,uuid) from public, anon, authenticated, service_role;

create function private.get_my_account_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select jsonb_build_object('status', a.status, 'emailVerified', u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false),
    'displayName', p.display_name) into v_result from private.user_access a
    join auth.users u on u.id = a.user_id join public.profiles p on p.user_id = a.user_id where a.user_id = auth.uid();
  if v_result is null then raise exception 'AUTH_REQUIRED'; end if;
  return v_result;
end $$;
alter function private.get_my_account_status() owner to triggerboxd_writer;
create function public.get_my_account_status() returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.get_my_account_status()
$$;

create function private.get_my_contribution(p_movie_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_actor(auth.uid());
  if not exists(select 1 from public.movies where id = p_movie_id and visibility = 'published') then raise exception 'NOT_FOUND'; end if;
  return private.read_own(auth.uid(), p_movie_id);
end $$;
alter function private.get_my_contribution(uuid) owner to triggerboxd_writer;
create function public.get_my_contribution(p_movie_id uuid) returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_my_contribution(p_movie_id)
$$;

create function private.put_contribution(p_movie_id uuid, p_expected_revision bigint, p_watched boolean, p_ratings jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_id uuid; v_revision bigint; v_body jsonb; v_cached private.idempotency_keys%rowtype; v_response jsonb; v_visibility text;
begin
  perform private.require_actor(v_actor);
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision > 9007199254740991
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'INVALID_REQUEST'; end if;
  if p_watched is distinct from true then raise exception 'WATCH_CONFIRMATION_REQUIRED'; end if;
  if p_ratings is null or jsonb_typeof(p_ratings) <> 'array' then raise exception 'INVALID_REQUEST'; end if;
  if jsonb_array_length(p_ratings) not between 1 and 6 or octet_length(p_ratings::text)>8192 then raise exception 'INVALID_REQUEST'; end if;
  if exists(select 1 from jsonb_array_elements(p_ratings) r where
    jsonb_typeof(r) <> 'object' or not (r ? 'category' and r ? 'severity') or r - 'category' - 'severity' <> '{}'::jsonb
    or jsonb_typeof(r -> 'category') <> 'string' or jsonb_typeof(r -> 'severity') <> 'number'
    or (r ->> 'severity') !~ '^[0-3]$'
    or not exists(select 1 from public.warning_categories w where w.slug = r ->> 'category'))
    or (select count(distinct r ->> 'category') from jsonb_array_elements(p_ratings) r) <> jsonb_array_length(p_ratings)
    then raise exception 'INVALID_REQUEST'; end if;
  select jsonb_build_object('movieId',p_movie_id,'expectedRevision',p_expected_revision,'watched',p_watched,
    'ratings',jsonb_agg(r order by r ->> 'category')) into v_body from jsonb_array_elements(p_ratings) r;
  delete from private.idempotency_keys where actor_id=v_actor and operation='put' and key=p_idempotency_key and expires_at <= statement_timestamp();
  select * into v_cached from private.idempotency_keys where actor_id=v_actor and operation='put' and key=p_idempotency_key;
  if found then
    if v_cached.body <> v_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_cached.response;
  end if;
  perform 1 from public.movies where id=p_movie_id and visibility='published' for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select id, revision, visibility into v_id, v_revision, v_visibility from public.contributions where user_id=v_actor and movie_id=p_movie_id for update;
  if coalesce(v_revision,0) <> p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  if v_visibility = 'hidden' then raise exception 'FORBIDDEN'; end if;
  perform private.consume_quota('contribution',v_actor::text,10,60);
  perform private.consume_quota('contribution',v_actor::text,100,86400);
  v_revision := nextval('private.contribution_revision');
  if v_id is null then
    insert into public.contributions(user_id,movie_id,revision,watched) values(v_actor,p_movie_id,v_revision,true) returning id into v_id;
  else
    update public.contributions set revision=v_revision,watched=true,updated_at=statement_timestamp() where id=v_id;
  end if;
  delete from public.category_ratings where contribution_id=v_id;
  insert into public.category_ratings(contribution_id,category_slug,severity)
    select v_id,r ->> 'category',(r ->> 'severity')::smallint from jsonb_array_elements(p_ratings) r;
  v_response := private.read_own(v_actor,p_movie_id);
  insert into private.idempotency_keys(actor_id,operation,key,body,response) values(v_actor,'put',p_idempotency_key,v_body,v_response);
  return v_response;
end $$;
alter function private.put_contribution(uuid,bigint,boolean,jsonb,text) owner to triggerboxd_writer;
create function public.put_contribution(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_ratings jsonb,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.put_contribution(p_movie_id,p_expected_revision,p_watched,p_ratings,p_idempotency_key)
$$;

create function private.delete_contribution(p_movie_id uuid,p_expected_revision bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_revision bigint; v_body jsonb; v_cached private.idempotency_keys%rowtype; v_result jsonb := '{"deleted":true}'::jsonb;
begin
  perform private.require_actor(v_actor);
  if p_expected_revision is null or p_expected_revision < 1 or p_expected_revision > 9007199254740991
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'INVALID_REQUEST'; end if;
  v_body := jsonb_build_object('movieId',p_movie_id,'expectedRevision',p_expected_revision);
  delete from private.idempotency_keys where actor_id=v_actor and operation='delete' and key=p_idempotency_key and expires_at <= statement_timestamp();
  select * into v_cached from private.idempotency_keys where actor_id=v_actor and operation='delete' and key=p_idempotency_key;
  if found then
    if v_cached.body <> v_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_cached.response;
  end if;
  select revision into v_revision from public.contributions where user_id=v_actor and movie_id=p_movie_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_revision <> p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  perform private.consume_quota('contribution',v_actor::text,10,60);
  perform private.consume_quota('contribution',v_actor::text,100,86400);
  delete from public.contributions where user_id=v_actor and movie_id=p_movie_id;
  insert into private.idempotency_keys(actor_id,operation,key,body,response) values(v_actor,'delete',p_idempotency_key,v_body,v_result);
  return v_result;
end $$;
alter function private.delete_contribution(uuid,bigint,text) owner to triggerboxd_writer;
create function public.delete_contribution(p_movie_id uuid,p_expected_revision bigint,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.delete_contribution(p_movie_id,p_expected_revision,p_idempotency_key)
$$;

-- This single SQL statement gives all counts, bins and medians one consistent snapshot.
create function private.get_movie_summary(p_movie_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with movie as (select * from public.movies where id=p_movie_id and visibility='published'),
  eligible as materialized (
    select c.id from public.contributions c join private.user_access a on a.user_id=c.user_id
    where c.movie_id=p_movie_id and c.visibility='active' and a.status='active'
  ), bins as (
    select w.slug,w.sort_order,count(r.severity)::integer n,
      count(*) filter(where r.severity=0)::integer b0,count(*) filter(where r.severity=1)::integer b1,
      count(*) filter(where r.severity=2)::integer b2,count(*) filter(where r.severity=3)::integer b3,
      (array_agg(r.severity order by r.severity) filter(where r.severity is not null))[count(r.severity)::integer / 2 + 1] severity
    from public.warning_categories w left join (
      select r.category_slug,r.severity from public.category_ratings r join eligible e on e.id=r.contribution_id
    ) r on r.category_slug=w.slug group by w.slug,w.sort_order
  )
  select jsonb_build_object('id',m.id,'tmdbId',m.tmdb_id,'title',m.title,'originalTitle',m.original_title,
    'year',extract(year from m.release_date)::integer,'language',m.original_language,'posterPath',m.poster_path,
    'synopsis',m.synopsis,'metadataFetchedAt',m.metadata_fetched_at,'contributorCount',(select count(*)::integer from eligible),
    'warnings',(select jsonb_agg(jsonb_build_object('category',slug,'severity',severity,'count',n,
      'distribution',jsonb_build_array(b0,b1,b2,b3),'provisional',n between 1 and 2,
      'disputed',n>=2 and ((b0>=ceil(n*0.25) and b2+b3>=ceil(n*0.25)) or (b0+b1>=ceil(n*0.25) and b3>=ceil(n*0.25)))) order by sort_order) from bins))
  from movie m
$$;
alter function private.get_movie_summary(uuid) owner to triggerboxd_reader;
create function public.get_movie_summary(p_movie_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.get_movie_summary(p_movie_id)
$$;

create function private.get_indexable_movies(p_limit integer default 500,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset not between 0 and 10000
    then raise exception 'INVALID_REQUEST'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',eligible.id,'updatedAt',eligible.updated_at) order by eligible.id),'[]'::jsonb)
    into v_result from (
      select m.id,greatest(m.metadata_fetched_at,max(c.updated_at),max(a.changed_at)) updated_at
      from public.movies m join public.contributions c on c.movie_id=m.id and c.visibility='active'
      join private.user_access a on a.user_id=c.user_id and a.status='active'
      where m.visibility='published' group by m.id having count(*)>=3
      order by m.id limit p_limit offset p_offset
    ) eligible;
  return v_result;
end $$;
alter function private.get_indexable_movies(integer,integer) owner to triggerboxd_reader;
create function public.get_indexable_movies(p_limit integer default 500,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.get_indexable_movies(p_limit,p_offset)
$$;

-- Trusted gateway only: metadata must have been fetched from the fixed TMDb host.
create function private.import_movie(p_actor_id uuid,p_tmdb_id bigint,p_metadata jsonb,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cached private.idempotency_keys%rowtype; v_body jsonb; v_id uuid; v_created boolean := false; v_response jsonb; v_date date;
begin
  perform private.require_actor(p_actor_id);
  if p_tmdb_id is null or p_tmdb_id not between 1 and 9007199254740991 or p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' or p_metadata is null or jsonb_typeof(p_metadata)<>'object'
    then raise exception 'INVALID_REQUEST'; end if;
  if p_metadata - 'title' - 'originalTitle' - 'releaseDate' - 'language' - 'productionCountries' - 'posterPath' - 'synopsis' <> '{}'::jsonb
    or not (p_metadata ?& array['title','originalTitle','releaseDate','language','productionCountries','posterPath','synopsis'])
    or jsonb_typeof(p_metadata->'title')<>'string' or char_length(p_metadata->>'title') not between 1 and 300
    or jsonb_typeof(p_metadata->'originalTitle')<>'string' or char_length(p_metadata->>'originalTitle') not between 1 and 300
    or jsonb_typeof(p_metadata->'language') not in ('null','string') or (p_metadata->>'language') !~ '^[a-z]{2,3}$'
    or jsonb_typeof(p_metadata->'productionCountries')<>'array'
    then raise exception 'INVALID_REQUEST'; end if;
  if jsonb_array_length(p_metadata->'productionCountries')>50 or exists(select 1 from jsonb_array_elements(p_metadata->'productionCountries') c
    where jsonb_typeof(c)<>'string' or c #>> '{}' !~ '^[A-Z]{2}$')
    or jsonb_typeof(p_metadata->'releaseDate') not in ('null','string')
    or jsonb_typeof(p_metadata->'posterPath') not in ('null','string')
    or (p_metadata->>'posterPath') !~ '^/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$'
    or jsonb_typeof(p_metadata->'synopsis') not in ('null','string') or char_length(p_metadata->>'synopsis')>10000
    then raise exception 'INVALID_REQUEST'; end if;
  if p_metadata->>'releaseDate' is not null then
    if p_metadata->>'releaseDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_REQUEST'; end if;
    begin v_date := (p_metadata->>'releaseDate')::date;
    exception when others then raise exception 'INVALID_REQUEST'; end;
  end if;
  -- Retry identity is the selected authoritative TMDb ID; refreshed metadata is not a new user request.
  v_body := jsonb_build_object('tmdbId',p_tmdb_id);
  delete from private.idempotency_keys where actor_id=p_actor_id and operation='import' and key=p_idempotency_key and expires_at<=statement_timestamp();
  select * into v_cached from private.idempotency_keys where actor_id=p_actor_id and operation='import' and key=p_idempotency_key;
  if found then
    if v_cached.body<>v_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_cached.response;
  end if;
  perform private.consume_quota('import',p_actor_id::text,10,60);
  perform private.consume_quota('import',p_actor_id::text,100,86400);
  insert into public.movies(tmdb_id,title,original_title,release_date,original_language,production_countries,poster_path,synopsis)
    values(p_tmdb_id,p_metadata->>'title',p_metadata->>'originalTitle',v_date,p_metadata->>'language',
      array(select jsonb_array_elements_text(p_metadata->'productionCountries')),p_metadata->>'posterPath',p_metadata->>'synopsis')
    on conflict(tmdb_id) do nothing returning id into v_id;
  if found then v_created:=true;
  else
    -- Take the update lock immediately; SHARE-then-UPDATE can deadlock concurrent refreshes.
    select id into v_id from public.movies where tmdb_id=p_tmdb_id and visibility='published' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    update public.movies set title=p_metadata->>'title',original_title=p_metadata->>'originalTitle',release_date=v_date,
      original_language=p_metadata->>'language',production_countries=array(select jsonb_array_elements_text(p_metadata->'productionCountries')),
      poster_path=p_metadata->>'posterPath',synopsis=p_metadata->>'synopsis',metadata_fetched_at=statement_timestamp()
      where id=v_id;
  end if;
  v_response:=jsonb_build_object('id',v_id,'tmdbId',p_tmdb_id,'created',v_created);
  insert into private.idempotency_keys(actor_id,operation,key,body,response) values(p_actor_id,'import',p_idempotency_key,v_body,v_response);
  return v_response;
end $$;
alter function private.import_movie(uuid,bigint,jsonb,text) owner to triggerboxd_writer;
create function public.import_movie(p_actor_id uuid,p_tmdb_id bigint,p_metadata jsonb,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.import_movie(p_actor_id,p_tmdb_id,p_metadata,p_idempotency_key)
$$;
create function private.consume_search_quota(p_subject_hash text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST'; end if;
  perform private.consume_quota('search',p_subject_hash,30,60);
end $$;
alter function private.consume_search_quota(text) owner to triggerboxd_writer;
create function public.consume_search_quota(p_subject_hash text) returns void language sql security invoker set search_path = '' as $$
  select private.consume_search_quota(p_subject_hash)
$$;
create function private.expire_request_state() returns void language sql security definer set search_path = '' as $$
  delete from private.request_buckets where expires_at<=statement_timestamp();
  delete from private.idempotency_keys where expires_at<=statement_timestamp();
$$;
alter function private.expire_request_state() owner to triggerboxd_writer;
create function public.expire_request_state() returns void language sql security invoker set search_path = '' as $$
  select private.expire_request_state()
$$;

-- Wrappers require private schema USAGE, but no user has private table access.
-- The private schema MUST remain absent from PostgREST's exposed schemas.
grant usage on schema private to anon, authenticated, service_role;
revoke execute on all functions in schema private from public, anon, authenticated, service_role;
revoke execute on function public.get_my_account_status(), public.get_my_contribution(uuid),
  public.put_contribution(uuid,bigint,boolean,jsonb,text), public.delete_contribution(uuid,bigint,text),
  public.get_movie_summary(uuid), public.import_movie(uuid,bigint,jsonb,text), public.consume_search_quota(text),
  public.expire_request_state(), public.get_indexable_movies(integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_movie_summary(uuid), private.get_movie_summary(uuid) to anon, authenticated;
grant execute on function public.get_indexable_movies(integer,integer), private.get_indexable_movies(integer,integer) to anon, authenticated;
grant execute on function public.get_my_account_status(), private.get_my_account_status(),
  public.get_my_contribution(uuid), private.get_my_contribution(uuid),
  public.put_contribution(uuid,bigint,boolean,jsonb,text), private.put_contribution(uuid,bigint,boolean,jsonb,text),
  public.delete_contribution(uuid,bigint,text), private.delete_contribution(uuid,bigint,text) to authenticated;
grant execute on function public.import_movie(uuid,bigint,jsonb,text), private.import_movie(uuid,bigint,jsonb,text),
  public.consume_search_quota(text), private.consume_search_quota(text), public.expire_request_state(), private.expire_request_state() to service_role;
revoke create on schema private, public from triggerboxd_writer, triggerboxd_reader;
commit;
