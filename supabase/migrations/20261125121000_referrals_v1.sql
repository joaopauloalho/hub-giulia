-- Referral program. Additive only: does not update or delete patients, contacts, or payments.
-- Status (indicada / agendou / cliente) is derived at read time from appointments and paid amounts.

begin;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  referrer_patient_id uuid,
  referrer_name text,
  referred_name text not null,
  referred_phone text,
  referred_patient_id uuid,
  reward_status text not null default 'pending',
  reward_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referrals drop constraint if exists referrals_referrer_exclusive;
alter table public.referrals add constraint referrals_referrer_exclusive check (
  (referrer_patient_id is not null and referrer_name is null)
  or (referrer_patient_id is null and nullif(btrim(referrer_name), '') is not null)
);

alter table public.referrals drop constraint if exists referrals_referred_name_check;
alter table public.referrals add constraint referrals_referred_name_check check (
  nullif(btrim(referred_name), '') is not null
);

alter table public.referrals drop constraint if exists referrals_reward_status_check;
alter table public.referrals add constraint referrals_reward_status_check check (
  reward_status = any (array['pending'::text, 'given'::text])
);

alter table public.referrals drop constraint if exists referrals_not_self;
alter table public.referrals add constraint referrals_not_self check (
  referred_patient_id is null
  or referrer_patient_id is null
  or referred_patient_id <> referrer_patient_id
);

alter table public.referrals drop constraint if exists referrals_referrer_owner_fkey;
alter table public.referrals add constraint referrals_referrer_owner_fkey
  foreign key (referrer_patient_id, user_id) references public.patients(id, user_id);

alter table public.referrals drop constraint if exists referrals_referred_owner_fkey;
alter table public.referrals add constraint referrals_referred_owner_fkey
  foreign key (referred_patient_id, user_id) references public.patients(id, user_id);

create index if not exists referrals_user_created_idx
  on public.referrals (user_id, created_at desc);
create index if not exists referrals_user_referrer_idx
  on public.referrals (user_id, referrer_patient_id)
  where referrer_patient_id is not null;
create index if not exists referrals_user_referred_idx
  on public.referrals (user_id, referred_patient_id)
  where referred_patient_id is not null;

create table if not exists public.referral_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reward_cap numeric(12,2),
  reward_note text,
  updated_at timestamptz not null default now()
);

alter table public.referral_settings drop constraint if exists referral_settings_cap_check;
alter table public.referral_settings add constraint referral_settings_cap_check check (
  reward_cap is null or reward_cap >= 0
);

create or replace function public.referrals_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists referrals_touch_updated_at on public.referrals;
create trigger referrals_touch_updated_at
  before update on public.referrals
  for each row execute function public.referrals_touch_updated_at();

drop trigger if exists referral_settings_touch_updated_at on public.referral_settings;
create trigger referral_settings_touch_updated_at
  before update on public.referral_settings
  for each row execute function public.referrals_touch_updated_at();

alter table public.referrals enable row level security;
alter table public.referral_settings enable row level security;

revoke all on table public.referrals from public, anon;
revoke all on table public.referral_settings from public, anon;
grant select, insert, update, delete on table public.referrals to authenticated;
grant select, insert, update, delete on table public.referral_settings to authenticated;

drop policy if exists referrals_own on public.referrals;
create policy referrals_own on public.referrals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists referral_settings_own on public.referral_settings;
create policy referral_settings_own on public.referral_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.list_referrals_v1()
returns table (
  id uuid,
  referrer_patient_id uuid,
  referrer_name text,
  referrer_label text,
  referred_name text,
  referred_phone text,
  referred_patient_id uuid,
  has_paid boolean,
  has_appointment boolean,
  reward_status text,
  reward_note text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.id,
    r.referrer_patient_id,
    r.referrer_name,
    coalesce(rp.name, r.referrer_name) as referrer_label,
    r.referred_name,
    r.referred_phone,
    r.referred_patient_id,
    (
      r.referred_patient_id is not null
      and (
        exists (
          select 1
          from public.procedure_payments pp
          join public.procedures pr on pr.id = pp.procedure_id and pr.user_id = pp.user_id
          where pr.user_id = r.user_id
            and pr.patient_id = r.referred_patient_id
            and pp.paid_at is not null
            and pp.amount > 0
        )
        or exists (
          select 1
          from public.package_payments pay
          join public.patient_packages pk on pk.id = pay.package_id and pk.user_id = pay.user_id
          where pk.user_id = r.user_id
            and pk.patient_id = r.referred_patient_id
            and pay.paid_at is not null
            and pay.amount > 0
        )
      )
    ) as has_paid,
    (
      r.referred_patient_id is not null
      and exists (
        select 1
        from public.appointments a
        where a.user_id = r.user_id
          and a.patient_id = r.referred_patient_id
          and a.status in ('pendente', 'confirmado', 'realizado')
      )
    ) as has_appointment,
    r.reward_status,
    r.reward_note,
    r.created_at
  from public.referrals r
  left join public.patients rp
    on rp.id = r.referrer_patient_id
   and rp.user_id = r.user_id
  where r.user_id = (select auth.uid())
  order by r.created_at desc;
$$;

revoke all on function public.referrals_touch_updated_at() from public, anon, authenticated;
revoke all on function public.list_referrals_v1() from public, anon;
grant execute on function public.list_referrals_v1() to authenticated;

comment on table public.referrals is
  'One referral at a time. Referrer is an existing patient or a typed name. Reward tracking is separate from charged revenue.';

commit;
