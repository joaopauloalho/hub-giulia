import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw, ShieldCheck } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { useParams } from 'react-router-dom';
import { signPublicAnamnesis, viewPublicAnamnesisSignature, type PublicAnamnesisSignaturePayload } from '../../lib/anamnesisSignature';
import './anamnesis-signature.css';

type SchemaField = { key?:string; label?:string; type?:string; detail_key?:string; options?:string[] };
type SchemaSection = { key?:string; title?:string; fields?:SchemaField[] };

function source(snapshot: Record<string, unknown>, section: string) {
  if (section === 'conditions') return (snapshot.conditions ?? {}) as Record<string, unknown>;
  if (['allergies','medical_history','womens_health'].includes(section)) return (snapshot.surgical_history ?? {}) as Record<string, unknown>;
  if (['food','routine','habits'].includes(section)) return (snapshot.habits ?? {}) as Record<string, unknown>;
  if (['procedures','skin_review','aesthetics'].includes(section)) return (snapshot.aesthetics ?? {}) as Record<string, unknown>;
  return snapshot;
}
function display(snapshot: Record<string,unknown>, section:string, field:SchemaField) {
  const key=field.key??''; const area=source(snapshot,section); const value=area[key];
  if(field.type==='status_text'){
    const status=snapshot.medications_status;
    if(status==='none') return 'Não';
    if(status==='reported') return `Sim${String(snapshot.medications??'').trim()?` — ${String(snapshot.medications).trim()}`:''}`;
    return 'Sem resposta registrada';
  }
  if(['boolean','boolean_detail','boolean_frequency','procedure_note'].includes(field.type??'')){
    if(value===true){const detail=field.detail_key?String(area[field.detail_key]??'').trim():'';return detail?`Sim — ${detail}`:'Sim';}
    if(value===false){const detail=field.type==='procedure_note'&&field.detail_key?String(area[field.detail_key]??'').trim():'';return detail?`Não — ${detail}`:'Não';}
    return 'Sem resposta registrada';
  }
  if(value===null||value===undefined||value==='') return 'Não informado';
  return String(value);
}

export function AnamnesisSignaturePage() {
  const { token='' }=useParams(); const sigRef=useRef<SignatureCanvas>(null); const lock=useRef(false);
  const [payload,setPayload]=useState<PublicAnamnesisSignaturePayload|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const [signing,setSigning]=useState(false);
  useEffect(()=>{document.title='Assinatura de anamnese · Hub Giulia'; const noCache=document.createElement('meta');noCache.httpEquiv='Cache-Control';noCache.content='no-store, no-cache, must-revalidate';document.head.appendChild(noCache);return()=>noCache.remove();},[]);
  useEffect(()=>{let active=true;setLoading(true);void viewPublicAnamnesisSignature(token).then(data=>{if(active){setPayload(data);setError(null);}}).catch(err=>{if(active)setError(err instanceof Error?err.message:'Este link não está disponível.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[token]);
  const submit=async()=>{if(lock.current||signing||!payload||payload.status!=='pending')return;if(!sigRef.current||sigRef.current.isEmpty()){setError('Faça a assinatura no campo abaixo antes de confirmar.');return;}lock.current=true;setSigning(true);setError(null);try{const result=await signPublicAnamnesis(token,sigRef.current.toDataURL('image/png'));setPayload({status:'signed',signed_at:result.signed_at});}catch(err){lock.current=false;setError(err instanceof Error?err.message:'Não foi possível concluir a assinatura.');}finally{setSigning(false);}};
  if(loading)return <main className="public-anamnesis-sign"><div className="public-sign-card">Carregando versão para assinatura…</div></main>;
  if(error&&!payload)return <main className="public-anamnesis-sign"><div className="public-sign-card public-sign-error"><ShieldCheck size={30}/><h1>Link indisponível</h1><p>{error}</p><small>Solicite um novo link à clínica se necessário.</small></div></main>;
  if(payload?.status==='signed')return <main className="public-anamnesis-sign"><div className="public-sign-card public-sign-success"><CheckCircle2 size={42}/><h1>Anamnese assinada</h1><p>A assinatura desta versão foi registrada.</p>{payload.signed_at&&<small>{new Date(payload.signed_at).toLocaleString('pt-BR')}</small>}</div></main>;
  const sections=((payload?.form_schema_snapshot?.sections??[]) as SchemaSection[]).filter(section=>Array.isArray(section.fields)); const snapshot=payload?.answers_snapshot??{};
  return <main className="public-anamnesis-sign"><div className="public-sign-shell">
    <header><div><div className="public-sign-eyebrow">Hub Giulia</div><h1>Anamnese para assinatura</h1><p>{payload?.patient_name} · versão {payload?.version_number}</p></div><span className="public-sign-badge"><ShieldCheck size={14}/> Conteúdo congelado</span></header>
    <section className="public-sign-document"><p className="public-sign-help">Revise o conteúdo abaixo. Esta assinatura será vinculada somente a esta versão da anamnese.</p>{sections.map((section,index)=><article key={`${section.key??index}`}><h2>{section.title??'Seção'}</h2>{(section.fields??[]).map((field,i)=><div className="public-sign-row" key={`${field.key??i}`}><span>{field.label??field.key}</span><strong>{display(snapshot,section.key??'',field)}</strong></div>)}</article>)}<div className="public-sign-integrity">Identificador de integridade: {payload?.content_sha256?.slice(0,16)}…</div></section>
    <section className="public-sign-action"><h2>Assinatura da paciente</h2><p>Assine com o dedo, caneta digital ou mouse.</p><div className="public-sign-canvas"><SignatureCanvas ref={sigRef} backgroundColor="white" penColor="#1a1a2e" canvasProps={{'aria-label':'Área de assinatura',className:'public-sign-canvas-el'}}/></div><button className="btn btn--ghost btn--md" type="button" disabled={signing} onClick={()=>{sigRef.current?.clear();setError(null);}}><RotateCcw size={15}/> Limpar</button>{error&&<div className="public-sign-inline-error" role="alert">{error}</div>}<button className="btn btn--primary btn--md public-sign-confirm" type="button" disabled={signing} onClick={()=>void submit()}>{signing?'Confirmando…':'Confirmar assinatura'}</button><small>Ao confirmar, a assinatura fica vinculada à versão exibida acima. O Hub não apresenta esta assinatura como certificado digital qualificado.</small></section>
  </div></main>;
}
