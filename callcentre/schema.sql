-- Harvesters Church Outreach Call Centre
-- Run this entire file once in Supabase: SQL Editor > New query > Run.
-- Safe to re-run: every statement is idempotent, so running this again after an
-- earlier partial run (or to pick up a schema update) will not error or duplicate data.
-- Before running the first time, replace the email in the INSERT below with the
-- call-centre admin's email.

create extension if not exists pgcrypto;

create table if not exists public.admin_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- CHANGE THIS EMAIL BEFORE RUNNING.
insert into public.admin_allowlist (email) values ('akinlabitobi.abraham@gmail.com')
on conflict (email) do nothing;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Agents sign in with phone + PIN, not email. Supabase Auth still requires
-- an email identity under the hood, so the app derives one automatically
-- from the phone number and stores it in the existing `email` column -- the
-- agent never sees or types it. `phone` is the real, admin-entered, unique
-- lookup key.
--
-- Two dead ends this went through, kept here so nobody re-tries them:
-- (1) An invented domain (a2348012345678@agent.harvesters.internal) is
--     rejected by Supabase's signup validation with "email_address_invalid"
--     -- it checks that the email's domain can actually receive mail, and a
--     made-up domain (or an unconfigured subdomain of a real one) has no
--     mail records. (2) Supabase's native phone auth avoids that, but its
--     Phone provider requires configuring a real SMS provider (Twilio/
--     MessageBird/Vonage/etc.) before it can be enabled at all -- a cost and
--     a signup this project has no reason to take on just to never actually
--     send an SMS. The fix that actually works, used below: derive the
--     email on harvestersng.org itself -- a domain that already has real
--     mail records (Microsoft 365), confirmed live. No mailbox needs to
--     exist at that address; Supabase only checks the domain, and
--     confirmation emails are never sent because "Confirm email" is
--     disabled for this project (Authentication > Providers > Email).
alter table public.agents add column if not exists phone text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agents_phone_unique') then
    alter table public.agents add constraint agents_phone_unique unique (phone);
  end if;
end $$;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  full_name text not null,
  phone text not null,
  email_or_area text,
  group_name text,
  segment text,
  source text,
  priority text,
  previous_response text,
  assigned_agent_id uuid references public.agents(id) on delete set null,
  status text not null default 'Not started' check (status in ('Not started','Attempted','Reached','Not reached','Prayer request','Needs follow-up','Will attend','Wrong number','Do not contact')),
  follow_up_date date,
  do_not_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Do they need a bus? If yes, where?" -- from the live call-logging form,
-- matching the same field on the source call sheet.
alter table public.contacts add column if not exists needs_bus boolean;
alter table public.contacts add column if not exists bus_pickup_location text;
-- Ticked when a contact asks for the church location to be sent on
-- WhatsApp -- reveals the WhatsApp button immediately in the same call
-- card (see app.js), and persists so it stays available on later visits
-- even if the call's outcome status wouldn't otherwise show the button.
alter table public.contacts add column if not exists wants_location boolean not null default false;
-- Ticked when a contact explicitly says they'd rather be reached on
-- WhatsApp than by phone -- unlike wants_location (a one-off "send me the
-- address"), this is a standing channel preference: it permanently unlocks
-- the WhatsApp button for this contact from then on, regardless of status,
-- so an agent isn't stuck calling someone who already said not to.
alter table public.contacts add column if not exists prefers_whatsapp boolean not null default false;

-- A plain unique CONSTRAINT on the real columns, not an expression index.
-- The original version indexed coalesce(campaign_id, <sentinel>) so that
-- two contacts with no campaign at all would still collide on phone --
-- but every import path always sets a campaign_id, so that edge case never
-- happens in practice, and an expression index can never be targeted by a
-- plain "ON CONFLICT (campaign_id, phone)" upsert (Postgres requires the
-- conflict target to match a real constraint on those exact columns). That
-- mismatch is what caused every import to fail with "no unique or
-- exclusion constraint matching the ON CONFLICT specification."
drop index if exists contacts_unique_phone_per_campaign;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_campaign_phone_unique') then
    alter table public.contacts add constraint contacts_campaign_phone_unique unique (campaign_id, phone);
  end if;
end $$;

-- Ministry-sensitive notes live in their own table, restricted to admins only
-- (see RLS policies below). They used to be a column on contacts, which row-
-- level security cannot hide on a per-column basis -- any agent with access
-- to the row could read it. A separate table is what actually enforces
-- "care/pastoral team only." This block migrates any existing data and is
-- safe to run whether or not the old column ever existed.
create table if not exists public.contact_private_notes (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  note text,
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contacts' and column_name = 'private_note'
  ) then
    insert into public.contact_private_notes (contact_id, note)
    select id, private_note from public.contacts
    where private_note is not null and trim(private_note) <> ''
    on conflict (contact_id) do update set note = excluded.note;
    alter table public.contacts drop column private_note;
  end if;
end $$;

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  dial_opened_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text check (outcome in ('Reached','Not reached','Prayer request','Needs follow-up','Will attend','Wrong number','Do not contact')),
  notes text,
  created_at timestamptz not null default now()
);

