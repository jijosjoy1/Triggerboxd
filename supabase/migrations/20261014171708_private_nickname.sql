-- A nickname is selected by the account owner; provider names are never copied for new accounts.
-- Existing profile rows and all contributions remain untouched.
begin;

grant update (display_name) on public.profiles to authenticated;
create policy profiles_edit_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function private.initialize_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, display_name) values (
    new.id,
    case when new.raw_user_meta_data ->> 'nickname_chosen' = 'true'
      then coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'nickname'), 60), ''), 'Viewer')
      else 'Viewer' end
  );
  insert into private.user_access(user_id) values (new.id);
  return new;
end $$;

commit;
