-- Restore the permission required by existing account checks and contribution RPCs.
-- The internal NOLOGIN writer already has SELECT on three auth.users columns.
-- No public grants, RLS policies or function privileges change.
grant usage on schema auth to triggerboxd_writer;
