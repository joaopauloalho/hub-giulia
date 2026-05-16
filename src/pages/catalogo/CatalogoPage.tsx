import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, X, BookOpen, FileText, Settings } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useServicos } from '../../hooks/useServicos';
import { useMaquininhaConfig } from '../../hooks/useMaquininhaConfig';
import type { Service, ServiceType, ContractTemplate, MaquininhaConfig } from '../../types';

type Section = 'servicos' | 'contratos' | 'config';

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  servico: 'Serviço',
  combo: 'Combo',
  plano: 'Plano',
  produto: 'Produto',
};

const TYPE_BADGE_STYLE: Record<ServiceType, React.CSSProperties> = {
  servico: { background: '#dbeafe', color: '#1d4ed8' },
  combo: { background: '#ede9fe', color: '#6d28d9' },
  plano: { background: '#fef3c7', color: '#b45309' },
  produto: { background: '#dcfce7', color: '#15803d' },
};

const emptyService = (): Omit<Service, 'id' | 'user_id' | 'created_at'> => ({
  name: '',
  type: 'servico',
  price: 0,
  cost_per_unit: 0,
  duration_minutes: null,
  return_min_days: null,
  return_max_days: null,
  technical_sheet: null,
  active: true,
});

// ─── Service Drawer ───────────────────────────────────────────
function ServiceDrawer({
  initial,
  onSave,
  onClose,
}: {
  initial?: Service;
  onSave: (data: Omit<Service, 'id' | 'user_id' | 'created_at'>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name,
          type: initial.type,
          price: initial.price,
          cost_per_unit: initial.cost_per_unit,
          duration_minutes: initial.duration_minutes,
          return_min_days: initial.return_min_days,
          return_max_days: initial.return_max_days,
          technical_sheet: initial.technical_sheet,
          active: initial.active,
        }
      : emptyService()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Nome obrigatório'); return; }
    setSaving(true);
    try {
      await onSave(form as Omit<Service, 'id' | 'user_id' | 'created_at'>);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="service-drawer-title" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 className="drawer-title" id="service-drawer-title">{initial ? 'Editar' : 'Novo'} item</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar item"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <label className="field-label">Nome *</label>
          <input className="field-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Limpeza de pele profunda" />

          <label className="field-label">Tipo</label>
          <select className="field-input" value={form.type} onChange={e => set('type', e.target.value as ServiceType)}>
            {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map(t => (
              <option key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label className="field-label">Preço (R$)</label>
              <input className="field-input" type="number" min="0" step="0.01" value={form.price}
                onChange={e => set('price', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="field-label">Custo (R$)</label>
              <input className="field-input" type="number" min="0" step="0.01" value={form.cost_per_unit}
                onChange={e => set('cost_per_unit', parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <label className="field-label">Duração (minutos)</label>
          <input className="field-input" type="number" min="0"
            value={form.duration_minutes ?? ''}
            onChange={e => set('duration_minutes', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="Ex: 60" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label className="field-label">Retorno mínimo (dias)</label>
              <input className="field-input" type="number" min="0"
                value={form.return_min_days ?? ''}
                onChange={e => set('return_min_days', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="Ex: 21" />
            </div>
            <div>
              <label className="field-label">Retorno máximo (dias)</label>
              <input className="field-input" type="number" min="0"
                value={form.return_max_days ?? ''}
                onChange={e => set('return_max_days', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="Ex: 30" />
            </div>
          </div>

          <label className="field-label">Ficha técnica</label>
          <textarea
            className="field-input"
            rows={4}
            style={{ resize: 'vertical' }}
            value={form.technical_sheet ?? ''}
            onChange={e => set('technical_sheet', e.target.value || null)}
            placeholder="Protocolo, ingredientes, contraindicações..."
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={() => set('active', !form.active)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: form.active ? 'var(--primary)' : 'var(--text-3)', display: 'flex' }}
            >
              {form.active ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
            <span style={{ fontSize: '14px', color: 'var(--text-2)' }}>{form.active ? 'Ativo' : 'Inativo'}</span>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
        </div>
        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contract Template Drawer ─────────────────────────────────
function TemplateDrawer({
  initial,
  onSave,
  onClose,
}: {
  initial?: ContractTemplate;
  onSave: (name: string, body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Nome obrigatório'); return; }
    if (!body.trim()) { setError('Texto obrigatório'); return; }
    setSaving(true);
    try {
      await onSave(name.trim(), body.trim());
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="template-drawer-title" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 className="drawer-title" id="template-drawer-title">{initial ? 'Editar' : 'Novo'} template</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar template"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <label className="field-label">Nome do template *</label>
          <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Contrato padrão" />

          <label className="field-label">Texto do contrato *</label>
          <textarea
            className="field-input"
            rows={14}
            style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' }}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Digite o texto completo do contrato aqui..."
          />
          {error && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
        </div>
        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Service Card ─────────────────────────────────────────────
function ServiceCard({ s, onEdit, onDelete, onToggle }: {
  s: Service;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const margin = s.price - s.cost_per_unit;
  return (
    <div className="card" style={{ opacity: s.active ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '15px' }}>{s.name}</span>
            <span style={{ ...TYPE_BADGE_STYLE[s.type], padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>
              {SERVICE_TYPE_LABELS[s.type]}
            </span>
            {!s.active && (
              <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>
                Inativo
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '14px', marginTop: '6px', fontSize: '13px', color: 'var(--text-2)', flexWrap: 'wrap' }}>
            <span>R$ <strong style={{ color: 'var(--text)' }}>{s.price.toFixed(2)}</strong></span>
            <span>Custo: R$ {s.cost_per_unit.toFixed(2)}</span>
            <span style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              Margem: R$ {margin.toFixed(2)}
            </span>
            {s.duration_minutes ? <span>⏱ {s.duration_minutes}min</span> : null}
            {s.return_min_days && s.return_max_days ? (
              <span>↩ {s.return_min_days}–{s.return_max_days}d</span>
            ) : null}
          </div>
          {s.technical_sheet && (
            <div style={{ marginTop: '8px', padding: '8px 10px', background: 'var(--bg-2)', borderRadius: '8px', fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.5 }}>
              {s.technical_sheet.length > 100 ? s.technical_sheet.slice(0, 100) + '…' : s.technical_sheet}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
          <button className="icon-btn" onClick={onToggle} title={s.active ? 'Desativar' : 'Ativar'}>
            {s.active
              ? <ToggleRight size={20} style={{ color: 'var(--primary)' }} />
              : <ToggleLeft size={20} style={{ color: 'var(--text-3)' }} />
            }
          </button>
          <button className="icon-btn" onClick={onEdit}><Pencil size={16} /></button>
          <button className="icon-btn" onClick={onDelete} style={{ color: 'var(--red)' }}><Trash2 size={16} /></button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────
export function CatalogoPage() {
  const [section, setSection] = useState<Section>('servicos');
  const { servicos, loading: loadingServicos, error: servicosError, create, update, remove, toggle } = useServicos();
  const [filterType, setFilterType] = useState<ServiceType | 'todos'>('todos');
  const [serviceDrawer, setServiceDrawer] = useState<{ open: boolean; item?: Service }>({ open: false });

  // Contract templates
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateDrawer, setTemplateDrawer] = useState<{ open: boolean; item?: ContractTemplate }>({ open: false });

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    setTemplatesError(null);

    try {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates((data as ContractTemplate[]) ?? []);
    } catch (err) {
      setTemplates([]);
      setTemplatesError(err instanceof Error ? err.message : 'Erro ao carregar contratos.');
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => { if (section === 'contratos') loadTemplates(); }, [section, loadTemplates]);

  const saveTemplate = async (name: string, body: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (templateDrawer.item) {
      const { error } = await supabase.from('contract_templates').update({ name, body }).eq('id', templateDrawer.item.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('contract_templates').insert({ name, body, user_id: user!.id });
      if (error) throw error;
    }
    await loadTemplates();
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Excluir este template?')) return;
    await supabase.from('contract_templates').delete().eq('id', id);
    await loadTemplates();
  };

  // Maquininha config
  const {
    config: loadedMaqConfig,
    loading: loadingMaq,
    saving: savingMaq,
    error: maqError,
    save: saveMaq,
  } = useMaquininhaConfig();
  const [maqConfig, setMaqConfig] = useState<MaquininhaConfig>(loadedMaqConfig);
  const [maqSaved, setMaqSaved] = useState(false);

  useEffect(() => {
    setMaqConfig(loadedMaqConfig);
  }, [loadedMaqConfig]);

  const handleSaveMaq = async () => {
    try {
      await saveMaq(maqConfig);
      setMaqSaved(true);
      setTimeout(() => setMaqSaved(false), 2000);
    } catch {
      setMaqSaved(false);
    }
  };

  const filtered = filterType === 'todos' ? servicos : servicos.filter(s => s.type === filterType);

  const sectionTabs: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'servicos', label: 'Serviços', icon: <BookOpen size={15} /> },
    { key: 'contratos', label: 'Contratos', icon: <FileText size={15} /> },
    { key: 'config', label: 'Config', icon: <Settings size={15} /> },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogo</h1>
          <p className="page-sub">{servicos.filter(s => s.active).length} itens ativos</p>
        </div>
        {section === 'servicos' && (
          <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setServiceDrawer({ open: true })}>
            <Plus size={18} /> Novo
          </button>
        )}
        {section === 'contratos' && (
          <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setTemplateDrawer({ open: true })}>
            <Plus size={18} /> Novo
          </button>
        )}
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '0 16px 12px', borderBottom: '1px solid var(--border)' }}>
        {sectionTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '7px 14px', borderRadius: '20px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: 500,
              background: section === t.key ? 'var(--primary)' : 'var(--bg-2)',
              color: section === t.key ? '#fff' : 'var(--text-2)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Serviços ──────────────────────────────────────────── */}
      {section === 'servicos' && (
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {(['todos', 'servico', 'combo', 'plano', 'produto'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)} style={{
                padding: '5px 13px', borderRadius: '16px', border: '1px solid var(--border)', cursor: 'pointer',
                fontSize: '12px', fontWeight: 500,
                background: filterType === t ? 'var(--primary)' : 'transparent',
                color: filterType === t ? '#fff' : 'var(--text-2)',
              }}>
                {t === 'todos' ? 'Todos' : SERVICE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {servicosError ? (
            <div className="empty-state">
              <p>{servicosError}</p>
            </div>
          ) : loadingServicos ? (
            <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '48px 0' }}>Carregando...</p>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
              <p>Nenhum item encontrado.</p>
              <button className="btn-primary" onClick={() => setServiceDrawer({ open: true })}>
                Cadastrar primeiro serviço
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filtered.map(s => (
                <ServiceCard
                  key={s.id}
                  s={s}
                  onEdit={() => setServiceDrawer({ open: true, item: s })}
                  onDelete={async () => { if (confirm('Excluir este item?')) await remove(s.id); }}
                  onToggle={() => toggle(s.id, !s.active)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Contratos ─────────────────────────────────────────── */}
      {section === 'contratos' && (
        <div style={{ padding: '16px' }}>
          {templatesError ? (
            <div className="empty-state">
              <p>{templatesError}</p>
            </div>
          ) : loadingTemplates ? (
            <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '48px 0' }}>Carregando...</p>
          ) : templates.length === 0 ? (
            <div className="empty-state">
              <FileText size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
              <p>Nenhum template de contrato.</p>
              <button className="btn-primary" onClick={() => setTemplateDrawer({ open: true })}>
                Criar primeiro template
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {templates.map(t => (
                <div key={t.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <FileText size={20} style={{ color: 'var(--primary-lt)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: '14px' }}>{t.name}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.body.slice(0, 80)}{t.body.length > 80 ? '…' : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button className="icon-btn" onClick={() => setTemplateDrawer({ open: true, item: t })}><Pencil size={16} /></button>
                    <button className="icon-btn" onClick={() => deleteTemplate(t.id)} style={{ color: 'var(--red)' }}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Config ────────────────────────────────────────────── */}
      {section === 'config' && (
        <div style={{ padding: '16px' }}>
          <div className="card">
            <h3 style={{ fontWeight: 600, fontSize: '15px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={18} style={{ color: 'var(--primary)' }} /> Taxas da maquininha
            </h3>
            {maqError && <p style={{ color: 'var(--red)', fontSize: '13px', marginBottom: 12 }}>{maqError}</p>}

            {/* Rate table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-2)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Modalidade</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--text-3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Master/Visa (%)</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--text-3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Elo (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* PIX */}
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-2)' }}>PIX</td>
                    <td colSpan={2} style={{ padding: '4px 10px', textAlign: 'center' }}>
                      <input
                        type="number" min="0" max="100" step="0.01"
                        disabled={loadingMaq}
                        value={maqConfig.rates.pix}
                        onChange={e => setMaqConfig(c => ({ ...c, rates: { ...c.rates, pix: parseFloat(e.target.value) || 0 } }))}
                        style={{ width: 80, textAlign: 'center', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '13px' }}
                      />
                    </td>
                  </tr>
                  {/* Débito */}
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-2)' }}>Débito</td>
                    {(['master_visa', 'elo'] as const).map(brand => (
                      <td key={brand} style={{ padding: '4px 10px', textAlign: 'center' }}>
                        <input
                          type="number" min="0" max="100" step="0.01"
                          disabled={loadingMaq}
                          value={maqConfig.rates[brand].debito}
                          onChange={e => setMaqConfig(c => ({
                            ...c,
                            rates: { ...c.rates, [brand]: { ...c.rates[brand], debito: parseFloat(e.target.value) || 0 } },
                          }))}
                          style={{ width: 80, textAlign: 'center', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '13px' }}
                        />
                      </td>
                    ))}
                  </tr>
                  {/* 1x – 18x */}
                  {Array.from({ length: 18 }, (_, i) => String(i + 1)).map((inst, idx) => (
                    <tr key={inst} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-2)' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-2)' }}>{inst}x</td>
                      {(['master_visa', 'elo'] as const).map(brand => (
                        <td key={brand} style={{ padding: '4px 10px', textAlign: 'center' }}>
                          <input
                            type="number" min="0" max="100" step="0.01"
                            disabled={loadingMaq}
                            value={(maqConfig.rates[brand] as Record<string, number>)[inst] ?? 0}
                            onChange={e => setMaqConfig(c => ({
                              ...c,
                              rates: { ...c.rates, [brand]: { ...c.rates[brand], [inst]: parseFloat(e.target.value) || 0 } },
                            }))}
                            style={{ width: 80, textAlign: 'center', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, fontSize: '13px' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button className="btn-primary" style={{ marginTop: '16px', width: '100%' }} onClick={handleSaveMaq} disabled={savingMaq || loadingMaq}>
              {savingMaq ? 'Salvando...' : maqSaved ? 'Salvo!' : 'Salvar taxas'}
            </button>
          </div>

          <div className="card" style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', gap: '0', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ flex: 1, padding: '16px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--primary)' }}>{servicos.filter(s => s.active).length}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>itens ativos</p>
              </div>
              <div style={{ flex: 1, padding: '16px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text)' }}>{templates.length}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>templates</p>
              </div>
              <div style={{ flex: 1, padding: '16px', textAlign: 'center' }}>
                <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text)' }}>{servicos.filter(s => !s.active).length}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>inativos</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawers */}
      {serviceDrawer.open && (
        <ServiceDrawer
          initial={serviceDrawer.item}
          onSave={serviceDrawer.item ? (data) => update(serviceDrawer.item!.id, data) : create}
          onClose={() => setServiceDrawer({ open: false })}
        />
      )}
      {templateDrawer.open && (
        <TemplateDrawer
          initial={templateDrawer.item}
          onSave={saveTemplate}
          onClose={() => setTemplateDrawer({ open: false })}
        />
      )}
    </div>
  );
}
