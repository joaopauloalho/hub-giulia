import { useMemo, useState } from 'react';
import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import { useMaterials } from '../../hooks/useMaterials';
import type { Material, ProcedureMaterialInput } from '../../types/materials';

export interface SelectedAttendanceMaterial extends ProcedureMaterialInput {
  material: Material;
}

const qtyLabel = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function MaterialsStep({ selected, onChange }: { selected: SelectedAttendanceMaterial[]; onChange: (value: SelectedAttendanceMaterial[]) => void }) {
  const { materials, loading, error } = useMaterials({ activeOnly: true });
  const [search, setSearch] = useState('');
  const selectedById = useMemo(() => new Map(selected.map(item => [item.material_id, item])), [selected]);
  const available = useMemo(() => materials.filter(m => m.name.toLowerCase().includes(search.trim().toLowerCase())), [materials, search]);

  const setQuantity = (material: Material, quantity: number) => {
    const rounded = Math.max(0, Math.round(quantity * 1000) / 1000);
    if (rounded <= 0) { onChange(selected.filter(item => item.material_id !== material.id)); return; }
    const next = selected.filter(item => item.material_id !== material.id);
    next.push({ material_id: material.id, quantity: rounded, material });
    onChange(next);
  };

  const totalUnits = selected.reduce((sum, item) => sum + item.quantity, 0);
  const estimatedCost = selected.reduce((sum, item) => sum + item.quantity * item.material.unit_cost, 0);

  return <div>
    <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 4 }}>Materiais utilizados</h2>
    <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: 14 }}>Opcional. Selecione somente o que foi efetivamente usado neste atendimento.</p>
    <div style={{ position:'relative',marginBottom:14 }}><Search size={16} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--text-3)'}}/><input className="input" style={{paddingLeft:36}} placeholder="Buscar material..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {error && <div className="empty-state"><p>{error}</p></div>}
    {loading ? <p style={{color:'var(--text-3)',textAlign:'center',padding:24}}>Carregando materiais...</p> : <div style={{display:'flex',flexDirection:'column',gap:8}}>{available.map(material=>{const picked=selectedById.get(material.id);const quantity=picked?.quantity??0;return <div key={material.id} style={{padding:'12px 14px',background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:10}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}><div><div style={{fontWeight:600}}>{material.name}</div><div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>Em estoque: {qtyLabel(material.stock_quantity)} {material.unit_label} · {money(material.unit_cost)}/{material.unit_label}</div></div>{quantity>0&&<button className="icon-btn" onClick={()=>setQuantity(material,0)} title="Remover"><Trash2 size={15}/></button>}</div><div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}><button type="button" aria-label={`Diminuir ${material.name}`} onClick={()=>setQuantity(material,quantity-1)} disabled={quantity<=0} style={{width:42,height:42,borderRadius:10,border:'1px solid var(--border)',background:'var(--bg)',cursor:quantity>0?'pointer':'default',display:'grid',placeItems:'center'}}><Minus size={18}/></button><input aria-label={`Quantidade de ${material.name}`} className="field-input" inputMode="decimal" value={quantity||''} onChange={e=>setQuantity(material,Number(e.target.value.replace(',','.'))||0)} placeholder="0" style={{width:90,textAlign:'center',height:42,padding:6}}/><button type="button" aria-label={`Aumentar ${material.name}`} onClick={()=>setQuantity(material,quantity+1)} disabled={quantity+1>material.stock_quantity} style={{width:42,height:42,borderRadius:10,border:'1px solid var(--border)',background:'var(--bg)',cursor:quantity<material.stock_quantity?'pointer':'default',display:'grid',placeItems:'center'}}><Plus size={18}/></button></div></div>})}</div>}
    <div style={{position:'sticky',bottom:86,marginTop:16,padding:'12px 14px',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:10,boxShadow:'0 4px 18px rgba(0,0,0,.05)',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',fontSize:13}}><span><strong>{selected.length}</strong> tipo{selected.length===1?'':'s'} · <strong>{qtyLabel(totalUnits)}</strong> unidades</span><span>Custo estimado: <strong>{money(estimatedCost)}</strong></span></div>
  </div>;
}
