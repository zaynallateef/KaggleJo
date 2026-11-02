begin;

alter table public.kagglejo_memberships drop constraint kagglejo_memberships_review_basis_check;
alter table public.kagglejo_memberships add constraint kagglejo_memberships_review_basis_check
  check (review_basis in ('public_profile','owner_opt_in','automatic_submission'));

-- Credential helpers live outside the exposed API schema. Only the backend
-- service role can call the invoker RPCs below or these private functions.
create schema if not exists kagglejo_private;
revoke all on schema kagglejo_private from public, anon, authenticated;
grant usage on schema kagglejo_private to service_role;

create function kagglejo_private.configure_automation(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare secret_id uuid; previous text;
begin
  if p_token is null or length(p_token) not between 20 and 4096 or p_token ~ '[[:space:]]' then
    raise exception using errcode='22023', message='Set a valid operator Kaggle API token.';
  end if;
  perform pg_advisory_xact_lock(1726041104);
  select id, decrypted_secret into secret_id, previous from vault.decrypted_secrets
    where name='kagglejo_kaggle_api_token';
  if secret_id is null then
    perform vault.create_secret(p_token,'kagglejo_kaggle_api_token','KaggleJo automatic public-account checks');
  elsif previous is distinct from p_token then
    perform vault.update_secret(secret_id,p_token);
  end if;
  return true;
end;
$$;

create function kagglejo_private.automation_token() returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name='kagglejo_kaggle_api_token';
$$;
create function public.kagglejo_configure_automation(p_token text) returns boolean
language sql security invoker set search_path = '' as $$
  select kagglejo_private.configure_automation(p_token);
$$;
create function public.kagglejo_automation_token() returns text
language sql security invoker set search_path = '' as $$
  select kagglejo_private.automation_token();
$$;

-- Trusted account lookups supply the real ID and name. The submitted city is
-- a community assertion, not a reviewed location or ownership verification.
create function public.kagglejo_accept_submission(
  p_username text, p_kaggle_id bigint default null, p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  candidate text := lower(trim(p_username));
  nomination public.kagglejo_nominations%rowtype;
  membership public.kagglejo_memberships%rowtype;
begin
  if candidate is null or candidate !~ '^[a-z0-9_]{3,50}$' then
    raise exception using errcode='22023', message='Use a valid Kaggle username.';
  end if;
  perform pg_advisory_xact_lock(1726041102);
  select * into membership from public.kagglejo_memberships where username=candidate;
  if found then
    if membership.revoked_at is null and membership.search_available then
      return jsonb_build_object('status','approved','message','This profile is already in the community. Refresh the directory to find it.');
    end if;
    return jsonb_build_object('status','blocked','message','This profile cannot be added automatically. Contact the site operator.');
  end if;
  select * into nomination from public.kagglejo_nominations where username=candidate for update;
  if not found or nomination.status <> 'pending' then
    return jsonb_build_object('status','blocked','message','This submission cannot be added automatically.');
  end if;
  if p_kaggle_id is null then return jsonb_build_object('status','checking'); end if;
  if p_kaggle_id not between 1 and 9007199254740991 or p_display_name is null
      or length(trim(p_display_name)) not between 1 and 150 then
    raise exception using errcode='22023', message='The exact public Kaggle identity could not be verified.';
  end if;
  if (select count(*) from public.kagglejo_memberships where revoked_at is null) >= 1000 then
    return jsonb_build_object('status','blocked','message','The community directory has reached its member limit.');
  end if;
  insert into public.kagglejo_memberships(username,kaggle_id,display_name,city,evidence_url,review_basis,review_note)
    values(candidate,p_kaggle_id,trim(p_display_name),nomination.city,nomination.evidence_url,'automatic_submission',
      'Automatically accepted after exact public Kaggle account lookup. The submitter confirmed the Jordan connection; no manual review or account ownership verification was performed.');
  update public.kagglejo_nominations set status='approved' where username=candidate;
  return jsonb_build_object('status','approved','message','Profile added to the community. Available Kaggle statistics update during the next hourly sync.');
end;
$$;

revoke all on function kagglejo_private.configure_automation(text), kagglejo_private.automation_token()
  from public, anon, authenticated;
revoke all on function public.kagglejo_configure_automation(text), public.kagglejo_automation_token(),
  public.kagglejo_accept_submission(text,bigint,text) from public, anon, authenticated;
grant execute on function kagglejo_private.configure_automation(text), kagglejo_private.automation_token()
  to service_role;
grant execute on function public.kagglejo_configure_automation(text), public.kagglejo_automation_token(),
  public.kagglejo_accept_submission(text,bigint,text) to service_role;

commit;
