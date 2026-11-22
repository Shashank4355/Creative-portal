-- Creative performance portal schema. Written for Supabase Postgres.
-- Locally it runs on PGlite with a stand-in auth.uid() that reads the JWT claims
-- the same way Supabase does, so the RLS policies below are the ones that ship.

create schema if not exists auth;
create or replace function auth.uid() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;

create table app_users (
  id text primary key,                 -- Supabase auth user id
  email text not null,
  role text not null check (role in ('manager', 'strategist', 'editor')),
  person text not null                 -- name as it appears in the tracker sheet
);

create table creatives (
  ad_id text primary key,
  ad_name text not null,
  code text,
  concept text, format text, hook text,
  strategist text, editor text,
  launch_date date,
  match_method text not null,          -- 'name_code' | 'sheet_ad_id' | 'unmatched' | 'conflict'
  note text
);

create table ad_daily (
  date date not null,
  ad_id text not null references creatives(ad_id),
  spend numeric(12,2) not null,
  impressions bigint not null,
  clicks int not null,
  video_3s int not null,
  thruplays int not null,
  purchases int not null,
  purchase_value numeric(12,2) not null,
  pulled_at timestamptz not null default now(),
  primary key (date, ad_id)
);

create table account_daily (
  date date primary key,
  spend numeric(12,2), purchases int, purchase_value numeric(12,2)
);

create table shopify_daily (
  date date primary key,
  orders int, net_sales numeric(12,2), refunds numeric(12,2),
  meta_utm_orders int, meta_utm_net_sales numeric(12,2)
);

create table sync_runs (
  id serial primary key,
  started_at timestamptz default now(), finished_at timestamptz,
  status text, meta_calls int, meta_throttles int, shopify_calls int, shopify_429 int
);

create table data_checks (
  run_id int references sync_runs(id),
  date date,
  check_name text,
  status text check (status in ('pass', 'warn', 'fail', 'info')),
  expected numeric, actual numeric,
  detail text
);

-- A day only reaches the leaderboard once its checks pass.
create table published_dates (date date primary key, run_id int, published_at timestamptz default now());

create table launch_requests (
  id serial primary key,
  idempotency_key text unique not null,
  requested_by text not null references app_users(id),
  ad_name text not null,
  campaign_id text not null,
  creative_id text not null,
  daily_budget_cents int not null check (daily_budget_cents > 0 and daily_budget_cents <= 50000),  -- hard ceiling, $500/day per test
  meta_adset_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'created', 'failed')),
  reviewed_by text references app_users(id),
  meta_ad_id text,
  error text,
  created_at timestamptz default now()
);

create table audit_log (id serial primary key, at timestamptz default now(), actor text, action text, detail jsonb);

-- helpers -------------------------------------------------------------------
create or replace function me_role() returns text language sql stable security definer set search_path = public as $$
  select role from app_users where id = auth.uid()
$$;
create or replace function me_person() returns text language sql stable security definer set search_path = public as $$
  select person from app_users where id = auth.uid()
$$;

-- reporting view: published days, attributed creatives only ---------------------
create view creative_perf with (security_invoker = true) as
select c.ad_id, c.ad_name, c.code, c.concept, c.format, c.hook, c.strategist, c.editor, c.launch_date,
       sum(d.spend) spend, sum(d.impressions) impressions, sum(d.clicks) clicks,
       sum(d.video_3s) video_3s, sum(d.thruplays) thruplays,
       sum(d.purchases) purchases, sum(d.purchase_value) purchase_value
from creatives c
join ad_daily d on d.ad_id = c.ad_id
join published_dates p on p.date = d.date
where c.match_method in ('name_code', 'sheet_ad_id')
group by c.ad_id;

-- RLS -----------------------------------------------------------------------
alter table app_users enable row level security;
alter table creatives enable row level security;
alter table ad_daily enable row level security;
alter table account_daily enable row level security;
alter table shopify_daily enable row level security;
alter table data_checks enable row level security;
alter table sync_runs enable row level security;
alter table published_dates enable row level security;
alter table launch_requests enable row level security;
alter table audit_log enable row level security;

create policy self_read on app_users for select to authenticated using (id = auth.uid() or me_role() = 'manager');

create policy creatives_read on creatives for select to authenticated using (
  me_role() = 'manager'
  or (me_role() = 'strategist' and strategist = me_person())
  or (me_role() = 'editor' and editor = me_person())
);
create policy ad_daily_read on ad_daily for select to authenticated using (
  exists (select 1 from creatives c where c.ad_id = ad_daily.ad_id)   -- inherits creatives_read
);
-- account totals and Shopify revenue are manager-only
create policy account_read on account_daily for select to authenticated using (me_role() = 'manager');
create policy shopify_read on shopify_daily for select to authenticated using (me_role() = 'manager');
create policy checks_read on data_checks for select to authenticated using (true);
create policy runs_read on sync_runs for select to authenticated using (true);
create policy published_read on published_dates for select to authenticated using (true);

create policy launch_insert on launch_requests for insert to authenticated with check (
  requested_by = auth.uid() and me_role() in ('strategist', 'manager') and status = 'pending'
);
create policy launch_read on launch_requests for select to authenticated using (requested_by = auth.uid() or me_role() = 'manager');
create policy launch_review on launch_requests for update to authenticated
  using (me_role() = 'manager' and status = 'pending')
  with check (reviewed_by = auth.uid() and reviewed_by <> requested_by and status in ('approved', 'rejected'));
create policy audit_read on audit_log for select to authenticated using (me_role() = 'manager');

grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant insert on launch_requests to authenticated;
grant update (status, reviewed_by) on launch_requests to authenticated;  -- reviewers cannot touch budget or requester
grant usage on all sequences in schema public to authenticated;
grant execute on function auth.uid(), me_role(), me_person() to authenticated;
-- anon gets nothing at all
