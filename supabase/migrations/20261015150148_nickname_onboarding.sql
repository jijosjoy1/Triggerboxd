begin;
alter table public.profiles add column nickname_set boolean not null default false;
-- Preserve existing aliases; only the historical placeholder needs setup.
update public.profiles set nickname_set=true where display_name<>'Viewer';
grant update(nickname_set) on public.profiles to authenticated;
create or replace function private.initialize_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(user_id,display_name,nickname_set) values(new.id,
 case when new.raw_user_meta_data->>'nickname_chosen'='true'
  then coalesce(nullif(left(btrim(new.raw_user_meta_data->>'nickname'),60),''),'Viewer') else 'Viewer' end,
 coalesce(new.raw_user_meta_data->>'nickname_chosen'='true',false) and coalesce(nullif(btrim(new.raw_user_meta_data->>'nickname'),''),'')<>'');
 insert into private.user_access(user_id) values(new.id);
 return new;
end $$;
-- A UI choice marker, never an authorization claim.
do $$ declare original text; updated text;begin
 original:=pg_get_functiondef('private.get_my_account_status()'::regprocedure);
 updated:=replace(original,'''displayName'', p.display_name)','''displayName'', p.display_name, ''nicknameChosen'', p.nickname_set)');
 if updated=original then raise exception 'NICKNAME_SETUP_UPGRADE_FAILED';end if;
 execute updated;
end $$;
commit;
