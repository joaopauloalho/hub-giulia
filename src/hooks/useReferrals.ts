import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { referralStatus, type ReferralStatus, type RewardStatus } from '../lib/referrals';

export type ReferralRow = {
  id: string;
  referrerPatientId: string | null;
  referrerName: string | null;
  referrerLabel: string;
  referredName: string;
  referredPhone: string | null;
  referredPatientId: string | null;
  status: ReferralStatus;
  rewardStatus: RewardStatus;
  rewardNote: string | null;
  createdAt: string;
};

export type ReferralSettings = { rewardCap: number | null; rewardNote: string | null };

type RpcRow = {
  id: string;
  referrer_patient_id: string | null;
  referrer_name: string | null;
  referrer_label: string;
  referred_name: string;
  referred_phone: string | null;
  referred_patient_id: string | null;
  has_paid: boolean;
  has_appointment: boolean;
  reward_status: RewardStatus;
  reward_note: string | null;
  created_at: string;
};

export function useReferrals() {
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [settings, setSettings] = useState<ReferralSettings>({ rewardCap: null, rewardNote: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, prefs] = await Promise.all([
      supabase.rpc('list_referrals_v1'),
      supabase.from('referral_settings').select('reward_cap,reward_note').maybeSingle(),
    ]);
    if (list.error || prefs.error) {
      setError('Não foi possível carregar as indicações.');
      setRows([]);
    } else {
      setError(null);
      setRows(((list.data ?? []) as RpcRow[]).map(row => ({
        id: row.id,
        referrerPatientId: row.referrer_patient_id,
        referrerName: row.referrer_name,
        referrerLabel: row.referrer_label,
        referredName: row.referred_name,
        referredPhone: row.referred_phone,
        referredPatientId: row.referred_patient_id,
        status: referralStatus({
          referredPatientId: row.referred_patient_id,
          hasPaid: Boolean(row.has_paid),
          hasAppointment: Boolean(row.has_appointment),
        }),
        rewardStatus: row.reward_status,
        rewardNote: row.reward_note,
        createdAt: row.created_at,
      })));
      setSettings({
        rewardCap: prefs.data?.reward_cap == null ? null : Number(prefs.data.reward_cap),
        rewardNote: prefs.data?.reward_note ?? null,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { rows, settings, loading, error, refresh };
}
