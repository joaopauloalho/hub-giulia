import { useEffect, useMemo, useState } from 'react';
import { Clock3, Minus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMaterials } from '../../hooks/useMaterials';
import { useClinicCostConfig } from '../../hooks/useClinicCostConfig';
import { getClinicalMinutes, setClinicalMinutes as persistClinicalMinutes } from '../../lib/clinicalTimeRuntime';
import type { Material, ProcedureMaterialInput } from '../../types/materials';

export interface SelectedAttendanceMaterial extends ProcedureMaterialInput {
  material: Material;
}

const qtyLabel = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const timeLabel = (minutes: number) => {
  if (!minutes) return '0 min';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
};

export function MaterialsStep({ selected, onChange }: { selected: SelectedAttendanceMaterial[]; onChange: (value: SelectedAttendanceMaterial[]) => void }) {
  const { materials, loading, error } = useMaterials({ activeOnly: true });
  const clinicCost = useClinicCostConfig();
  const [search, setSearch] = useState('');
  const [clinicalMinutes, setClinicalMinutes] = useState(() => getClinicalMinutes());
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [rateSaved, setRateSaved] = useState(false);
  const selectedById = useMemo(() => new Map(selected.map(item => [item.material_id, item])), [selected]);
  const available = useMemo(() => materials.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase())), [materials, search]);

  useEffect(() => {
    if (!editingRate) setRateInput(clinicCost.hourlyRate ? String(clinicCost.hourlyRate) : '');
  }, [clinicCost.hourlyRate, editingRate]);

  const updateClinicalMinutes = (value: number) => {
    const next = persistClinicalMinutes(value);
    setClinicalMinutes(next);
  };

  const saveHourlyRate = async () => {
    const value = Math.max(0, Number(rateInput.replace(',', '.')) || 0);
    await clinicCost.save(value);
    setEditingRate(false);
    setRateSaved(true);
    window.setTimeout(() => setRateSaved(false), 1600);
  };

  const setQuantity = (material: Material, quantity: number) => {
    const rounded = Math.max(0, Math.round(quantity * 1000) / 1000);
    if (rounded <= 0) { onChange(selected.filter(item => item.material_id !== material.id)); return; }
    const next = selected.filter(item => item.material_id !== material.id);
    next.push({ material_id: material.id, quantity: rounded, material });
    onChange(next);
  };

  const totalUnits = selected.reduce((sum, item) => sum + item.quantity, 0);
  const materialsCost = selected.reduce((sum, item) => sum + item.quantity * item.material.unit_cost, 0);
  const clinicalTimeCost = clinicalMinutes / 60 * clinicCost.hourlyRate;
  const operationalCost = materialsCost + clinicalTimeCost;

  return <div>
    <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 4 }}>Materiais e tempo clínico</h2>
    <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: 14 }}>Registre o que foi efetivamente utilizado neste atendimento. Esses valores entram no custo real da sessão, sem alterar o que a paciente paga.</p>

    <section style={{ marginBottom: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--bg-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><Clock3 size={19} style={{ color: 'var(--primary)', marginTop: 1 }}/><div><strong style={{ display: 'block' }}>Tempo clínico utilizado</strong><span className="page-sub">Informe o tempo real da clínica dedicado à sessão.</span></div></div>
        <div style={{ textAlign: 'right' }}><span className="page-sub">Custo do tempo</span><strong style={{ display: 'block', color: 'var(--primary)', fontSize: '1rem' }}>{money(clinicalTimeCost)}</strong></div>
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 13 }}>
        {[30, 45, 60, 90].map(minutes => <button key={minutes} type="button" className={`btn btn--sm ${clinicalMinutes === minutes ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 42, minWidth: 66 }} onClick={() => updateClinicalMinutes(minutes)}>{timeLabel(minutes)}</button>)}
        <button type="button" className={`btn btn--sm ${clinicalMinutes === 0 ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 42 }} onClick={() => updateClinicalMinutes(0)}>Sem tempo</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,220px) 1fr', gap: 12, alignItems: 'end', marginTop: 12 }}>
        <div><label className="field-label">Outro tempo (minutos)</label><input className="field-input" type="number" inputMode="numeric" min="0" max="1440" step="5" value={clinicalMinutes || ''} onChange={event => updateClinicalMinutes(Number(event.target.value) || 0)} placeholder="Ex: 70"/></div>
        <div style={{ minWidth: 0 }}>
          <label className="field-label">Valor da hora clínica</label>
          {editingRate ? <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}><input className="field-input" inputMode="decimal" value={rateInput} onChange={event => setRateInput(event.target.value)} placeholder="0,00" style={{ maxWidth: 160 }}/><button type="button" className="btn btn--primary btn--sm" disabled={clinicCost.saving} onClick={() => void saveHourlyRate()}>{clinicCost.saving ? 'Salvando…' : 'Salvar padrão'}</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingRate(false)}>Cancelar</button></div> : <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><strong>{clinicCost.loading ? 'Carregando…' : `${money(clinicCost.hourlyRate)}/h`}</strong><button type="button" className="btn btn--ghost btn--sm" disabled={clinicCost.loading} onClick={() => setEditingRate(true)}><Pencil size={13}/> {clinicCost.hourlyRate > 0 ? 'Alterar padrão' : 'Configurar'}</button>{rateSaved && <span style={{ color: '#166534', fontSize: 12, fontWeight: 700 }}>Salvo</span>}</div>}
          {clinicCost.error && <small style={{ display: 'block', color: 'var(--red)', marginTop: 4 }}>{clinicCost.error}</small>}
          {!clinicCost.loading && clinicCost.hourlyRate <= 0 && !editingRate && <small className="page-sub">Defina o valor uma vez. O Hub congela esse valor em cada atendimento para preservar o histórico.</small>}
        </div>
      </div>
      {clinicalMinutes > 0 && clinicCost.hourlyRate > 0 && <div style={{ marginTop: 11, padding: 10, borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13 }}>{timeLabel(clinicalMinutes)} × {money(clinicCost.hourlyRate)}/h = <strong>{money(clinicalTimeCost)}</strong></div>}
    </section>

    <h3 style={{ fontSize: '.95rem', marginBottom: 4 }}>Materiais utilizados</h3>
    <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: 14 }}>Opcional. Selecione somente os materiais efetivamente usados.</p>
    <div style={{ position:'relative',marginBottom:14 }}><Search size={16} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--text-3)'}}/><input className="input" style={{paddingLeft:36}} placeholder="Buscar material..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {error && <div className="empty-state"><p>{error}</p></div>}
    {loading ? <p style={{color:'var(--text-3)',textAlign:'center',padding:24}}>Carregando materiais...</p> : <div style={{display:'flex',flexDirection:'column',gap:8}}>{available.map(material=>{const picked=selectedById.get(material.id);const quantity=picked?.quantity??0;return <div key={material.id} style={{padding:'12px 14px',background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:10}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}><div><div style={{fontWeight:600}}>{material.name}</div><div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>Em estoque: {qtyLabel(material.stock_quantity)} {material.unit_label} · {money(material.unit_cost)}/{material.unit_label}</div></div>{quantity>0&&<button className="icon-btn" onClick={()=>setQuantity(material,0)} title="Remover"><Trash2 size={15}/></button>}</div><div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}><button type="button" aria-label={`Diminuir ${material.name}`} onClick={()=>setQuantity(material,quantity-1)} disabled={quantity<=0} style={{width:42,height:42,borderRadius:10,border:'1px solid var(--border)',background:'var(--bg)',cursor:quantity>0?'pointer':'default',display:'grid',placeItems:'center'}}><Minus size={18}/></button><input aria-label={`Quantidade de ${material.name}`} className="field-input" inputMode="decimal" value={quantity||''} onChange={e=>setQuantity(material,Number(e.target.value.replace(',','.'))||0)} placeholder="0" style={{width:90,textAlign:'center',height:42,padding:6}}/><button type="button" aria-label={`Aumentar ${material.name}`} onClick={()=>setQuantity(material,quantity+1)} disabled={quantity+1>material.stock_quantity} style={{width:42,height:42,borderRadius:10,border:'1px solid var(--border)',background:'var(--bg)',cursor:quantity<material.stock_quantity?'pointer':'default',display:'grid',placeItems:'center'}}><Plus size={18}/></button></div></div>})}</div>}
    <div style={{position:'sticky',bottom:86,marginTop:16,padding:'12px 14px',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,boxShadow:'0 4px 18px rgba(0,0,0,.05)',display:'grid',gap:5,fontSize:13}}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><span><strong>{selected.length}</strong> tipo{selected.length===1?'':'s'} · <strong>{qtyLabel(totalUnits)}</strong> unidades</span><span>Materiais: <strong>{money(materialsCost)}</strong></span></div><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><span>Tempo clínico: <strong>{timeLabel(clinicalMinutes)}</strong></span><span>Custo do tempo: <strong>{money(clinicalTimeCost)}</strong></span></div><div style={{display:'flex',justifyContent:'space-between',gap:12,paddingTop:6,borderTop:'1px solid var(--border)'}}><strong>Custo operacional estimado</strong><strong style={{color:'var(--primary)'}}>{money(operationalCost)}</strong></div></div>
  </div>;
}
