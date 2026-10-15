-- Owner dashboard access. Adds a private owner allowlist and one read-only
-- least-privilege aggregate. No existing role, policy, grant, function or table
-- is altered, and no new public surface is exposed to anon.
begin;

-- Dedicated reader for the owner aggregate only. NOLOGIN/NOBYPASSRLS like the
-- other internal roles, so RLS still applies to every row it can reach.
create role triggerboxd_admin_reader nologin noinherit nobypassrls;
grant triggerboxd_admin_reader to postgres;
grant usage on schema private, public to triggerboxd_admin_reader;

-- The owner allowlist. Provisioned by an operator using the migration role;
-- never readable or writable by anon, authenticated or service_role, and not
-- exposed through PostgREST (the private schema stays unexposed).
create table private.admin_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provisioned_at timestamptz not null default now(),
  note text check (note is null or char_length(note) between 1 and 200)
);
alter table private.admin_owners enable row level security;
revoke all on private.admin_owners from public, anon, authenticated, service_role;
grant select on private.admin_owners to triggerboxd_admin_reader;
create policy admin_owners_reader on private.admin_owners for select to triggerboxd_admin_reader using (true);

-- Read access for the aggregate. The existing triggerboxd_reader grants and
-- policies are deliberately left untouched; this is a separate role.
grant select on public.profiles, public.movies, public.contributions,
  public.category_ratings, public.warning_categories to triggerboxd_admin_reader;
create policy profiles_admin on public.profiles for select to triggerboxd_admin_reader using (true);
create policy movies_admin on public.movies for select to triggerboxd_admin_reader using (true);
create policy contributions_admin on public.contributions for select to triggerboxd_admin_reader using (true);
create policy ratings_admin on public.category_ratings for select to triggerboxd_admin_reader using (true);
create policy categories_admin on public.warning_categories for select to triggerboxd_admin_reader using (true);

-- The managed auth schema cannot be granted to custom roles, so read the caller
-- through a narrow bridge owned by the migration role, exactly like the
-- existing identity bridges. This one returns only the caller's id.
create function private.admin_actor() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;
revoke all on function private.admin_actor() from public, anon, authenticated, service_role;
grant execute on function private.admin_actor() to triggerboxd_admin_reader;

-- The aggregate's definer must independently verify account eligibility. The
-- bridge exposes only a status code to the admin reader, never auth rows or
-- access-table privileges. It runs with the migration role's existing access.
create function private.admin_actor_status(p_actor uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_actor is null or u.id is null or coalesce(u.is_anonymous, false) then 'AUTH_REQUIRED'
    when a.status is distinct from 'active' then 'ACCOUNT_SUSPENDED'
    when u.email_confirmed_at is null then 'EMAIL_NOT_VERIFIED'
    else 'ACTIVE'
  end
  from (select 1) basis
  left join auth.users u on u.id = p_actor
  left join private.user_access a on a.user_id = u.id
$$;
revoke all on function private.admin_actor_status(uuid) from public, anon, authenticated, service_role;
grant execute on function private.admin_actor_status(uuid) to triggerboxd_admin_reader;

create function private.admin_is_owner(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is not null and exists (select 1 from private.admin_owners a where a.user_id = p_actor)
$$;
alter function private.admin_is_owner(uuid) owner to triggerboxd_admin_reader;
revoke all on function private.admin_is_owner(uuid) from public, anon, authenticated, service_role;

-- Allowlisted aggregate. Returns counts, recent nicknames, recent film titles
-- and a bounded category/severity summary. It never returns an email address,
-- provider name, photo, token, session or contribution text.
create function private.admin_overview(p_recent_limit integer default 10, p_recent_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_status text;
begin
  v_actor := private.admin_actor();
  v_status := private.admin_actor_status(v_actor);
  if v_status <> 'ACTIVE' then raise exception '%', v_status; end if;
  if not exists (select 1 from private.admin_owners a where a.user_id = v_actor) then raise exception 'FORBIDDEN'; end if;
  if p_recent_limit is null or p_recent_limit < 1 or p_recent_limit > 25 then raise exception 'INVALID_REQUEST'; end if;
  if p_recent_offset is null or p_recent_offset < 0 or p_recent_offset > 5000 then raise exception 'INVALID_REQUEST'; end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'last7Days', (select count(*) from public.profiles p where p.created_at >= now() - interval '7 days'),
      'last30Days', (select count(*) from public.profiles p where p.created_at >= now() - interval '30 days')
    ),
    'films', jsonb_build_object(
      'total', (select count(*) from public.movies),
      'published', (select count(*) from public.movies m where m.visibility = 'published'),
      'hidden', (select count(*) from public.movies m where m.visibility = 'hidden')
    ),
    -- An assessment is one viewer's contribution for one film. Category ratings
    -- are reported separately and must never be read as the assessment count.
    'assessments', jsonb_build_object(
      'total', (select count(*) from public.contributions),
      'neverEdited', (select count(*) from public.contributions c where c.updated_at = c.created_at),
      'edited', (select count(*) from public.contributions c where c.updated_at > c.created_at),
      'active', (select count(*) from public.contributions c where c.visibility = 'active'),
      'categoryRatings', (select count(*) from public.category_ratings)
    ),
    'recentAccounts', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('nickname', p.display_name, 'joinedAt', p.created_at) as x
        from public.profiles p order by p.created_at desc, p.user_id limit p_recent_limit offset p_recent_offset
      ) s), '[]'::jsonb),
    'recentFilms', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('title', m.title, 'year', extract(year from m.release_date)::integer, 'importedAt', m.created_at) as x
        from public.movies m order by m.created_at desc, m.id limit p_recent_limit offset p_recent_offset
      ) s), '[]'::jsonb),
    'recentAssessments', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'filmTitle', m.title,
          'submittedAt', c.created_at,
          'updatedAt', c.updated_at,
          'edited', c.updated_at > c.created_at,
          'categoryCount', (select count(*) from public.category_ratings r where r.contribution_id = c.id),
          'categories', coalesce((
            select jsonb_agg(jsonb_build_object('category', t.category_slug, 'severity', t.severity) order by t.severity desc, t.category_slug)
            from (select r.category_slug, r.severity from public.category_ratings r
                  where r.contribution_id = c.id order by r.severity desc, r.category_slug limit 8) t), '[]'::jsonb)
        ) as x
        from public.contributions c join public.movies m on m.id = c.movie_id
        order by c.updated_at desc, c.id limit p_recent_limit offset p_recent_offset
      ) s), '[]'::jsonb)
  );
end $$;
alter function private.admin_overview(integer,integer) owner to triggerboxd_admin_reader;
revoke all on function private.admin_overview(integer,integer) from public, anon, authenticated, service_role;

create function public.get_admin_overview(p_recent_limit integer default 10, p_recent_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.admin_overview(p_recent_limit, p_recent_offset)
$$;
revoke all on function public.get_admin_overview(integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_overview(integer,integer), private.admin_overview(integer,integer) to authenticated;

revoke create on schema private, public from triggerboxd_admin_reader;
commit;