-- Accountability additions: a required note per completed call, automatic
-- flagging of suspicious entries, an admin review flag, and columns to track
-- an optional automated follow-up message (SMS/WhatsApp) once a provider is
-- connected. All added via ALTER so this file stays safe to re-run on a
-- database that already has the original table.
alter table public.call_logs add column if not exists flags text[] not null default '{}';
alter table public.call_logs add column if not exists reviewed boolean not null default false;
-- Seconds the agent's browser tab was in the background between tapping
-- "Call now" and returning to the app, detected automatically via the
-- browser's Page Visibility API (no phone permission exists for this, and
-- none is requested -- this only measures time away from the web page, not
-- an actual verified call from the carrier or device call log).
alter table public.call_logs add column if not exists away_seconds integer;
alter table public.call_logs add column if not exists followup_channel text;
alter table public.call_logs add column if not exists followup_status text not null default 'not_sent';
alter table public.call_logs add column if not exists followup_provider_id text;
alter table public.call_logs add column if not exists followup_sent_at timestamptz;
-- 'app' = a real-time agent log through the call centre UI, held to the
-- live-honesty checks below (required note, away-time flagging). 'import' =
-- backfilled from a spreadsheet of already-completed calls (e.g. a prior
-- Google Sheets exercise) -- historical data, not something to flag as
-- suspicious just because it lacks a fresh note or a measured away-time.
alter table public.call_logs add column if not exists source text not null default 'app';
-- 'call' = a phone attempt via "Call now", held to the full honesty checks.
-- 'whatsapp' = the agent clicked the WhatsApp button -- proves they opened a
-- chat window, nothing more (no delivery/read receipt, no message content),
-- so it is deliberately excluded from the note-length and flagging rules
-- built for phone accountability. It exists purely so WhatsApp use is
-- counted at all instead of being invisible, per the admin's request.
alter table public.call_logs add column if not exists channel text not null default 'call';

-- Notes used to be required (>=10 chars) on a completed live call. Dropped
-- on request -- it was the actual cause of saves silently failing: a real,
-- short note like "no answer" (9 characters) or one entered with only
-- whitespace would fail this constraint just as much as leaving the field
-- blank, and the agent had no way to tell why. Notes are now fully
-- optional; see flag_call_log() below for how "no note at all" and "typed
-- something too brief to mean much" are told apart in admin review.
alter table public.call_logs drop constraint if exists call_logs_notes_required_on_completion;

-- Re-run these on every execution (drop + add) rather than "add if missing",
-- so an updated constraint definition actually takes effect on databases
-- that already had an older version of it.
alter table public.call_logs drop constraint if exists call_logs_followup_status_check;
alter table public.call_logs add constraint call_logs_followup_status_check
  check (followup_status in ('not_sent','queued','sent','delivered','read','failed'));

alter table public.call_logs drop constraint if exists call_logs_source_check;
alter table public.call_logs add constraint call_logs_source_check check (source in ('app','import'));

alter table public.call_logs drop constraint if exists call_logs_channel_check;
alter table public.call_logs add constraint call_logs_channel_check check (channel in ('call','whatsapp'));

