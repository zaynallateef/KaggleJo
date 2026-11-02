-- Public read/submission RPCs; all table writes and reviews remain private.
begin;

create table public.kagglejo_snapshots (
  id boolean primary key default true check (id),
  payload jsonb not null,
  source_updated_at timestamptz not null,
  published_at timestamptz not null default now()
);

create table public.kagglejo_memberships (
  username text primary key check (username ~ '^[a-z0-9_]{3,50}$'),
  kaggle_id bigint not null unique check (kaggle_id > 0),
  display_name text not null check (length(display_name) between 1 and 150),
  city text not null check (city in ('Amman','Irbid','Zarqa','Aqaba','Salt','Madaba','Karak','Mafraq','Ajloun','Jerash','Tafilah','Maan','Other','Not specified')),
  evidence_url text not null check (evidence_url = 'https://www.kaggle.com/' || username),
  review_basis text not null check (review_basis in ('public_profile','owner_opt_in')),
  review_note text not null check (length(trim(review_note)) between 5 and 2000),
  reviewed_at timestamptz not null default now(),
  search_available boolean not null default true,
  revoked_at timestamptz
);

create table public.kagglejo_nominations (
  username text primary key check (username ~ '^[a-z0-9_]{3,50}$'),
  city text not null,
  evidence_url text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);

create table public.kagglejo_submission_limits (
  day date primary key,
  count integer not null check (count between 1 and 100)
);

alter table public.kagglejo_snapshots enable row level security;
alter table public.kagglejo_memberships enable row level security;
alter table public.kagglejo_nominations enable row level security;
alter table public.kagglejo_submission_limits enable row level security;
revoke all on public.kagglejo_snapshots, public.kagglejo_memberships,
  public.kagglejo_nominations, public.kagglejo_submission_limits from public, anon, authenticated;
grant all on public.kagglejo_snapshots, public.kagglejo_memberships,
  public.kagglejo_nominations, public.kagglejo_submission_limits to service_role;

-- Expose only published public fields and active approvals, never review notes
-- or pending nominations. Definer is needed because callers cannot read tables.
create function public.kagglejo_directory() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'snapshot', (select payload from public.kagglejo_snapshots where id),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object(
      'username', username, 'kaggle_id', kaggle_id, 'display_name', display_name,
      'city', city, 'evidence_url', evidence_url, 'review_basis', review_basis,
      'reviewed_at', reviewed_at) order by username)
      from public.kagglejo_memberships where revoked_at is null and search_available), '[]'::jsonb)
  );
$$;

