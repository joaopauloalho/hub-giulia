import { useMemo, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, ImagePlus, Loader2, Minus, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { useMaterials } from '../../hooks/useMaterials';
import { useProductTraceabilityEvidence } from '../../hooks/useProductTraceabilityEvidence';
import { formatTraceabilityExpiry, isExpiredTraceabilityDate } from '../../lib/productTraceability';
import type { Material, MaterialTraceabilityInput, ProcedureMaterialInput } from '../../types/materials';
import type { ProductEvidenceDraft } from '../../types/traceability';

export interface SelectedAttendanceMaterial extends ProcedureMaterialInput {
  material: Material;
  evidence?: ProductEvidenceDraft | null;
}

const qtyLabel = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function MaterialsStep({ patientId, selected, onChange }: { patientId: string; selected: SelectedAttendanceMaterial[]; onChange: (value: SelectedAttendanceMaterial[]) => void }) {
  const { materials, loading, error } = useMaterials({ activeOnly: true });
  const { uploadEvidence, discardEvidence } = useProductTraceabilityEvidence();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<Record<string, string>>({});
  const cameraInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const libraryInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const selectedById = useMemo(() => new Map(selected.map(item => [item.material_id, item])), [selected]);
  const available = useMemo(() => materials.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase())), [materials, search]);

  const replaceItem = (material: Material, patch: Partial<SelectedAttendanceMaterial>) => {
    const current = selectedById.get(material.id);
    if (!current) return;
    onChange(selected.map(item => item.material_id === material.id ? { ...item, ...patch } : item));
  };

  const removeSelected = async (material: Material) => {
    const current = selectedById.get(material.id);
    if (current?.evidence && !current.evidence.traceability_id) {
      try { await discardEvidence(current.evidence); }
      catch (err) {
        setTraceError(errors => ({ ...errors, [material.id]: err instanceof Error ? err.message : 'Não foi possível remover a foto.' }));
        return;
      }
    }
    onChange(selected.filter(item => item.material_id !== material.id));
  };

  const setQuantity = async (material: Material, quantity: number) => {
    const rounded = Math.max(0, Math.round(quantity * 1000) / 1000);
    if (rounded <= 0) { await removeSelected(material); return; }
    const current = selectedById.get(material.id);
    const next = selected.filter(item => item.material_id !== material.id);
    next.push(current ? { ...current, quantity: rounded, material } : { material_id: material.id, quantity: rounded, material });
    onChange(next);
    if (material.traceability_mode === 'recommended') setExpanded(value => new Set(value).add(material.id));
  };

  const updateTraceability = (material: Material, patch: Partial<MaterialTraceabilityInput>) => {
    const current = selectedById.get(material.id);
    if (!current) return;
    replaceItem(material, { traceability: { ...(current.traceability ?? {}), ...patch } });
  };

  const attachPhoto = async (material: Material, file: File | undefined, sourceType: 'camera' | 'library') => {
    if (!file) return;
    const current = selectedById.get(material.id);
    if (!current) return;
    setUploadingId(material.id);
    setTraceError(errors => ({ ...errors, [material.id]: '' }));
    try {
      if (current.evidence && !current.evidence.traceability_id) await discardEvidence(current.evidence);
      const evidence = await uploadEvidence({ patientId, file, sourceType });
      replaceItem(material, {
        evidence,
        traceability: { ...(current.traceability ?? {}), evidence_upload_id: evidence.id },
      });
      setExpanded(value => new Set(value).add(material.id));
    } catch (err) {
      setTraceError(errors => ({ ...errors, [material.id]: err instanceof Error ? err.message : 'Não foi possível enviar a foto. Tente novamente.' }));
    } finally { setUploadingId(null); }
  };

  const removePhoto = async (material: Material) => {
    const current = selectedById.get(material.id);
    if (!current?.evidence) return;
    setUploadingId(material.id);
    try {
      await discardEvidence(current.evidence);
      replaceItem(material, {
        evidence: null,
        traceability: { ...(current.traceability ?? {}), evidence_upload_id: null },
      });
    } catch (err) {
      setTraceError(errors => ({ ...errors, [material.id]: err instanceof Error ? err.message : 'Não foi possível remover a foto.' }));
    } finally { setUploadingId(null); }
  };

  const totalUnits = selected.reduce((sum, item) => sum + item.quantity, 0);
  const estimatedCost = selected.reduce((sum, item) => sum + item.quantity * item.material.unit_cost, 0);

  return <div>
    <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 4 }}>Materiais utilizados</h2>
    <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: 14 }}>Opcional. Selecione somente o que foi efetivamente usado neste atendimento.</p>
    <div style={{ position:'relative',marginBottom:14 }}><Search size={16} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--text-3)'}}/><input className="input" style={{paddingLeft:36}} placeholder="Buscar material..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {error && <div className="empty-state"><p>{error}</p></div>}
    {loading ? <p style={{color:'var(--text-3)',textAlign:'center',padding:24}}>Carregando materiais...</p> : <div style={{display:'flex',flexDirection:'column',gap:8}}>{available.map(material=>{
      const picked=selectedById.get(material.id); const quantity=picked?.quantity??0; const traceable=material.traceability_mode!=='none'; const isOpen=expanded.has(material.id); const expired=isExpiredTraceabilityDate(picked?.traceability?.expires_on); const uploadBusy=uploadingId===material.id;
      return <div key={material.id} style={{padding:'12px 14px',background:'var(--bg-2)',border:`1px solid ${material.traceability_mode==='recommended'&&quantity>0?'#f9a8d4':'var(--border)'}`,borderRadius:10}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}><div><div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}><div style={{fontWeight:600}}>{material.name}</div>{traceable&&<span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:9,color:material.traceability_mode==='recommended'?'#9d174d':'var(--text-2)',background:material.traceability_mode==='recommended'?'#fdf2f8':'var(--bg)',border:'1px solid var(--border)'}}><ShieldCheck size={10} style={{verticalAlign:-1}}/> {material.traceability_mode==='recommended'?'Rastreabilidade recomendada':'Rastreável'}</span>}</div><div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>Em estoque: {qtyLabel(material.stock_quantity)} {material.unit_label} · {money(material.unit_cost)}/{material.unit_label}</div></div>{quantity>0&&<button className="icon-btn" onClick={()=>void removeSelected(material)} title="Remover"><Trash2 size={15}/></button>}</div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}><button type="button" aria-label={`Diminuir ${material.name}`} onClick={()=>void setQuantity(material,quantity-1)} disabled={quantity<=0} style={{width:42,height:42,borderRadius:10,border:'1px solid var(--border)',background:'var(--bg)',cursor:quantity>0?'pointer':'default',display:'grid',placeItems:'center'}}><Minus size={18}/></button><input aria-label={`Quantidade de ${material.name}`} className="field-input" inputMode="decimal" value={quantity||''} onChange={e=>void setQuantity(material,Number(e.target.value.replace(',','.'))||0)} placeholder="0" style={{width:90,textAlign:'center',height:42,padding:6}}/><button type="button" aria-label={`Aumentar ${material.name}`} onClick={()=>void setQuantity(material,quantity+1)} disabled={quantity+1>material.stock_quantity} style={{width:42,height:42,borderRadius:10,border:'1px solid var(--border)',background:'var(--bg)',cursor:quantity<material.stock_quantity?'pointer':'default',display:'grid',placeItems:'center'}}><Plus size={18}/></button></div>
        {traceable&&quantity>0&&<div style={{marginTop:10}}>
          <button type="button" onClick={()=>setExpanded(value=>{const next=new Set(value);if(next.has(material.id))next.delete(material.id);else next.add(material.id);return next;})} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'9px 10px',border:'1px solid var(--border)',borderRadius:9,background:'var(--bg)',cursor:'pointer',fontSize:12,fontWeight:700,color:material.traceability_mode==='recommended'?'#9d174d':'var(--text-2)'}}><span style={{display:'flex',alignItems:'center',gap:6}}><ShieldCheck size={14}/> Rastreabilidade{picked?.evidence?' · Foto anexada ✓':''}</span>{isOpen?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>
          {isOpen&&<div style={{marginTop:8,padding:11,border:'1px solid var(--border)',borderRadius:10,background:'var(--bg)'}}>
            <p style={{fontSize:11,color:'var(--text-3)',lineHeight:1.4,marginBottom:10}}>{material.traceability_mode==='recommended'?'Recomendado para este produto, mas não obrigatório. ':''}Registre lote/validade e fotografe o rótulo quando aplicável.</p>
            <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:8}}><div><label style={{fontSize:11,fontWeight:700,color:'var(--text-2)'}}>Lote</label><input className="field-input" value={picked?.traceability?.lot_number??''} onChange={e=>updateTraceability(material,{lot_number:e.target.value})} placeholder="Ex: RD92711" style={{width:'100%',marginTop:4}}/></div><div><label style={{fontSize:11,fontWeight:700,color:'var(--text-2)'}}>Validade</label><input type="date" className="field-input" value={picked?.traceability?.expires_on??''} onChange={e=>updateTraceability(material,{expires_on:e.target.value})} style={{width:'100%',marginTop:4}}/></div></div>
            {expired&&<div style={{marginTop:8,padding:'8px 10px',borderRadius:8,background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',fontSize:12,fontWeight:800}}>⚠ Este lote está vencido{picked?.traceability?.expires_on?` desde ${formatTraceabilityExpiry(picked.traceability.expires_on)}`:''}. Confira antes de continuar.</div>}
            <div style={{marginTop:11}}><div style={{fontSize:11,fontWeight:700,color:'var(--text-2)',marginBottom:6}}>Foto do produto/rótulo</div>{picked?.evidence?<div style={{display:'flex',gap:10,alignItems:'center',padding:8,border:'1px solid #bbf7d0',background:'#f0fdf4',borderRadius:9}}>{picked.evidence.previewUrl&&<img src={picked.evidence.previewUrl} alt={`Rótulo de ${material.name}`} style={{width:58,height:58,objectFit:'cover',borderRadius:7,border:'1px solid var(--border)'}}/>}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:800,color:'#166534'}}>Foto anexada ✓</div><div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>O arquivo definitivo só será vinculado ao confirmar o atendimento.</div></div><button type="button" className="icon-btn" onClick={()=>void removePhoto(material)} disabled={uploadBusy} aria-label="Remover foto"><X size={15}/></button></div>:<><p style={{fontSize:11,color:'var(--text-3)',marginBottom:7}}>Fotografe o rótulo deixando lote e validade visíveis.</p><div style={{display:'flex',gap:7,flexWrap:'wrap'}}><button type="button" className="btn btn--secondary btn--sm" onClick={()=>cameraInputs.current[material.id]?.click()} disabled={uploadBusy}>{uploadBusy?<Loader2 size={14} className="spin"/>:<Camera size={14}/>} Fotografar rótulo</button><button type="button" className="btn btn--ghost btn--sm" onClick={()=>libraryInputs.current[material.id]?.click()} disabled={uploadBusy}><ImagePlus size={14}/> Biblioteca</button></div></>}
              <input ref={node=>{cameraInputs.current[material.id]=node;}} type="file" accept="image/*" capture="environment" hidden onChange={e=>{const file=e.currentTarget.files?.[0];void attachPhoto(material,file,'camera');e.currentTarget.value='';}}/>
              <input ref={node=>{libraryInputs.current[material.id]=node;}} type="file" accept="image/*" hidden onChange={e=>{const file=e.currentTarget.files?.[0];void attachPhoto(material,file,'library');e.currentTarget.value='';}}/>
            </div>
            {traceError[material.id]&&<p style={{fontSize:11,color:'var(--red)',marginTop:8,fontWeight:600}}>{traceError[material.id]}</p>}
          </div>}
        </div>}
      </div>;
    })}</div>}
    <div style={{position:'sticky',bottom:86,marginTop:16,padding:'12px 14px',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,boxShadow:'0 4px 18px rgba(0,0,0,.05)',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',fontSize:13}}><span><strong>{selected.length}</strong> tipo{selected.length===1?'':'s'} · <strong>{qtyLabel(totalUnits)}</strong> unidades</span><span>Custo estimado: <strong>{money(estimatedCost)}</strong></span></div>
  </div>;
}
