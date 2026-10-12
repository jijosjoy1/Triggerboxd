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
  const results = await db.exec(await readFile(path.join(root, 'tests', 'launch.sql'), 'utf8'));
  const assertions = results.flatMap(result => result.rows ?? []).filter(row => 'passed' in row);
  if (!assertions.length) throw new Error('No database assertions were reported');
  if (process.argv.includes('--verbose')) for (const row of assertions) console.log(`PASS ${row.name}`);
  console.log(`Database assertions: ${assertions.length} passed; embedded PostgreSQL, auth fixture only.`);
} finally {
  await db.close();
}
