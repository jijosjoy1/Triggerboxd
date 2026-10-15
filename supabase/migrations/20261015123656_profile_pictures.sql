-- One small normalized JPEG per opt-in account. No originals or provider photos.
begin;
grant create on schema private to triggerboxd_writer;
create table private.profile_pictures (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.profiles(user_id) on delete cascade,
 image bytea not null check(octet_length(image) between 4 and 65536),
 updated_at timestamptz not null default now()
);
alter table private.profile_pictures enable row level security;
revoke all on private.profile_pictures from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.profile_pictures to triggerboxd_writer;
create policy pictures_internal on private.profile_pictures to triggerboxd_writer using(true) with check(true);

create function private.set_profile_picture(p_actor uuid,p_image text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare picture_id uuid; bytes bytea;
begin
 perform private.require_actor(p_actor);
 perform private.consume_quota('contribution','avatar:'||p_actor::text,10,60);
 if p_image is null then
   delete from private.profile_pictures where user_id=p_actor;
 else
   if length(p_image)>87384 then raise exception 'PAYLOAD_TOO_LARGE';end if;
   bytes:=decode(p_image,'base64');
   if octet_length(bytes) not between 4 and 65536 or substring(bytes from 1 for 2)<>decode('ffd8','hex') or substring(bytes from octet_length(bytes)-1 for 2)<>decode('ffd9','hex') then raise exception 'INVALID_REQUEST';end if;
   insert into private.profile_pictures(user_id,image) values(p_actor,bytes)
   on conflict(user_id) do update set id=gen_random_uuid(),image=excluded.image,updated_at=now()
   returning id into picture_id;
 end if;
 return jsonb_build_object('avatarId',picture_id);
end $$;
alter function private.set_profile_picture(uuid,text) owner to triggerboxd_writer;
create function public.set_profile_picture(p_actor uuid,p_image text) returns jsonb
language sql security invoker set search_path='' as $$ select private.set_profile_picture(p_actor,p_image) $$;
revoke all on function private.set_profile_picture(uuid,text),public.set_profile_picture(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.set_profile_picture(uuid,text),public.set_profile_picture(uuid,text) to service_role;

create function private.get_my_profile_picture() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id();begin
 perform private.require_actor(actor);
 return jsonb_build_object('avatarId',(select id from private.profile_pictures where user_id=actor));
end $$;
alter function private.get_my_profile_picture() owner to triggerboxd_writer;
create function public.get_my_profile_picture() returns jsonb language sql security invoker set search_path='' as $$ select private.get_my_profile_picture() $$;
revoke all on function private.get_my_profile_picture(),public.get_my_profile_picture() from public,anon,authenticated,service_role;
grant execute on function private.get_my_profile_picture(),public.get_my_profile_picture() to authenticated;

create function private.get_profile_picture(p_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(p.image,'base64') from private.profile_pictures p join private.user_access a on a.user_id=p.user_id and a.status='active' where p.id=p_id
$$;
alter function private.get_profile_picture(uuid) owner to triggerboxd_writer;
create function public.get_profile_picture(p_id uuid) returns text language sql stable security invoker set search_path='' as $$ select private.get_profile_picture(p_id) $$;
revoke all on function private.get_profile_picture(uuid),public.get_profile_picture(uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_profile_picture(uuid),public.get_profile_picture(uuid) to anon,authenticated;

create function private.public_picture_author(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('nickname',p.display_name,'avatarId',i.id) from public.profiles p
 join private.profile_pictures i on i.user_id=p.user_id
 join private.user_access a on a.user_id=p.user_id and a.status='active' where p.user_id=p_actor
$$;
alter function private.public_picture_author(uuid) owner to triggerboxd_writer;
revoke all on function private.public_picture_author(uuid) from public,anon,authenticated,service_role;
grant execute on function private.public_picture_author(uuid) to triggerboxd_reader;
-- Add attribution only to already-visible notes, preserving all spoiler filters.
do $$ declare original text; updated text;begin
 original:=pg_get_functiondef('private.get_movie_notes(uuid,text[],smallint,integer,integer)'::regprocedure);
 updated:=replace(original,'''severity'',d.severity,','''severity'',d.severity,''author'',case when d.effective=0 or (p_level>=1 and d.category_slug=any(p_categories)) then private.public_picture_author(d.user_id) else null end,');
 if updated=original then raise exception 'NOTE_AUTHOR_UPGRADE_FAILED';end if;
 execute updated;
end $$;
revoke create on schema private from triggerboxd_writer;
commit;
