-- Add two independent warning topics and extend the existing content scale.
-- Existing severities 0..3 and category slugs remain unchanged.
begin;

update public.warning_categories
set label='Gore / disturbing visuals',
    guidance='Stomach-turning visuals. Historical reports in this category also included blood and graphic violence.'
where slug='gore_graphic_violence';

insert into public.warning_categories(slug,label,guidance,sort_order) values
 ('graphic_violence','Graphic violence / bloodshed','Explicit violent acts, severe injuries and visible bloodshed. Ordinary fistfights alone are not high severity.',12),
 ('horror','Horror / frightening content','Jump scares, psychological fear, paranormal activity, creatures and intense suspense.',13);

insert into public.warning_descriptors(slug,category_slug,label) values
 ('body_horror','gore_graphic_violence','Body horror'),
 ('vomiting','gore_graphic_violence','Vomiting'),
 ('decomposition','gore_graphic_violence','Decomposition'),
 ('disturbing_medical','gore_graphic_violence','Disturbing medical imagery'),
 ('exposed_organs','gore_graphic_violence','Exposed organs'),
 ('bloody_killing','graphic_violence','Bloody killing'),
 ('dismemberment','graphic_violence','Dismemberment'),
 ('decapitation','graphic_violence','Decapitation'),
 ('brutal_attack','graphic_violence','Brutal attack'),
 ('visible_bloodshed','graphic_violence','Visible bloodshed'),
 ('jump_scare','horror','Jump scare'),
 ('psychological_fear','horror','Psychological fear'),
 ('paranormal_activity','horror','Paranormal activity'),
 ('frightening_creature','horror','Frightening creature'),
 ('creepy_atmosphere','horror','Creepy atmosphere');

alter table public.category_ratings drop constraint category_ratings_severity_check;
alter table public.category_ratings add constraint category_ratings_severity_check check(severity between 0 and 5);
alter table private.movie_notes drop constraint movie_notes_severity_check;
alter table private.movie_notes add constraint movie_notes_severity_check check(severity between 0 and 5);

-- Preserve the original SECURITY DEFINER owners, grants, search_path and body
-- while changing only their range checks and aggregate bins.
do $migration$
declare original text; definition text;
begin
 original:=pg_get_functiondef('private.put_contribution(uuid,bigint,boolean,jsonb,text)'::regprocedure);
 definition:=replace(replace(original,'between 1 and 11','between 1 and 13'),'between 1 and 6','between 1 and 13');
 definition:=replace(definition,'^[0-3]$','^[0-5]$');
 if definition=original or position('^[0-5]$' in definition)=0 or position('between 1 and 13' in definition)=0 then raise exception 'PUT_SCALE_UPGRADE_FAILED'; end if;
 execute definition;

 original:=pg_get_functiondef('private.patch_warning(uuid,bigint,boolean,text,smallint,smallint,text[],text)'::regprocedure);
 definition:=replace(original,'p_severity not between 0 and 3','p_severity not between 0 and 5');
 if definition=original then raise exception 'PATCH_SCALE_UPGRADE_FAILED'; end if;
 execute definition;

 original:=pg_get_functiondef('private.put_movie_note(uuid,uuid,bigint,boolean,text,text,integer,integer,text,smallint,text,smallint)'::regprocedure);
 definition:=replace(original,'p_severity not between 0 and 3','p_severity not between 0 and 5');
 if definition=original then raise exception 'NOTE_SCALE_UPGRADE_FAILED'; end if;
 execute definition;

 original:=pg_get_functiondef('private.reveal_movie_warnings(uuid,text[],smallint)'::regprocedure);
 definition:=replace(original,'not between 1 and 11','not between 1 and 13');
 if definition=original then raise exception 'REVEAL_CATEGORY_UPGRADE_FAILED'; end if;
 execute definition;

 original:=pg_get_functiondef('private.summary_at_level(uuid,text[],smallint)'::regprocedure);
 definition:=replace(original,
  'count(*) filter(where r.severity=3)::integer b3,',
  'count(*) filter(where r.severity=3)::integer b3,count(*) filter(where r.severity=4)::integer b4,count(*) filter(where r.severity=5)::integer b5,');
 definition:=replace(definition,
  '''distribution'',jsonb_build_array(b.b0,b.b1,b.b2,b.b3)',
  '''distribution'',jsonb_build_array(b.b0,b.b1,b.b2,b.b3,b.b4,b.b5)');
 definition:=replace(definition,'b.b2+b.b3>=','b.b2+b.b3+b.b4+b.b5>=');
 definition:=replace(definition,'b.b3>=','b.b3+b.b4+b.b5>=');
 if definition=original or position('b.b5' in definition)=0 or position('jsonb_build_array(b.b0,b.b1,b.b2,b.b3,b.b4,b.b5)' in definition)=0
  or position('b.b2+b.b3+b.b4+b.b5>=' in definition)=0 or position('b.b3+b.b4+b.b5>=' in definition)=0 then
  raise exception 'SUMMARY_SCALE_UPGRADE_FAILED';
 end if;
 execute definition;
end $migration$;

commit;
