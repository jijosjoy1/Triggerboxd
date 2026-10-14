// Local embedded PostgreSQL only. No project URL, credentials, or remote writes.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Usage: node supabase/tests/run.mjs <absolute path to @electric-sql/pglite/dist/index.js>');
const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
const db = new PGlite();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email_confirmed_at timestamptz,
      is_anonymous boolean default false,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    insert into auth.users(id,email_confirmed_at) values('00000000-0000-4000-8000-000000000099',now());
  `);
  const files = (await readdir(path.join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) throw new Error('No migrations found');
  for (const file of files) {
    if (file.includes('product_foundation')) {
      await db.exec(`
        insert into auth.users(id,email_confirmed_at) values('90000000-0000-4000-8000-000000000001',now());
        insert into public.movies(id,tmdb_id,title,original_title) values('90000000-0000-4000-8000-000000000002',99999,'Migration preservation fixture','Migration preservation fixture');
        insert into public.contributions(id,user_id,movie_id,revision,watched) values('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',1,true);
        insert into public.category_ratings(contribution_id,category_slug,severity) values('90000000-0000-4000-8000-000000000003','suicide_self_harm',2);
      `);
    }
    if (file.includes('graphic_violence_horror_warning_scale')) {
      await db.exec(`
        insert into public.category_ratings(contribution_id,category_slug,severity) values
          ('90000000-0000-4000-8000-000000000003','gore_graphic_violence',3),
          ('90000000-0000-4000-8000-000000000003','physical_violence',2);
      `);
    }
    const sql = await readFile(path.join(root, 'migrations', file), 'utf8');
    if (!sql.trim()) throw new Error(`Empty migration: ${file}`);
    await db.exec(sql);
    // Hosted auth schema belongs to supabase_admin: postgres's custom-role
    // USAGE grants have no effect. Reproduce that boundary locally.
    if (file.includes('restore_writer_auth_schema_usage')) {
      await db.exec('revoke usage on schema auth from triggerboxd_writer');
    }
    console.log(`APPLIED ${file}`);
  }
  const preserved = await db.query(`select category_slug,severity,spoiler_level from public.category_ratings where contribution_id='90000000-0000-4000-8000-000000000003' order by category_slug`);
  const expected = [['gore_graphic_violence',3],['physical_violence',2],['suicide_self_harm',2]];
  if (JSON.stringify(preserved.rows.map(row => [row.category_slug,row.severity])) !== JSON.stringify(expected)
    || preserved.rows.some(row => row.spoiler_level !== 0)) throw new Error('Historical assessment lost or reclassified during migration');
  console.log('PASS historical gore, physical violence and self-harm assessments preserved');
  await db.exec(`delete from auth.users where id='90000000-0000-4000-8000-000000000001'; delete from public.movies where id='90000000-0000-4000-8000-000000000002';`);
  const results = [];
  for (const testFile of ['launch.sql','product-foundation.sql','public-import.sql','movie-notes.sql','representation-family.sql','warning-scale.sql','nickname.sql']) {
    results.push(...await db.exec(await readFile(path.join(root, 'tests', testFile), 'utf8')));
  }
  const assertions = results.flatMap(result => result.rows ?? []).filter(row => 'passed' in row);
  if (!assertions.length) throw new Error('No database assertions were reported');
  if (process.argv.includes('--verbose')) for (const row of assertions) console.log(`PASS ${row.name}`);
  console.log(`Database assertions: ${assertions.length} passed; embedded PostgreSQL, auth fixture only.`);
} catch (error) {
  console.error(`Database check failed: ${error.message}${error.detail ? `; ${error.detail}` : ''}${error.where ? `; ${error.where}` : ''}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
