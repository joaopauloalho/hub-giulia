import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { birthdayTiming } from '../../lib/birthdays';
import { DEFAULT_COMMUNICATION_TEMPLATES, firstName, renderCommunicationTemplate, validateTemplatePlaceholders } from '../../lib/communications';
import { clinicTodayIso } from '../../lib/returnStatus';
import { buildSafeWhatsAppUrl, whatsappRecipientDigits } from '../../lib/whatsapp';
import { useToast } from '../../hooks/useToast';
import { Skeleton } from '../../components/ui/Skeleton';
import '../simple/simple.css';

type Person = { id: string; name: string; phone: string | null; birth_date: string | null };

export function AniversariosPage() {
  const [searchParams] = useSearchParams();
  const focus = searchParams.get('patient');
  const { toast } = useToast();
  const [today] = useState(() => clinicTodayIso());
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState(DEFAULT_COMMUNICATION_TEMPLATES.birthday_greeting);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focus);
  const invalid = validateTemplatePlaceholders(template);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [patients, saved] = await Promise.all([
        supabase.from('patients').select('id,name,phone,birth_date').is('archived_at', null).not('birth_date', 'is', null),
        supabase.from('communication_templates').select('body,enabled').eq('template_key', 'birthday_greeting').maybeSingle(),
      ]);
      if (!alive) return;
      if (patients.error) setError('Não foi possível carregar os aniversários.');
      else setPeople((patients.data ?? []) as Person[]);
      if (saved.data?.enabled !== false && saved.data?.body) setTemplate(saved.data.body);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    const todayPeople: Person[] = [];
    const weekPeople: Person[] = [];
    for (const person of people) {
      const timing = birthdayTiming(person.birth_date, today);
      if (timing === 'today') todayPeople.push(person);
      else if (timing === 'week') weekPeople.push(person);
    }
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, 'pt-BR');
    return { todayPeople: todayPeople.sort(byName), weekPeople: weekPeople.sort(byName) };
  }, [people, today]);

  const selected = people.find(person => person.id === (selectedId ?? focus)) ?? groups.todayPeople[0] ?? groups.weekPeople[0] ?? null;

  const messageFor = (person: Person) => {
    if (invalid.length) return '';
    return renderCommunicationTemplate(template, { first_name: firstName(person.name), name: person.name });
  };

  const saveTemplate = async () => {
    if (invalid.length) return toast.error('A mensagem usa um campo que o Hub não reconhece.');
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return toast.error('Sua sessão expirou. Entre novamente.');
    setSaving(true);
    const { error: saveError } = await supabase.from('communication_templates').upsert({
      user_id: auth.user.id,
      template_key: 'birthday_greeting',
      body: template,
      enabled: true,
    }, { onConflict: 'user_id,template_key' });
    setSaving(false);
    if (saveError) toast.error('Não foi possível salvar a mensagem.');
    else toast.success('Mensagem salva.');
  };

  const openWhatsApp = (person: Person) => {
    const url = buildSafeWhatsAppUrl(person.phone, messageFor(person));
    if (!url) return toast.error('Telefone inválido ou ausente.');
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const record = async (person: Person) => {
    const phone = whatsappRecipientDigits(person.phone);
    const body = messageFor(person).trim();
    if (!phone) return toast.error('Telefone inválido ou ausente.');
    if (!body) return toast.error('Escreva a mensagem antes de registrar.');
    const { error: recordError } = await supabase.rpc('record_relationship_birthday_contact_v1', {
      p_patient_id: person.id,
      p_recipient_phone: phone,
      p_message_body: body,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (recordError) toast.error('Não foi possível registrar o contato.');
    else toast.success('Contato registrado.');
  };

  const list = (title: string, rows: Person[]) => <section className="simple-section">
    <div className="simple-section__head"><h2>{title}</h2></div>
    {rows.length === 0 ? <div className="card simple-empty"><span className="page-sub">Ninguém nesta lista.</span></div> : <div className="simple-list">
      {rows.map(person => <button type="button" key={person.id} className="card simple-row" onClick={() => setSelectedId(person.id)} style={{ width: '100%', textAlign: 'left', borderColor: selected?.id === person.id ? 'var(--primary)' : undefined }}>
        <div className="simple-row__body"><strong>{person.name}</strong><span className="page-sub">{person.phone || 'Sem telefone'}</span></div>
      </button>)}
    </div>}
  </section>;

  return <div className="page simple-page" data-testid="aniversarios-page">
    <header className="simple-head">
      <div>
        <h1 className="page-title">Aniversários</h1>
        <p className="page-sub">Hoje e os próximos 7 dias. Mensagem de carinho, sem desconto.</p>
      </div>
      <Link className="btn btn--ghost btn--sm" to="/hoje">Hoje</Link>
    </header>
    {loading ? <Skeleton height={120} /> : error ? <div className="card simple-empty" role="alert">{error}</div> : <>
      {list('Hoje', groups.todayPeople)}
      {list('Esta semana', groups.weekPeople)}
      <section className="simple-section">
        <div className="simple-section__head"><h2>Mensagem</h2></div>
        <div className="card simple-form">
          <label className="field-label" htmlFor="birthday-template">Texto do WhatsApp</label>
          <textarea id="birthday-template" className="field-input" rows={5} value={template} onChange={event => setTemplate(event.target.value)} />
          {invalid.length > 0 && <span className="page-sub">Campo não reconhecido: {invalid.join(', ')}</span>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--ghost btn--sm" disabled={saving} onClick={() => void saveTemplate()}>{saving ? 'Salvando...' : 'Salvar texto'}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTemplate(DEFAULT_COMMUNICATION_TEMPLATES.birthday_greeting)}>Restaurar</button>
          </div>
          {selected && <div>
            <p className="page-sub">Para {selected.name}</p>
            <p>{invalid.length ? 'Ajuste o texto para ver a mensagem.' : messageFor(selected)}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button type="button" className="btn btn--primary btn--sm" disabled={invalid.length > 0} onClick={() => openWhatsApp(selected)}>WhatsApp</button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={invalid.length > 0} onClick={() => void record(selected)}>Registrar que enviei</button>
            </div>
          </div>}
        </div>
      </section>
    </>}
  </div>;
}
