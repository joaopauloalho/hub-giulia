import { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Minus, Pencil, Plus, Search, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { useMaterials } from '../../hooks/useMaterials';
import { useToast } from '../../hooks/useToast';
import type { Material, MaterialDraft } from '../../types/materials';

const normalizeMoneyInput = (value: string) => {
  const clean = value.replace(/[^\d.,]/g, '');
  if (!clean) return '';
  const separatorIndex = Math.max(clean.lastIndexOf(','), clean.lastIndexOf('.'));
  if (separatorIndex === -1) return clean;
  const integerPart = clean.slice(0, separatorIndex).replace(/[.,]/g, '');
  const decimalPart = clean.slice(separatorIndex + 1).replace(/[.,]/g, '').slice(0, 4);
  return `${integerPart},${decimalPart}`;
};

const parseDecimal = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQty = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const formatMoney = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });

type Filter = 'all' | 'low' | 'inactive';
type Drawer = { type: 'new' } | { type: 'edit'; material: Material } | { type: 'entry'; material: Material } | { type: 'adjust'; material: Material } | null;

function MaterialForm({ material, onClose, onSave }: { material?: Material; onClose: () => void; onSave: (draft: MaterialDraft) => Promise<void> }) {
  const [name, setName] = useState(material?.name ?? '');
  const [unit, setUnit] = useState(material?.unit_label ?? 'un.');
  const [cost, setCost] = useState(material ? String(material.unit_cost).replace('.', ',') : '');
  const [initialStock, setInitialStock] = useState('0');
  const [minimumStock, setMinimumStock] = useState(material ? String(material.minimum_stock).replace('.', ',') : '0');
  const [active, setActive] = useState(material?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim() || !unit.trim()) { setError('Nome e unidade são obrigatórios.'); return; }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), unit_label: unit.trim(), unit_cost: parseDecimal(cost), initial_stock: parseDecimal(initialStock), minimum_stock: parseDecimal(minimumStock), active });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar material.');
    } finally { setSaving(false); }
  };

  return <div className="drawer-overlay" onClick={onClose}><div className="drawer" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
    <div className="drawer-header"><h2 className="drawer-title">{material ? 'Editar material' : 'Novo material'}</h2><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
    <div className="drawer-body">
      <label className="field-label">Nome *</label><input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Seringa 1 ml" />
      <label className="field-label">Unidade *</label><input className="field-input" value={unit} onChange={e => setUnit(e.target.value)} placeholder="un." />
      <label className="field-label">Custo unitário *</label><input className="field-input" inputMode="decimal" value={cost} onChange={e => setCost(normalizeMoneyInput(e.target.value))} placeholder="0,00" />
      {!material && <><label className="field-label">Estoque inicial</label><input className="field-input" inputMode="decimal" value={initialStock} onChange={e => setInitialStock(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" /></>}
      <label className="field-label">Estoque mínimo</label><input className="field-input" inputMode="decimal" value={minimumStock} onChange={e => setMinimumStock(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />
      <button type="button" onClick={() => setActive(v => !v)} style={{ display:'flex',alignItems:'center',gap:8,border:0,background:'none',padding:'10px 0',cursor:'pointer',color:active?'var(--primary)':'var(--text-3)' }}>{active?<ToggleRight size={28}/>:<ToggleLeft size={28}/>}<span>{active?'Ativo':'Inativo'}</span></button>
      {error && <p style={{ color:'var(--red)',fontSize:13 }}>{error}</p>}
    </div>
    <div className="drawer-footer"><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={submit} disabled={saving}>{saving?'Salvando...':'Salvar'}</button></div>
  </div></div>;
}

function StockDrawer({ mode, material, onClose, onSave }: { mode:'entry'|'adjust'; material:Material; onClose:()=>void; onSave:(value:number,reason:string)=>Promise<void> }) {
  const [value,setValue]=useState(mode==='adjust'?String(material.stock_quantity).replace('.',','):'');
  const [reason,setReason]=useState(mode==='entry'?'Entrada de estoque':'');
  const [saving,setSaving]=useState(false); const [error,setError]=useState('');
  const submit=async()=>{ const numeric=parseDecimal(value); if ((mode==='entry'&&numeric<=0)||(mode==='adjust'&&numeric<0)){setError('Informe uma quantidade válida.');return;} if(mode==='adjust'&&!reason.trim()){setError('O motivo do ajuste é obrigatório.');return;} setSaving(true); try{await onSave(numeric,reason.trim());onClose();}catch(err){setError(err instanceof Error?err.message:'Erro ao atualizar estoque.');}finally{setSaving(false);} };
  return <div className="drawer-overlay" onClick={onClose}><div className="drawer" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}>
    <div className="drawer-header"><h2 className="drawer-title">{mode==='entry'?'Entrada de estoque':'Ajustar estoque'}</h2><button className="icon-btn" onClick={onClose}><X size={20}/></button></div>
    <div className="drawer-body"><p style={{fontWeight:600,marginBottom:4}}>{material.name}</p><p style={{fontSize:13,color:'var(--text-3)',marginBottom:16}}>Saldo atual: {formatQty(material.stock_quantity)} {material.unit_label}</p>
      <label className="field-label">{mode==='entry'?'Quantidade da entrada':'Contagem física'}</label><input className="field-input" inputMode="decimal" value={value} onChange={e=>setValue(e.target.value.replace(/[^\d.,]/g,''))}/>
      <label className="field-label">Motivo {mode==='adjust'?'*':''}</label><input className="field-input" value={reason} onChange={e=>setReason(e.target.value)} placeholder={mode==='adjust'?'Ex: Ajuste de inventário':'Opcional'}/>{error&&<p style={{color:'var(--red)',fontSize:13}}>{error}</p>}
    </div><div className="drawer-footer"><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={submit} disabled={saving}>{saving?'Salvando...':'Confirmar'}</button></div>
  </div></div>;
}

export function MaterialsSection() {
  const { materials, loading, error, create, update, addStock, adjustStock } = useMaterials();
  const { toast } = useToast();
  const [search,setSearch]=useState(''); const [filter,setFilter]=useState<Filter>('all'); const [drawer,setDrawer]=useState<Drawer>(null);
  const filtered=useMemo(()=>materials.filter(m=>m.name.toLowerCase().includes(search.trim().toLowerCase())).filter(m=>filter==='low'?m.active&&m.stock_quantity<=m.minimum_stock:filter==='inactive'?!m.active:true),[materials,search,filter]);
  return <div style={{padding:16}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}><button className="btn-primary" onClick={()=>setDrawer({type:'new'})}><Plus size={17}/> Novo material</button></div>
    <div className="search-wrap"><Search size={18} className="search-icon"/><input className="search-input" placeholder="Buscar material..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>{([['all','Todos'],['low','Estoque baixo'],['inactive','Inativos']] as [Filter,string][]).map(([key,label])=><button key={key} onClick={()=>setFilter(key)} style={{padding:'6px 13px',borderRadius:16,border:'1px solid var(--border)',cursor:'pointer',fontSize:12,fontWeight:600,background:filter===key?'var(--primary)':'transparent',color:filter===key?'#fff':'var(--text-2)'}}>{label}</button>)}</div>
    {error?<div className="empty-state"><p>{error}</p></div>:loading?<div className="empty-state"><p>Carregando materiais...</p></div>:filtered.length===0?<div className="empty-state"><Boxes size={44} strokeWidth={1}/><p>Nenhum material encontrado.</p></div>:<div style={{display:'flex',flexDirection:'column',gap:10}}>{filtered.map(m=>{const low=m.active&&m.stock_quantity<=m.minimum_stock;return <div className="card" key={m.id} style={{opacity:m.active?1:.58}}><div style={{display:'flex',gap:12,alignItems:'flex-start'}}><div style={{flex:1,minWidth:0}}><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><strong>{m.name}</strong>{low&&<span style={{fontSize:11,fontWeight:700,color:'#b45309',background:'#fff7ed',padding:'3px 7px',borderRadius:10}}><AlertTriangle size={12} style={{verticalAlign:-2}}/> Estoque baixo</span>}{!m.active&&<span style={{fontSize:11,color:'var(--text-3)'}}>Inativo</span>}</div><div style={{marginTop:7,fontSize:13,color:'var(--text-2)',display:'flex',gap:14,flexWrap:'wrap'}}><span><strong style={{color:'var(--text)'}}>{formatQty(m.stock_quantity)} {m.unit_label}</strong></span><span>Mínimo {formatQty(m.minimum_stock)}</span><span>{formatMoney(m.unit_cost)}/{m.unit_label}</span></div></div><button className="icon-btn" onClick={()=>setDrawer({type:'edit',material:m})}><Pencil size={16}/></button></div><div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}><button className="btn-secondary" style={{display:'flex',gap:5,alignItems:'center'}} onClick={()=>setDrawer({type:'entry',material:m})}><Plus size={15}/> Entrada</button><button className="btn-secondary" style={{display:'flex',gap:5,alignItems:'center'}} onClick={()=>setDrawer({type:'adjust',material:m})}><Minus size={15}/> Ajustar</button></div></div>})}</div>}
    {drawer?.type==='new'&&<MaterialForm onClose={()=>setDrawer(null)} onSave={async draft=>{await create(draft);toast.success('Material cadastrado.');}}/>}
    {drawer?.type==='edit'&&<MaterialForm material={drawer.material} onClose={()=>setDrawer(null)} onSave={async draft=>{await update(drawer.material.id,{name:draft.name,unit_label:draft.unit_label,unit_cost:draft.unit_cost,minimum_stock:draft.minimum_stock,active:draft.active});toast.success('Material atualizado.');}}/>}
    {drawer?.type==='entry'&&<StockDrawer mode="entry" material={drawer.material} onClose={()=>setDrawer(null)} onSave={async(q,r)=>{await addStock(drawer.material.id,q,r);toast.success('Entrada registrada.');}}/>}
    {drawer?.type==='adjust'&&<StockDrawer mode="adjust" material={drawer.material} onClose={()=>setDrawer(null)} onSave={async(q,r)=>{await adjustStock(drawer.material.id,q,r);toast.success('Ajuste registrado.');}}/>}
  </div>;
}