create function public.kagglejo_nominate(
  p_username text, p_city text, p_evidence_url text, p_confirmed boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  candidate text := lower(trim(p_username));
  used integer;
begin
  if candidate is null or candidate !~ '^[a-z0-9_]{3,50}$'
      or p_city is null or p_city not in ('Amman','Irbid','Zarqa','Aqaba','Salt','Madaba','Karak','Mafraq','Ajloun','Jerash','Tafilah','Maan','Other','Not specified')
      or p_evidence_url is null or rtrim(lower(trim(p_evidence_url)), '/') not in
        ('https://www.kaggle.com/' || candidate, 'https://kaggle.com/' || candidate)
      or p_confirmed is distinct from true then
    raise exception using errcode = '22023', message = 'Use a matching Kaggle profile link, choose a city, and confirm the public Jordan connection.';
  end if;
  -- Global daily cap, not a spoofable client-IP limit. Serialize the counter and
  -- duplicate check so concurrent calls cannot exceed the cap.
  perform pg_advisory_xact_lock(1726041102);
  if exists (select 1 from public.kagglejo_memberships where username = candidate and revoked_at is null)
      or exists (select 1 from public.kagglejo_nominations where username = candidate) then
    return jsonb_build_object('message', 'This profile has already been submitted. An operator can check its review status.');
  end if;
  delete from public.kagglejo_submission_limits where day < (now() at time zone 'UTC')::date;
  select count into used from public.kagglejo_submission_limits where day = (now() at time zone 'UTC')::date;
  if coalesce(used, 0) >= 100 then
    raise exception using errcode = 'P0001', message = 'The community submission limit was reached. Please try again tomorrow.';
  end if;
  insert into public.kagglejo_submission_limits(day,count) values ((now() at time zone 'UTC')::date,1)
    on conflict (day) do update set count = public.kagglejo_submission_limits.count + 1;
  insert into public.kagglejo_nominations(username,city,evidence_url)
    values (candidate,p_city,'https://www.kaggle.com/' || candidate);
  return jsonb_build_object('message', 'Profile submitted for review. It will become searchable after its Jordan connection is approved.');
end;
$$;

-- Publication is one transaction. A failed or older import cannot replace the
-- last successful snapshot. Only a trusted automation key may call this RPC.
create function public.kagglejo_publish(p_snapshot jsonb, p_checks jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  stamp timestamptz;
  previous timestamptz;
  item jsonb;
begin
  if p_snapshot is null or p_snapshot->>'schema_version' is distinct from '1'
      or p_snapshot#>>'{meta,mode}' is distinct from 'live'
      or jsonb_typeof(p_snapshot->'members') is distinct from 'array'
      or jsonb_typeof(p_snapshot->'rankings') is distinct from 'object'
      or jsonb_typeof(p_snapshot->'profiles') is distinct from 'object'
      or jsonb_typeof(p_snapshot->'overviews') is distinct from 'object' then
    raise exception 'Expected a complete public snapshot.';
  end if;
  if jsonb_array_length(p_snapshot->'members') = 0
      or exists (select 1 from jsonb_array_elements(p_snapshot->'members') m where m->>'is_demo' is distinct from '0') then
    raise exception 'Refusing an empty or demonstration snapshot.';
  end if;
  stamp := (p_snapshot#>>'{meta,updated_at}')::timestamptz;
  if stamp is null or stamp > now() then raise exception 'Invalid snapshot timestamp.'; end if;
  perform pg_advisory_xact_lock(1726041103);
  select source_updated_at into previous from public.kagglejo_snapshots where id;
  if previous > stamp then raise exception 'Refusing to replace newer data.'; end if;
  if jsonb_typeof(p_checks) is distinct from 'array' then raise exception 'Invalid membership checks.'; end if;
  for item in select value from jsonb_array_elements(p_checks) loop
    if item->>'username' is null or item->>'username' !~ '^[a-z0-9_]{3,50}$'
        or jsonb_typeof(item->'available') is distinct from 'boolean'
        or item->>'kaggle_id' is null or item->>'reviewed_at' is null then
      raise exception 'Invalid membership check.';
    end if;
    -- A slow sync cannot override a newer operator review or a different ID.
    update public.kagglejo_memberships set search_available = (item->>'available')::boolean
      where username = item->>'username' and kaggle_id = (item->>'kaggle_id')::bigint
        and reviewed_at = (item->>'reviewed_at')::timestamptz and reviewed_at <= stamp;
  end loop;
  insert into public.kagglejo_snapshots(id,payload,source_updated_at,published_at)
    values(true,p_snapshot,stamp,now()) on conflict(id) do update
    set payload=excluded.payload,source_updated_at=excluded.source_updated_at,published_at=excluded.published_at;
  return jsonb_build_object('members',jsonb_array_length(p_snapshot->'members'),'updated_at',stamp);
end;
$$;

revoke all on function public.kagglejo_directory() from public, anon, authenticated;
revoke all on function public.kagglejo_nominate(text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.kagglejo_publish(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.kagglejo_directory() to anon, authenticated, service_role;
grant execute on function public.kagglejo_nominate(text,text,text,boolean) to anon, authenticated, service_role;
grant execute on function public.kagglejo_publish(jsonb,jsonb) to service_role;

commit;
