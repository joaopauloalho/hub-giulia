import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Link2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { usePacientes } from '../../hooks/usePacientes';
import { useToast } from '../../hooks/useToast';
import { clinicDateLabel, clinicTime } from '../../lib/agendaTime';
import type { IcloudImportedEvent } from '../../hooks/useIcloudEvents';

function PatientLink({event,onSaved,onClose}:{
  event:IcloudImportedEvent;onSaved:()=>void;onClose:()=>void;
}) {
  const {toast}=useToast();
  const [search,setSearch]=useState('');
  const [patientId,setPatientId]=useState(event.linked_patient_id ?? '');
  const [saving,setSaving]=useState(false);
  const {pacientes,hasMore,nextPage}=usePacientes({search,pageSize:50});

  const save=async()=>{
    setSaving(true);
    try {
      const {error}=await supabase.from('icloud_calendar_events')
        .update({linked_patient_id:patientId||null}).eq('id',event.id);
      if(error)throw error;
      toast.success(patientId ? 'Paciente vinculada ao compromisso.' : 'Vinculo removido.');
      onSaved();
    } catch(error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel salvar o vinculo.');
    } finally {setSaving(false);}
  };

  return <div className="card" style={{padding:12,marginTop:12}}>
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <strong style={{flex:1}}>Vincular paciente cadastrada</strong>
      <button className="icon-btn" type="button" onClick={onClose} aria-label="Fechar busca">
        <X size={16}/>
      </button>
    </div>
    <div className="page-sub" style={{marginTop:6}}>
      O evento do iPhone nao sera alterado nem sera criado um atendimento automaticamente.
    </div>
    <label className="field-label">Buscar paciente</label>
    <input className="field-input" value={search}
      onChange={e=>setSearch(e.target.value)} placeholder="Digite o nome"/>
    <select className="field-input" style={{marginTop:8}}
      value={patientId} onChange={e=>setPatientId(e.target.value)}>
      <option value="">Nenhuma paciente</option>
      {event.linked_patient_id && !pacientes.some(p=>p.id===event.linked_patient_id) &&
        <option value={event.linked_patient_id}>Paciente ja vinculada</option>}
      {pacientes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    {hasMore && <button className="btn btn--ghost btn--sm" type="button"
      onClick={()=>void nextPage()}>Carregar mais</button>}
    <div style={{display:'flex',justifyContent:'flex-end',marginTop:10}}>
      <button className="btn btn--primary btn--sm" type="button" disabled={saving}
        onClick={()=>void save()}><Link2 size={14}/> Salvar vinculo</button>
    </div>
  </div>;
}

export function IcloudEventsPanel({events,activeId,onActiveChange,onChanged}:{
  events:IcloudImportedEvent[];
  activeId:string|null;
  onActiveChange:(id:string|null)=>void;
  onChanged:()=>void;
}) {
  const navigate=useNavigate();
  const {toast,confirm}=useToast();
  const [busy,setBusy]=useState(false);
  const [linkMode,setLinkMode]=useState(false);
  const [showPending,setShowPending]=useState(false);
  const [showAll,setShowAll]=useState(false);

  const active=events.find(e=>e.id===activeId) ?? null;
  const pending=events.filter(e=>!e.is_deleted && e.review_state==='pending'
    && !e.linked_patient_id && !e.linked_appointment_id);
  const removedLinked=events.filter(e=>e.is_deleted && e.linked_appointment_id);
  useEffect(()=>{setLinkMode(false);},[activeId]);
  useEffect(()=>{
    if(!activeId)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onActiveChange(null);};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[activeId,onActiveChange]);

  const updateState=async(event:IcloudImportedEvent,state:IcloudImportedEvent['review_state'])=>{
    setBusy(true);
    try {
      const {error}=await supabase.from('icloud_calendar_events')
        .update({review_state:state}).eq('id',event.id);
      if(error)throw error;
      onChanged();
      onActiveChange(null);
      toast.success(state==='personal' ? 'Compromisso pessoal: o horario continua ocupado.'
        : state==='dismissed' ? 'Removido dos pendentes, sem apagar do iPhone.'
        : 'Compromisso voltou para a lista de organizacao.');
    } catch(error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel classificar.');
    } finally {setBusy(false);}
  };

  const convert=async(event:IcloudImportedEvent)=>{
    if(!event.linked_patient_id || event.is_all_day || event.is_deleted)return;
    const accepted=await confirm({
      title:'Criar agendamento clinico?',
      message:'Vai criar um agendamento para a paciente vinculada, sem apagar ou duplicar o compromisso do iPhone. Nenhum procedimento ou pagamento sera registrado.',
      confirmLabel:'Criar agendamento',cancelLabel:'Voltar',tone:'warning',
    });
    if(!accepted)return;
    setBusy(true);
    try {
      const {data,error}=await supabase.rpc('convert_icloud_event_v1',{
        p_event_id:event.id,p_service_id:null,
      });
      if(error)throw error;
      toast.success('Agendamento criado e vinculado ao evento original.');
      onChanged();
      onActiveChange(null);
      if(data)navigate(`/atendimento/${data}`);
    } catch(error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao criar agendamento.');
    } finally {setBusy(false);}
  };

  if(!events.length)return null;
  return <>
    <section className="card" style={{padding:12,marginBottom:12}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <CalendarDays size={17}/>
        <strong style={{flex:1}}>Compromissos do iCloud</strong>
        <button className="btn btn--secondary btn--sm" type="button"
          onClick={()=>setShowPending(x=>!x)} aria-expanded={showPending}>
          {pending.length} para organizar {showPending ? '−' : '+'}
        </button>
      </div>
      <p className="page-sub" style={{marginTop:6}}>
        Os eventos agora aparecem nos dias da agenda. Vincule pacientes, marque como pessoal
        ou dispense da lista. Nada disso apaga eventos no iPhone.
      </p>
      {removedLinked.length>0 && <p role="status" style={{marginTop:8,fontSize:13}}>
        <strong>{removedLinked.length} compromisso(s) removido(s) do iPhone</strong> ainda
        possuem agendamento clinico no Hub. Confira antes de cancelar atendimentos.
      </p>}
      {showPending && <div style={{display:'grid',gap:7,marginTop:10}}>
        {(showAll?pending:pending.slice(0,10)).map(event=>
          <button key={event.id} type="button" className="btn btn--ghost btn--sm"
            style={{justifyContent:'space-between',textAlign:'left',height:'auto',padding:10}}
            onClick={()=>onActiveChange(event.id)}>
            <span>{event.is_private ? 'Compromisso privado' : event.title || 'Compromisso'}</span>
            <span className="page-sub">{clinicDateLabel(event.starts_at)} · {clinicTime(event.starts_at)}</span>
          </button>
        )}
        {!pending.length && <p className="page-sub">Nenhum compromisso pendente neste periodo.</p>}
        {pending.length>10 && <button type="button" className="btn btn--ghost btn--sm"
          onClick={()=>setShowAll(x=>!x)}>{showAll?'Mostrar menos':`Mostrar todos (${pending.length})`}</button>}
      </div>}
    </section>
    {active && <div role="presentation" onClick={()=>onActiveChange(null)}
      style={{position:'fixed',inset:0,zIndex:150,background:'rgba(0,0,0,.35)',
        display:'flex',justifyContent:'center',alignItems:'center',padding:18}}>
      <div role="dialog" aria-modal="true" aria-label="Detalhes do compromisso do iCloud"
        className="card" onClick={event=>event.stopPropagation()}
        style={{maxWidth:520,width:'100%',maxHeight:'85vh',overflowY:'auto',padding:20}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <strong style={{flex:1}}>{active.is_private?'Compromisso privado':active.title || 'Compromisso'}</strong>
          <button type="button" className="icon-btn" aria-label="Fechar"
            onClick={()=>onActiveChange(null)}><X size={18}/></button>
        </div>
        <p className="page-sub" style={{marginTop:7}}>
          {clinicDateLabel(active.starts_at)} · {active.is_all_day ? 'Dia inteiro'
            : clinicTime(active.starts_at)+'–'+clinicTime(active.ends_at)}
        </p>
        {active.is_deleted && <p className="page-sub">Este compromisso foi removido do iPhone.</p>}
        <div className="page-sub" style={{marginTop:8}}>
          {active.linked_patient_id ? 'Paciente vinculada' : active.review_state==='personal'
            ? 'Compromisso pessoal' : active.review_state==='dismissed'
            ? 'Dispensado da lista de organizacao' : 'Sem vinculo'}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}>
          <button type="button" className="btn btn--secondary btn--sm"
            disabled={busy} onClick={()=>setLinkMode(x=>!x)}><Link2 size={14}/> Vincular paciente</button>
          <button type="button" className="btn btn--secondary btn--sm" disabled={busy}
            onClick={()=>void updateState(active,'personal')}>Marcar como pessoal</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
            onClick={()=>void updateState(active,'dismissed')}>Dispensar da lista</button>
          {active.review_state!=='pending' && <button type="button"
            className="btn btn--ghost btn--sm" disabled={busy}
            onClick={()=>void updateState(active,'pending')}>Voltar para pendentes</button>}
        </div>
        {active.linked_appointment_id
          ? <button type="button" className="btn btn--primary btn--sm"
              style={{marginTop:12}} onClick={()=>navigate(`/atendimento/${active.linked_appointment_id}`)}>
              Abrir agendamento clinico
            </button>
          : active.linked_patient_id && !active.is_deleted && !active.is_all_day
            ? <button type="button" className="btn btn--primary btn--sm"
              style={{marginTop:12}} disabled={busy} onClick={()=>void convert(active)}>
              Criar agendamento clinico
              </button> : null}
        {linkMode && <PatientLink key={active.id} event={active}
          onSaved={()=>{setLinkMode(false);onChanged();}}
          onClose={()=>setLinkMode(false)}/>}
        <p className="page-sub" style={{marginTop:12}}>
          Dispensar remove apenas desta lista, mas conserva o horario ocupado no Hub.
          Excluir no iPhone e uma acao separada.
        </p>
      </div>
    </div>}
  </>;
}