-- The specific "Call Reached?" button the agent tapped (Yes / No Answer /
-- Switched Off / Invalid Number / Busy). Not Answer/Switched Off/Busy all
-- collapse into the single contacts.status value 'Not reached' -- accurate
-- for the funnel, but it throws away *why* a call didn't connect. This
-- keeps that detail so both agents and admins can see the actual
-- breakdown (e.g. "half of your unreachable dials were Switched Off"),
-- not just a single lumped bucket.
alter table public.call_logs add column if not exists reach_detail text;
alter table public.call_logs drop constraint if exists call_logs_reach_detail_check;
alter table public.call_logs add constraint call_logs_reach_detail_check
  check (reach_detail is null or reach_detail in ('Yes','No Answer','Switched Off','Invalid Number','Busy'));

-- Independent verification calls: an admin pulls a random sample of completed
-- calls and personally confirms with the contact that the call really happened.
-- Results are admin-only (never shown per-agent) so the check stays unbiased;
-- only the aggregate weekly count is exposed to agents via weekly_audit_count().
create table if not exists public.call_audits (
  id uuid primary key default gen_random_uuid(),
  call_log_id uuid not null references public.call_logs(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  result text not null check (result in ('Confirmed','Contact denies call','Could not reach for verification','Voicemail or inconclusive')),
  notes text,
  audited_by text not null default lower(coalesce(auth.jwt() ->> 'email','')),
  created_at timestamptz not null default now()
);

-- A single shared call script, editable by an admin, readable by every
-- signed-in agent -- kept as one flat text block (not per-contact, no
-- branching) so agents can glance at it without leaving the app mid-call,
-- while the actual drafting/collaboration on wording still happens
-- wherever it always has (e.g. Google Docs); this just carries the
-- current version into the app instead of requiring a tab switch.
-- The `id boolean primary key default true check (id)` trick forces this
-- table to hold exactly one row, ever -- there's only one script.
create table if not exists public.call_script (
  id boolean primary key default true check (id),
  content text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.call_script (id) values (true) on conflict (id) do nothing;
-- Same single-row pattern as `content` above, for the WhatsApp
-- location-share message -- kept on this same row rather than a new
-- table, since it's the same shape of thing (one shared, admin-editable
-- block of text every agent reads). Defaults to the exact placeholder
-- text that used to be hardcoded in app.js, so nothing changes for
-- anyone until an admin actually edits it in from the Agents tab.
alter table public.call_script add column if not exists whatsapp_template text not null default 'Hello! Thank you for speaking with us today. Here is our location: [add the church address here]. We look forward to seeing you!';

create index if not exists contacts_assigned_agent_idx on public.contacts (assigned_agent_id);
create index if not exists call_logs_contact_idx on public.call_logs (contact_id);
create index if not exists call_audits_call_log_idx on public.call_audits (call_log_id);
create index if not exists call_audits_agent_idx on public.call_audits (agent_id);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_allowlist a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.current_agent_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.agents where auth_user_id = auth.uid() limit 1;
$$;

-- Lets a signed-in agent set their own display name -- used right after
-- first-time PIN setup, when the admin bulk-added a phone number without
-- typing a name for it (see the Agents tab's "Quick-add phone numbers").
-- Scoped hard to the caller's own agent row via current_agent_id(); there
-- is no path for an agent to rename anyone else.
create or replace function public.set_my_display_name(new_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_agent_id() is null then
    raise exception 'not an agent';
  end if;
  if new_name is null or char_length(trim(new_name)) < 2 then
    raise exception 'name too short';
  end if;
  update public.agents set display_name = trim(new_name), updated_at = now() where id = public.current_agent_id();
end;
$$;
grant execute on function public.set_my_display_name(text) to authenticated;

create or replace function public.attach_new_user_to_agent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.agents
  set auth_user_id = new.id, updated_at = now()
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end;
$$;

-- Callable while signed out, so the phone+PIN login screen knows which of
-- three states a phone number is in, and can show the agent's name back to
-- them as a "is this really me" confirmation before they set or enter a
-- PIN. Once a phone number is recognised at all, showing the name it's
-- registered under is no bigger a leak than the login flow itself already
-- is (see README loophole notes) -- an unrecognised number still gets
-- nothing back beyond 'unknown'.
drop function if exists public.agent_login_kind(text);
create or replace function public.agent_login_kind(p_phone text)
returns table(kind text, agent_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  rec record;
begin
  select id, auth_user_id, display_name into rec from public.agents where phone = p_phone and active = true limit 1;
  if rec.id is null then
    return query select 'unknown'::text, null::text;
  elsif rec.auth_user_id is null then
    return query select 'needs_pin'::text, rec.display_name;
  else
    return query select 'has_account'::text, rec.display_name;
  end if;
end;
$$;
grant execute on function public.agent_login_kind(text) to anon, authenticated;

-- Genuine self-service signup: callable while signed out, so anyone can
-- register a phone number + name for themselves with no admin step first.
-- The actual protection in this app isn't "who's allowed to become an
-- agent" -- it's that a brand-new agent starts with zero assigned contacts
-- (RLS on contacts only ever shows a row where assigned_agent_id matches
-- current_agent_id()) and stays that way until an admin deliberately hands
-- them contacts via Allocate. So a self-registered account that nobody
-- ever allocates to just sees an empty queue -- no member data is exposed
-- by registering. Refuses to touch a phone number that already has a
-- linked auth account (that phone must sign in with its existing PIN
-- instead), so this can't be used to hijack someone else's number.
create or replace function public.self_register_agent(p_phone text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  existing record;
  derived_email text;
begin
  if p_phone is null or char_length(p_phone) < 10 then
    raise exception 'Enter a valid phone number.';
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'Enter your name.';
  end if;
  -- harvestersng.org has real mail records, so Supabase's signup validation
  -- accepts this; see the long comment by the `phone` column above.
  derived_email := 'outreach-agent-' || regexp_replace(p_phone, '\D', '', 'g') || '@harvestersng.org';
  select id, auth_user_id, active into existing from public.agents where phone = p_phone limit 1;
  if existing.id is not null then
    if existing.auth_user_id is not null then
      if not existing.active then
        raise exception 'This account has been deactivated. Contact your admin.';
      end if;
      raise exception 'This phone number already has an account. Enter your PIN instead.';
    end if;
    update public.agents set display_name = trim(p_name), email = derived_email, active = true where id = existing.id;
  else
    insert into public.agents (display_name, phone, email, active)
    values (trim(p_name), p_phone, derived_email, true);
  end if;
end;
$$;
grant execute on function public.self_register_agent(text, text) to anon, authenticated;

drop trigger if exists on_auth_user_created_attach_agent on auth.users;
create trigger on_auth_user_created_attach_agent
after insert on auth.users for each row execute procedure public.attach_new_user_to_agent();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists agents_touch_updated_at on public.agents;
create trigger agents_touch_updated_at before update on public.agents for each row execute procedure public.touch_updated_at();
drop trigger if exists contacts_touch_updated_at on public.contacts;
create trigger contacts_touch_updated_at before update on public.contacts for each row execute procedure public.touch_updated_at();
drop trigger if exists contact_private_notes_touch_updated_at on public.contact_private_notes;
create trigger contact_private_notes_touch_updated_at before update on public.contact_private_notes for each row execute procedure public.touch_updated_at();
drop trigger if exists call_script_touch_updated_at on public.call_script;
create trigger call_script_touch_updated_at before update on public.call_script for each row execute procedure public.touch_updated_at();

-- Marks a completed call as suspicious for a human to double check: logged in
-- under 10 seconds (no real conversation could have happened), a note too
-- short to mean anything, or the same wording reused across recent calls by
-- the same agent. This is a prompt for a caring check-in, never automatic
-- discipline.
create or replace function public.flag_call_log()
returns trigger language plpgsql as $$
declare
  dup_count int;
begin
  if new.completed_at is not null and (new.source <> 'app' or new.channel <> 'call') then
    new.flags := array[]::text[];
  elsif new.completed_at is not null then
    new.flags := array[]::text[];
    if new.away_seconds is not null then
      if new.away_seconds < 5 then
        new.flags := array_append(new.flags, 'no_time_away');
      end if;
    elsif extract(epoch from (new.completed_at - new.dial_opened_at)) < 10 then
      new.flags := array_append(new.flags, 'fast_completion');
    end if;
    -- Notes are optional now, so a blank note is normal and not flagged --
    -- only something typed but too brief to carry real information.
    if new.notes is not null and char_length(trim(new.notes)) between 1 and 9 then
      new.flags := array_append(new.flags, 'short_note');
    end if;
    if new.notes is not null then
      select count(*) into dup_count
      from public.call_logs cl
      where cl.agent_id = new.agent_id
        and cl.id <> new.id
        and cl.completed_at is not null
        and cl.completed_at > now() - interval '7 days'
        and lower(trim(cl.notes)) = lower(trim(new.notes));
      if dup_count > 0 then
        new.flags := array_append(new.flags, 'duplicate_note');
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists call_logs_flag on public.call_logs;
create trigger call_logs_flag before insert or update on public.call_logs
for each row execute procedure public.flag_call_log();

-- Admin-only: pulls a random sample of completed calls that have not been
-- audited in the last 14 days, for a spot-check callback.
create or replace function public.get_audit_sample(sample_size int default 5)
returns table (
  call_log_id uuid, contact_id uuid, contact_name text, phone text,
  agent_id uuid, agent_name text, outcome text, notes text, completed_at timestamptz, away_seconds int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select cl.id, c.id, c.full_name, c.phone, a.id, a.display_name, cl.outcome, cl.notes, cl.completed_at, cl.away_seconds
    from public.call_logs cl
    join public.contacts c on c.id = cl.contact_id
    join public.agents a on a.id = cl.agent_id
    where cl.completed_at is not null
      and not exists (
        select 1 from public.call_audits ca
        where ca.call_log_id = cl.id and ca.created_at > now() - interval '14 days'
      )
    order by random()
    limit sample_size;
end;
$$;
grant execute on function public.get_audit_sample(int) to authenticated;

-- Any signed-in user (including agents) can see how many verification calls
-- happened team-wide this week, without seeing who was checked. This is a
-- truthful deterrent: agents know audits are real and ongoing, without any
-- per-agent detail being exposed.
create or replace function public.weekly_audit_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.call_audits where created_at >= now() - interval '7 days';
$$;
grant execute on function public.weekly_audit_count() to authenticated;

-- Leader/integrity-check contacts -------------------------------------------
-- Real church leaders' phone numbers, deliberately mixed into agents' normal
-- assigned contacts (about 1 in every 15-20) so an admin can confirm agents
-- are actually dialing their list, not just marking things done. These are
-- ordinary rows in `contacts` -- reusing the entire existing call-logging
-- flow means a leader-check row is indistinguishable from a real outreach
-- contact to the agent working it, which is the whole point.
alter table public.contacts add column if not exists is_leader_check boolean not null default false;
create index if not exists contacts_leader_check_idx on public.contacts (is_leader_check) where is_leader_check;

-- Distinct contacts with at least one real phone-call attempt logged
-- (channel = 'call'), excluding leader-check rows -- a count of PEOPLE
-- dialed, not call_logs rows, since one contact can legitimately have more
-- than one dial (e.g. a first attempt with no answer, tried again later).
-- Used for the Dashboard's "Dialed" funnel stage.
drop function if exists public.dialed_count();
create or replace function public.dialed_count()
returns bigint language sql stable security definer set search_path = public as $$
  select count(distinct cl.contact_id) from public.call_logs cl
  join public.contacts c on c.id = cl.contact_id
  where cl.channel = 'call' and not c.is_leader_check;
$$;
grant execute on function public.dialed_count() to authenticated;

-- Tops the leader-check pool back up: for every distinct phone number
-- already marked is_leader_check, insert one more unassigned copy (using
-- its most recently saved name). campaign_id is left null on every
-- leader-check row on purpose -- the contacts_campaign_phone_unique
-- constraint only blocks a repeated (campaign_id, phone) pair, and
-- Postgres never treats two NULLs as equal for uniqueness, so any number
-- of null-campaign copies of the same phone are allowed. That's what lets
-- the same ~20-30 leader numbers be reused across many allocation rounds
-- and many agents instead of being a one-time, use-once pool.
drop function if exists public.refill_leader_checks();
create or replace function public.refill_leader_checks()
returns integer language plpgsql security definer set search_path = public as $$
declare
  inserted integer;
begin
  if not public.is_admin() then
    raise exception 'Admin only.';
  end if;
  insert into public.contacts (full_name, phone, is_leader_check, status)
  select distinct on (phone) full_name, phone, true, 'Not started'
  from public.contacts
  where is_leader_check
  order by phone, created_at desc;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
grant execute on function public.refill_leader_checks() to authenticated;

-- Admin-only: a live per-agent report computed straight from contacts and
-- their current status -- every number here is a query result, nothing is
-- ever typed or stored by hand. Mirrors the "live dashboard" pattern from
-- spreadsheet call sheets (Assigned / Logged / outcome breakdown / % done)
-- but works for any campaign, past or ongoing, not just one imported sheet.
-- Drop the old zero-argument version first: a default-parameter function is
-- still a distinct signature from create or replace's point of view, so
-- without this a database that already ran an earlier version of this file
-- would end up with two overloads and an ambiguous "which one did you mean"
-- error on every zero-argument call.
drop function if exists public.agent_summary();
-- Adding the `connected` column below changes the function's row type just
-- like adding a parameter did earlier -- same "cannot change return type"
-- error unless the existing (uuid) version is dropped first.
drop function if exists public.agent_summary(uuid);

-- p_campaign_id: pass a specific campaign's id to report on just that
-- campaign (e.g. "July Service" after "August Service" has started, so the
-- two never blend together). Leave it null for the default view: every
-- contact in an active campaign, plus any contact never assigned to a
-- campaign at all -- contacts belonging to a campaign an admin has switched
-- to inactive (see campaigns.active) drop out of this default view, though
-- their historical data is untouched and still reachable by id.
create or replace function public.agent_summary(p_campaign_id uuid default null)
returns table (
  agent_id uuid,
  agent_name text,
  assigned bigint,
  calls_logged bigint,
  connected bigint,
  reached bigint,
  not_reached bigint,
  no_answer bigint,
  switched_off bigint,
  busy bigint,
  wrong_number bigint,
  will_attend bigint,
  needs_follow_up bigint,
  prayer_request bigint,
  do_not_contact bigint,
  whatsapp_sent bigint,
  pct_done numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select
      a.id,
      a.display_name,
      count(distinct c.id) as assigned,
      count(distinct c.id) filter (where c.status <> 'Not started') as calls_logged,
      -- Matches "Call Reached?" from a spreadsheet-style call sheet: the
      -- call connected at all, regardless of what the person said. This is
      -- broader than the `reached` status below, which only counts a
      -- connected call where the response was a flat no (a Yes routes to
      -- Will attend, a Maybe to Needs follow-up) -- comparing this column
      -- against a spreadsheet's "Reached" total is the fair comparison,
      -- not the `reached` column.
      count(distinct c.id) filter (where c.status not in ('Not started','Not reached','Wrong number')) as connected,
      count(distinct c.id) filter (where c.status = 'Reached') as reached,
      count(distinct c.id) filter (where c.status = 'Not reached') as not_reached,
      -- Breaks the single 'Not reached' status down by the actual reason
      -- the agent picked, using each contact's most recent completed call
      -- (latest.reach_detail below) -- so no_answer + switched_off + busy
      -- adds back up to not_reached above.
      count(distinct c.id) filter (where latest.reach_detail = 'No Answer') as no_answer,
      count(distinct c.id) filter (where latest.reach_detail = 'Switched Off') as switched_off,
      count(distinct c.id) filter (where latest.reach_detail = 'Busy') as busy,
      count(distinct c.id) filter (where c.status = 'Wrong number') as wrong_number,
      count(distinct c.id) filter (where c.status = 'Will attend') as will_attend,
      count(distinct c.id) filter (where c.status = 'Needs follow-up') as needs_follow_up,
      count(distinct c.id) filter (where c.status = 'Prayer request') as prayer_request,
      count(distinct c.id) filter (where c.do_not_contact) as do_not_contact,
      coalesce(w.whatsapp_sent, 0) as whatsapp_sent,
      case when count(distinct c.id) = 0 then 0
        else round(100.0 * count(distinct c.id) filter (where c.status <> 'Not started') / count(distinct c.id), 1)
      end as pct_done
    from public.agents a
    left join public.contacts c on c.assigned_agent_id = a.id
      and not c.is_leader_check
      and (
        (p_campaign_id is not null and c.campaign_id = p_campaign_id)
        or (p_campaign_id is null and (c.campaign_id is null or c.campaign_id in (select id from public.campaigns where active)))
      )
    left join (
      select distinct on (cl.contact_id) cl.contact_id, cl.reach_detail
      from public.call_logs cl
      where cl.completed_at is not null and cl.channel = 'call'
      order by cl.contact_id, cl.completed_at desc
    ) latest on latest.contact_id = c.id
    left join (
      select cl.agent_id, count(*) as whatsapp_sent
      from public.call_logs cl
      join public.contacts cc on cc.id = cl.contact_id
      where cl.channel = 'whatsapp'
        and not cc.is_leader_check
        and (
          (p_campaign_id is not null and cc.campaign_id = p_campaign_id)
          or (p_campaign_id is null and (cc.campaign_id is null or cc.campaign_id in (select id from public.campaigns where active)))
        )
      group by cl.agent_id
    ) w on w.agent_id = a.id
    group by a.id, a.display_name, w.whatsapp_sent
    order by a.display_name;
end;
$$;
grant execute on function public.agent_summary(uuid) to authenticated;

alter table public.admin_allowlist enable row level security;
alter table public.agents enable row level security;
alter table public.campaigns enable row level security;
alter table public.contacts enable row level security;
alter table public.call_logs enable row level security;
alter table public.call_audits enable row level security;
alter table public.contact_private_notes enable row level security;
alter table public.call_script enable row level security;

drop policy if exists "admins manage agents" on public.agents;
drop policy if exists "agents read own roster" on public.agents;
drop policy if exists "admins manage campaigns" on public.campaigns;
drop policy if exists "signed in users read active campaigns" on public.campaigns;
drop policy if exists "admins manage contacts" on public.contacts;
drop policy if exists "agents read assigned contacts" on public.contacts;
drop policy if exists "agents update assigned contacts" on public.contacts;
drop policy if exists "admins manage call logs" on public.call_logs;
drop policy if exists "agents read own logs" on public.call_logs;
drop policy if exists "agents add own logs" on public.call_logs;
drop policy if exists "agents update own logs" on public.call_logs;
drop policy if exists "admins manage call audits" on public.call_audits;
drop policy if exists "admins manage private notes" on public.contact_private_notes;
drop policy if exists "admins manage call script" on public.call_script;
drop policy if exists "signed in users read call script" on public.call_script;

create policy "admins manage agents" on public.agents for all using (public.is_admin()) with check (public.is_admin());
create policy "agents read own roster" on public.agents for select using (auth_user_id = auth.uid());
create policy "admins manage campaigns" on public.campaigns for all using (public.is_admin()) with check (public.is_admin());
create policy "signed in users read active campaigns" on public.campaigns for select using (auth.uid() is not null and active = true);
create policy "admins manage contacts" on public.contacts for all using (public.is_admin()) with check (public.is_admin());
create policy "agents read assigned contacts" on public.contacts for select using (assigned_agent_id = public.current_agent_id());
create policy "agents update assigned contacts" on public.contacts for update using (assigned_agent_id = public.current_agent_id()) with check (assigned_agent_id = public.current_agent_id());
create policy "admins manage call logs" on public.call_logs for all using (public.is_admin()) with check (public.is_admin());
create policy "agents read own logs" on public.call_logs for select using (agent_id = public.current_agent_id());
create policy "agents add own logs" on public.call_logs for insert with check (agent_id = public.current_agent_id());
create policy "agents update own logs" on public.call_logs for update using (agent_id = public.current_agent_id()) with check (agent_id = public.current_agent_id());
-- Audit results are admin-only. Agents never see individual audit outcomes,
-- only the aggregate weekly count via weekly_audit_count() above -- this is
-- what keeps the check genuine instead of theatre.
create policy "admins manage call audits" on public.call_audits for all using (public.is_admin()) with check (public.is_admin());
-- Ministry-sensitive notes: admin/pastoral-team only, never visible to agents.
create policy "admins manage private notes" on public.contact_private_notes for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage call script" on public.call_script for all using (public.is_admin()) with check (public.is_admin());
create policy "signed in users read call script" on public.call_script for select using (auth.uid() is not null);

-- Do not expose the administrator email allow-list to the app.
revoke all on public.admin_allowlist from anon, authenticated;
