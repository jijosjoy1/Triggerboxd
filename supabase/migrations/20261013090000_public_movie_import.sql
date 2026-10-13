begin;
create role triggerboxd_public_importer nologin noinherit nobypassrls;
grant triggerboxd_public_importer to postgres;
grant usage,create on schema private,public to triggerboxd_public_importer;
grant select,insert on public.movies to triggerboxd_public_importer;
create policy movies_public_import_read on public.movies for select to triggerboxd_public_importer using (true);
create policy movies_public_import_insert on public.movies for insert to triggerboxd_public_importer with check (visibility='published');
alter table private.request_buckets drop constraint request_buckets_action_check;
alter table private.request_buckets add constraint request_buckets_action_check check(action in ('contribution','import','search','public_import'));
grant create on schema private to triggerboxd_writer;
create function private.consume_public_import_quota(p_subject_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST'; end if;
  -- Global cap also bounds distributed abuse. This call commits before the external fetch.
  perform private.consume_quota('public_import','global',100,60);
  perform private.consume_quota('public_import','global',1000,86400);
  perform private.consume_quota('public_import',p_subject_hash,5,60);
  perform private.consume_quota('public_import',p_subject_hash,30,86400);
end $$;
alter function private.consume_public_import_quota(text) owner to triggerboxd_writer;
create function public.consume_public_import_quota(p_subject_hash text) returns void
language sql security invoker set search_path='' as $$ select private.consume_public_import_quota(p_subject_hash) $$;
create function private.import_public_movie(p_tmdb_id bigint,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_date date; v_created boolean:=false;
begin
  if p_tmdb_id is null or p_tmdb_id not between 1 and 9007199254740991 or p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'INVALID_REQUEST'; end if;
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
  -- The selected TMDb ID is the idempotency identity. No fake actor or unbounded retry-key rows.
  -- Never update existing records: hidden films stay hidden and warnings stay untouched.
  insert into public.movies(tmdb_id,title,original_title,release_date,original_language,production_countries,poster_path,synopsis)
    values(p_tmdb_id,p_metadata->>'title',p_metadata->>'originalTitle',v_date,p_metadata->>'language',
      array(select jsonb_array_elements_text(p_metadata->'productionCountries')),p_metadata->>'posterPath',p_metadata->>'synopsis')
    on conflict(tmdb_id) do nothing returning id into v_id;
  if found then v_created:=true;
  else
    select id into v_id from public.movies where tmdb_id=p_tmdb_id and visibility='published';
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id',v_id,'tmdbId',p_tmdb_id,'created',v_created);
end $$;
alter function private.import_public_movie(bigint,jsonb) owner to triggerboxd_public_importer;
create function public.import_public_movie(p_tmdb_id bigint,p_metadata jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.import_public_movie(p_tmdb_id,p_metadata) $$;
revoke all on function public.import_public_movie(bigint,jsonb),private.import_public_movie(bigint,jsonb),public.consume_public_import_quota(text),private.consume_public_import_quota(text) from public,anon,authenticated;
grant execute on function public.import_public_movie(bigint,jsonb),private.import_public_movie(bigint,jsonb),public.consume_public_import_quota(text),private.consume_public_import_quota(text) to service_role;
revoke create on schema private,public from triggerboxd_public_importer;
revoke create on schema private from triggerboxd_writer;
commit;

