-- Hub Giulia 4.2 — referral composite FK covering indexes
-- The FK order is (referred_by_patient_id, user_id), so keep the same leading order
-- for the covering indexes reported by the Supabase Performance Advisor.

drop index if exists public.patients_user_referrer_idx;
create index patients_user_referrer_idx
  on public.patients(referred_by_patient_id, user_id)
  where referred_by_patient_id is not null;

drop index if exists public.contacts_user_referrer_idx;
create index contacts_user_referrer_idx
  on public.contacts(referred_by_patient_id, user_id)
  where referred_by_patient_id is not null;
