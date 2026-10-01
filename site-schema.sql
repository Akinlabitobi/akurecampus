-- Harvesters Akure main site: form submissions, admin accounts, sessions.
-- Run once in Supabase: SQL Editor > New query > Run. Safe to re-run.
--
-- This is a completely separate concern from callcentre/schema.sql (same
-- Supabase project, different tables, "harvesters_" prefix to avoid any
-- name collision). It exists because server.js used to store this data in
-- a local JSON file, which works fine locally but cannot work on Vercel --
-- serverless functions there run on a read-only filesystem, confirmed live
-- ("ENOENT: no such file or directory, mkdir '/var/task/data'" on every
-- write). These tables are the fix.
--
-- Access model: RLS is enabled with zero policies for anon/authenticated,
-- plus an explicit revoke as defense in depth -- the browser can NEVER
-- reach these tables directly (it never has a reason to; it only ever
-- talks to server.js's own /api/* routes). server.js is the only writer,
-- using the service_role key (SUPABASE_SERVICE_ROLE_KEY, server-only env
-- var, never shipped to the browser), which bypasses RLS by design --
-- exactly the same trust relationship the local JSON file had with the
-- Node process, just persistent instead of on-disk.

create extension if not exists pgcrypto;

create table if not exists public.harvesters_submissions (
  id uuid primary key,
  type text not null,
  fields jsonb not null default '{}'::jsonb,
  "shortCode" text,
  status text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz
);
create index if not exists harvesters_submissions_type_idx on public.harvesters_submissions (type);
create index if not exists harvesters_submissions_created_idx on public.harvesters_submissions ("createdAt");

create table if not exists public.harvesters_admins (
  id uuid primary key,
  name text not null,
  email text not null unique,
  "passwordHash" text not null,
  role text not null,
  permissions text[] not null default '{}',
  active boolean not null default true,
  "mustChangePassword" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "lastLoginAt" timestamptz
);

create table if not exists public.harvesters_sessions (
  token text primary key,
  "adminId" uuid not null,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null
);

create table if not exists public.harvesters_audit_log (
  id uuid primary key,
  "adminId" uuid,
  "adminName" text,
  action text,
  detail text,
  "createdAt" timestamptz not null default now()
);
create index if not exists harvesters_audit_log_created_idx on public.harvesters_audit_log ("createdAt");

create table if not exists public.harvesters_launch_items (
  id uuid primary key,
  item text,
  type text,
  status text,
  due text
);

-- Single-row settings, same pattern as callcentre.call_script.
create table if not exists public.harvesters_seed (
  id boolean primary key default true check (id),
  readiness int not null default 72,
  "fundsTarget" bigint not null default 12000000
);

alter table public.harvesters_submissions enable row level security;
alter table public.harvesters_admins enable row level security;
alter table public.harvesters_sessions enable row level security;
alter table public.harvesters_audit_log enable row level security;
alter table public.harvesters_launch_items enable row level security;
alter table public.harvesters_seed enable row level security;

revoke all on public.harvesters_submissions from anon, authenticated;
revoke all on public.harvesters_admins from anon, authenticated;
revoke all on public.harvesters_sessions from anon, authenticated;
revoke all on public.harvesters_audit_log from anon, authenticated;
revoke all on public.harvesters_launch_items from anon, authenticated;
revoke all on public.harvesters_seed from anon, authenticated;
