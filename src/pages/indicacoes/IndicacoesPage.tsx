import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { normalizePhone } from '../../lib/patientInput';
import { rankReferrers, REFERRAL_STATUS_LABEL, REWARD_STATUS_LABEL, type RewardStatus } from '../../lib/referrals';
import { useReferrals } from '../../hooks/useReferrals';
import { useToast } from '../../hooks/useToast';
import { Skeleton } from '../../components/ui/Skeleton';
import { money } from '../../lib/dashboardMetrics';
import '../simple/simple.css';

type PatientOption = { id: string; name: string; phone: string | null; acquisition_source: string | null };

const phoneKey = (value: string | null | undefined) => {
  const raw = (value ?? '').replace(/\D/g, '');
  return raw.startsWith('55') && raw.length > 11 ? raw.slice(2) : raw;
};

export function IndicacoesPage() {
  const { rows, settings, loading, error, refresh } = useReferrals();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [referrerQuery, setReferrerQuery] = useState('');
  const [referrerId, setReferrerId] = useState<string | null>(null);
  const [referrerTyped, setReferrerTyped] = useState('');
  const [referredName, setReferredName] = useState('');
  const [referredPhone, setReferredPhone] = useState('');
  const [linkedPatientId, setLinkedPatientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cap, setCap] = useState('');
  const [capNote, setCapNote] = useState('');

  useEffect(() => {
    void supabase.from('patients').select('id,name,phone,acquisition_source').is('archived_at', null).order('name').then(({ data }) => {
      setPatients((data ?? []) as PatientOption[]);
    });
  }, [rows.length]);

  useEffect(() => {
    setCap(settings.rewardCap == null ? '' : String(settings.rewardCap).replace('.', ','));
    setCapNote(settings.rewardNote ?? '');
  }, [settings.rewardCap, settings.rewardNote]);

  const referrerChoices = useMemo(() => {
    const query = referrerQuery.trim().toLocaleLowerCase('pt-BR');
    if (!query) return patients.slice(0, 6);
    return patients.filter(person => person.name.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 6);
  }, [patients, referrerQuery]);

  const phoneMatch = useMemo(() => {
    const wanted = phoneKey(referredPhone);
    if (wanted.length < 8) return null;
    return patients.find(person => phoneKey(person.phone) === wanted) ?? null;
  }, [patients, referredPhone]);

  const ranking = useMemo(() => rankReferrers(rows.map(row => ({
    referrerKey: row.referrerPatientId ?? `name:${row.referrerLabel}`,
    referrerLabel: row.referrerLabel,
    status: row.status,
  }))).slice(0, 5), [rows]);

  const reset = () => {
    setReferrerQuery('');
    setReferrerId(null);
    setReferrerTyped('');
    setReferredName('');
    setReferredPhone('');
    setLinkedPatientId(null);
    setOpen(false);
  };

  const save = async (createPatient: boolean) => {
    const name = referredName.trim();
    if (!name) return toast.error('Informe o nome de quem foi indicada.');
    if (!referrerId && !referrerTyped.trim()) return toast.error('Diga quem indicou: escolha uma paciente ou escreva o nome.');
    if (referrerId && linkedPatientId === referrerId) return toast.error('A paciente não pode indicar a si mesma.');
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sua sessão expirou. Entre novamente.');
      let patientId = linkedPatientId ?? phoneMatch?.id ?? null;
      const referrerName = referrerId ? null : referrerTyped.trim();
      if (createPatient && !patientId) {
        const { data: created, error: createError } = await supabase.from('patients').insert({
          user_id: auth.user.id,
          name,
          phone: normalizePhone(referredPhone),
          acquisition_source: 'referral',
          referred_by_patient_id: referrerId,
          referrer_name: referrerName,
        }).select('id').single();
        if (createError) throw createError;
        patientId = created.id;
      } else if (patientId) {
        const existing = patients.find(person => person.id === patientId);
        if (existing && !existing.acquisition_source) {
          await supabase.from('patients').update({
            acquisition_source: 'referral',
            referred_by_patient_id: referrerId,
            referrer_name: referrerName,
          }).eq('id', patientId);
        }
      }
      const { error: insertError } = await supabase.from('referrals').insert({
        user_id: auth.user.id,
        referrer_patient_id: referrerId,
        referrer_name: referrerName,
        referred_name: name,
        referred_phone: normalizePhone(referredPhone),
        referred_patient_id: patientId,
      });
      if (insertError) throw insertError;
      toast.success('Indicação registrada.');
      reset();
      await refresh();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a indicação.');
    } finally {
      setSaving(false);
    }
  };

  const saveCap = async () => {
    const parsed = cap.trim() ? Number(cap.replace(',', '.')) : null;
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) return toast.error('Informe um teto válido.');
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return toast.error('Sua sessão expirou. Entre novamente.');
    const { error: saveError } = await supabase.from('referral_settings').upsert({
      user_id: auth.user.id,
      reward_cap: parsed,
      reward_note: capNote.trim() || null,
    }, { onConflict: 'user_id' });
    if (saveError) toast.error('Não foi possível salvar o teto.');
    else {
      toast.success('Teto salvo.');
      await refresh();
    }
  };

  const setReward = async (id: string, rewardStatus: RewardStatus) => {
    const { error: updateError } = await supabase.from('referrals').update({ reward_status: rewardStatus }).eq('id', id);
    if (updateError) toast.error('Não foi possível atualizar o brinde.');
    else void refresh();
  };

  return <div className="page simple-page" data-testid="indicacoes-page">
    <header className="simple-head">
      <div>
        <h1 className="page-title">Indicações</h1>
        <p className="page-sub">Quem indicou, quem chegou e se o brinde já foi dado.</p>
      </div>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(value => !value)}>{open ? 'Fechar' : 'Nova'}</button>
    </header>

    {open && <form className="card simple-form" onSubmit={event => { event.preventDefault(); void save(false); }}>
      <label className="field-label" htmlFor="referrer-search">Quem indicou</label>
      {referrerId ? <div className="simple-row" style={{ padding: 0 }}><strong style={{ flex: 1 }}>{patients.find(person => person.id === referrerId)?.name}</strong><button type="button" className="btn btn--ghost btn--sm" onClick={() => setReferrerId(null)}>Trocar</button></div> : <>
        <input id="referrer-search" className="field-input" value={referrerQuery} onChange={event => setReferrerQuery(event.target.value)} placeholder="Buscar paciente" />
        {referrerChoices.map(person => <button type="button" key={person.id} className="btn btn--ghost btn--sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setReferrerId(person.id); setReferrerTyped(''); }}>{person.name}</button>)}
        <input className="field-input" value={referrerTyped} onChange={event => setReferrerTyped(event.target.value)} placeholder="Ou escreva o nome, se não estiver cadastrada" />
      </>}
      <label className="field-label" htmlFor="referred-name">Quem foi indicada</label>
      <input id="referred-name" className="field-input" value={referredName} onChange={event => setReferredName(event.target.value)} placeholder="Nome" />
      <input className="field-input" value={referredPhone} onChange={event => setReferredPhone(event.target.value)} placeholder="Telefone" inputMode="tel" />
      {phoneMatch && !linkedPatientId && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setLinkedPatientId(phoneMatch.id); setReferredName(phoneMatch.name); }}>Vincular a {phoneMatch.name}</button>}
      {linkedPatientId && <p className="page-sub">Vinculada à ficha. <Link to={`/pacientes/${linkedPatientId}`}>Abrir</Link></p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>Salvar</button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={saving || Boolean(linkedPatientId || phoneMatch)} onClick={() => void save(true)}>Salvar e criar paciente</button>
      </div>
    </form>}

    {loading ? <Skeleton height={88} /> : error ? <div className="card simple-empty" role="alert">{error}</div> : <>
      <section className="simple-section">
        <div className="simple-section__head"><h2>Lista</h2><span className="page-sub">{rows.length}</span></div>
        {rows.length === 0 ? <div className="card simple-empty"><span className="page-sub">Nenhuma indicação ainda.</span></div> : <div className="simple-list">
          {rows.map(row => <article key={row.id} className="card simple-row">
            <div className="simple-row__body">
              <strong>{row.referredName}</strong>
              <span className="page-sub">{REFERRAL_STATUS_LABEL[row.status]} · indicada por {row.referrerLabel}</span>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void setReward(row.id, row.rewardStatus === 'given' ? 'pending' : 'given')}>{REWARD_STATUS_LABEL[row.rewardStatus]}</button>
            {row.referredPatientId && <Link className="btn btn--primary btn--sm" to={`/pacientes/${row.referredPatientId}`}>Abrir</Link>}
          </article>)}
        </div>}
      </section>

      <section className="simple-section">
        <div className="simple-section__head"><h2>Quem mais indica</h2></div>
        {ranking.length === 0 ? <div className="card simple-empty"><span className="page-sub">O ranking aparece com a primeira indicação.</span></div> : <div className="card" style={{ padding: '4px 14px' }}>
          {ranking.map((item, index) => <div key={item.key} className="simple-row" style={{ paddingInline: 0 }}><span className="page-sub">{index + 1}</span><div className="simple-row__body"><strong>{item.name}</strong><span className="page-sub">{item.count} indicaç{item.count === 1 ? 'ão' : 'ões'} · {item.clients} cliente{item.clients === 1 ? '' : 's'}</span></div></div>)}
        </div>}
      </section>

      <section className="simple-section">
        <div className="simple-section__head"><h2>Teto do brinde</h2></div>
        <div className="card simple-form">
          <p className="page-sub">Um lembrete para o brinde não comer a margem. Não entra no valor pago.</p>
          <label className="field-label" htmlFor="reward-cap">Teto (R$)</label>
          <input id="reward-cap" className="field-input" inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} placeholder="50" />
          {settings.rewardCap != null && <span className="page-sub">Teto atual {money(settings.rewardCap)}</span>}
          <label className="field-label" htmlFor="reward-note">Observação</label>
          <input id="reward-note" className="field-input" value={capNote} onChange={event => setCapNote(event.target.value)} placeholder="Ex.: um skincare até o teto" />
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void saveCap()}>Salvar teto</button>
        </div>
      </section>
    </>}
  </div>;
}
