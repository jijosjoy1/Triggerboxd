-- Managed Supabase auth schema does not allow postgres to grant custom roles USAGE.
-- Narrow bridges expose only the existing identity checks to the internal writer.
begin;
create function private.current_actor_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;
create function private.actor_auth_record(p_actor uuid)
returns table(id uuid,email_confirmed_at timestamptz,is_anonymous boolean)
language sql stable security definer set search_path = '' as $$
  select u.id,u.email_confirmed_at,u.is_anonymous from auth.users u where u.id=p_actor
$$;
revoke all on function private.current_actor_id(),private.actor_auth_record(uuid) from public,anon,authenticated,service_role;
grant execute on function private.current_actor_id(),private.actor_auth_record(uuid) to triggerboxd_writer;
do $$
declare f regprocedure; definition text;
begin
  foreach f in array array[
    'private.require_actor(uuid)'::regprocedure,
    'private.get_my_account_status()'::regprocedure,
    'private.get_my_contribution(uuid)'::regprocedure,
    'private.put_contribution(uuid,bigint,boolean,jsonb,text)'::regprocedure,
    'private.delete_contribution(uuid,bigint,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(f);
    definition := replace(definition,'auth.uid()','private.current_actor_id()');
    definition := replace(definition,'join auth.users u','join private.actor_auth_record(p_actor) u');
    if f='private.get_my_account_status()'::regprocedure then
      definition := replace(definition,'private.actor_auth_record(p_actor)','private.actor_auth_record(private.current_actor_id())');
    end if;
    execute definition;
  end loop;
end $$;
commit;

