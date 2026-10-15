begin;
create schema nickname_test;
create table nickname_test.results(name text primary key, passed boolean not null);
create function nickname_test.assert(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERTION FAILED: %', name; end if;
  insert into nickname_test.results values (name, true);
end $$;

insert into auth.users(id, email_confirmed_at, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-000000000001', now(), '{"display_name":"Google Real Name"}'),
  ('c0000000-0000-4000-8000-000000000002', now(), '{"nickname":"Cinema Fan","nickname_chosen":true}');
select nickname_test.assert('provider display name is never copied into new profile',
  (select display_name='Viewer' from public.profiles where user_id='c0000000-0000-4000-8000-000000000001'));
select nickname_test.assert('explicitly chosen signup nickname is retained',
  (select display_name='Cinema Fan' from public.profiles where user_id='c0000000-0000-4000-8000-000000000002'));
select nickname_test.assert('Google fallback needs a chosen nickname',
  (select not nickname_set from public.profiles where user_id='c0000000-0000-4000-8000-000000000001'));
select nickname_test.assert('email signup choice does not prompt again',
  (select nickname_set from public.profiles where user_id='c0000000-0000-4000-8000-000000000002'));
insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values('c0000000-0000-4000-8000-000000000003',now(),'{"nickname":"Provider nickname"}');
select nickname_test.assert('provider nickname without explicit choice never breaks signup or skips setup',
 (select not nickname_set and display_name='Viewer' from public.profiles where user_id='c0000000-0000-4000-8000-000000000003'));
select nickname_test.assert('existing profile value survives migration',
  (select display_name='Viewer' from public.profiles where user_id='00000000-0000-4000-8000-000000000099'));
select nickname_test.assert('authenticated may update only nickname column',
  has_column_privilege('authenticated','public.profiles','display_name','UPDATE')
  and not has_column_privilege('authenticated','public.profiles','user_id','UPDATE'));

set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
update public.profiles set display_name='Chosen Alias' where user_id='c0000000-0000-4000-8000-000000000001';
reset role;
select nickname_test.assert('owner can change their nickname',
  (select display_name='Chosen Alias' from public.profiles where user_id='c0000000-0000-4000-8000-000000000001'));
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
update public.profiles set display_name='Intruder' where user_id='c0000000-0000-4000-8000-000000000001';
reset role;
select nickname_test.assert('other account cannot change nickname',
  (select display_name='Chosen Alias' from public.profiles where user_id='c0000000-0000-4000-8000-000000000001'));
select name,passed from nickname_test.results;
rollback;
