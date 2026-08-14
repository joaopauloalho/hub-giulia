import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, FileClock, Plus, Save, UserRound } from 'lucide-react';
import type { ContractTemplate, ContractTemplateVersion } from '../../types';
import {
  loadContractTemplates,
  loadContractTemplateVersions,
  loadProfessionalProfile,
  saveContractTemplate,
  saveProfessionalProfile,
  setContractTemplateActive,
} from '../../hooks/useContracts';
import { CONTRACT_PLACEHOLDERS, CONTRACT_PREVIEW_VARS, interpolateContract } from '../../lib/contractUtils';
import { useToast } from '../../hooks/useToast';
import './contracts.css';

interface Props { onChanged?: () => void; }

export function ContractTemplateManager({ onChanged }: Props) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [versions, setVersions] = useState<ContractTemplateVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState<ContractTemplateVersion | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({ display_name: '', profession: '', professional_registration: '' });
  const [profileSaving, setProfileSaving] = useState(false);

  const refresh = async (preferredId?: string | null) => {
    const rows = await loadContractTemplates();
    setTemplates(rows);
    const nextId = preferredId ?? selectedId ?? rows[0]?.id ?? null;
    setSelectedId(nextId);
    const selected = rows.find(item => item.id === nextId);
    if (selected) {
      setName(selected.name);
      setBody(selected.body);
      setVersions(await loadContractTemplateVersions(selected.id));
    } else {
      setName(''); setBody(''); setVersions([]);
    }
    setHistoryVersion(null);
  };

  useEffect(() => {
    void Promise.all([refresh(), loadProfessionalProfile()]).then(([, professional]) => {
      if (professional) setProfile({
        display_name: professional.display_name,
        profession: professional.profession ?? '',
        professional_registration: professional.professional_registration ?? '',
      });
    }).catch(error => {
      console.error('[contracts:template-manager:init]', error);
      toast.error('Não foi possível carregar os modelos.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = templates.find(item => item.id === selectedId) ?? null;
  const currentVersion = versions[0]?.version_number ?? (selected ? 1 : 0);
  const preview = useMemo(() => interpolateContract(body, CONTRACT_PREVIEW_VARS), [body]);

  const choose = async (template: ContractTemplate) => {
    setSelectedId(template.id); setName(template.name); setBody(template.body); setHistoryVersion(null);
    try { setVersions(await loadContractTemplateVersions(template.id)); }
    catch { setVersions([]); }
  };

  const newTemplate = () => {
    setSelectedId(null); setName(''); setBody(''); setVersions([]); setHistoryVersion(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertPlaceholder = (key: string) => {
    const textarea = textareaRef.current;
    const token = `{{${key}}}`;
    if (!textarea) { setBody(value => `${value}${value ? '\n' : ''}${token}`); return; }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? start;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!name.trim() || !body.trim()) { toast.error('Informe nome e conteúdo do modelo.'); return; }
    setSaving(true);
    try {
      const result = await saveContractTemplate({ id: selectedId, name, body });
      await refresh(result.template_id);
      onChanged?.();
      toast.success(result.unchanged ? 'Modelo sem alterações.' : `Modelo salvo como versão ${result.version_number}.`);
    } catch (error) {
      console.error('[contracts:template-save]', error);
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o modelo.');
    } finally { setSaving(false); }
  };

  const toggleActive = async () => {
    if (!selected) return;
    try {
      await setContractTemplateActive(selected.id, !selected.active);
      await refresh(selected.id);
      onChanged?.();
      toast.success(selected.active ? 'Modelo arquivado.' : 'Modelo reativado.');
    } catch { toast.error('Não foi possível alterar o modelo.'); }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      await saveProfessionalProfile(profile);
      toast.success('Dados profissionais salvos.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar os dados profissionais.');
    } finally { setProfileSaving(false); }
  };

  return <div className="contract-manager">
    <section className="contract-manager__profile">
      <div className="contract-section-title"><UserRound size={16} /> Dados profissionais</div>
      <div className="contract-profile-grid">
        <label><span>Nome profissional</span><input className="field-input" value={profile.display_name} onChange={e => setProfile(v => ({ ...v, display_name: e.target.value }))} placeholder="Ex.: Dra. Giulia Assis" /></label>
        <label><span>Profissão</span><input className="field-input" value={profile.profession} onChange={e => setProfile(v => ({ ...v, profession: e.target.value }))} placeholder="Ex.: Biomédica" /></label>
        <label><span>Registro profissional</span><input className="field-input" value={profile.professional_registration} onChange={e => setProfile(v => ({ ...v, professional_registration: e.target.value }))} placeholder="Preencha somente se aplicável" /></label>
        <button className="btn btn--secondary btn--sm" onClick={() => void saveProfile()} disabled={profileSaving}><Check size={14} /> {profileSaving ? 'Salvando...' : 'Salvar dados'}</button>
      </div>
      <div className="page-sub">Esses dados são congelados no documento quando usados. O sistema não usa mais o e-mail como nome profissional.</div>
    </section>

    <div className="contract-manager__layout">
      <aside className="contract-manager__list">
        <button className="btn btn--secondary btn--sm" onClick={newTemplate}><Plus size={14} /> Novo modelo</button>
        {templates.map(template => <button key={template.id} type="button" className={`contract-template-row${selectedId === template.id ? ' contract-template-row--active' : ''}`} onClick={() => void choose(template)}>
          <strong>{template.name}</strong><span>{template.active ? 'Ativo' : 'Arquivado'}</span>
        </button>)}
        {templates.length === 0 && <div className="page-sub" style={{ padding: 8 }}>Nenhum modelo criado ainda.</div>}
      </aside>

      <section className="contract-manager__editor">
        <div className="contract-editor-head">
          <div><strong>{selected ? `Editar modelo · versão atual ${currentVersion}` : 'Novo modelo'}</strong><div className="page-sub">Cada alteração salva uma nova versão imutável.</div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {selected && <button className="btn btn--ghost btn--sm" onClick={() => void toggleActive()}><Archive size={14} /> {selected.active ? 'Arquivar' : 'Reativar'}</button>}
            <button className="btn btn--primary btn--sm" onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? 'Salvando...' : 'Salvar nova versão'}</button>
          </div>
        </div>
        <label><span className="field-label">Nome do documento</span><input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Termo de Consentimento — Toxina Botulínica" /></label>
        <div>
          <div className="field-label">Variáveis disponíveis</div>
          <div className="contract-placeholder-list">{CONTRACT_PLACEHOLDERS.map(item => <button key={item.key} type="button" onClick={() => insertPlaceholder(item.key)} title={item.label}>{`{{${item.key}}}`}</button>)}</div>
        </div>
        <label><span className="field-label">Conteúdo</span><textarea ref={textareaRef} className="field-input contract-template-textarea" value={body} onChange={e => setBody(e.target.value)} placeholder="Cole aqui o conteúdo já revisado do termo/contrato." /></label>
        <div className="page-sub">O editor usa texto simples: HTML, scripts e conteúdo executável não são interpretados.</div>
        <div className="contract-preview"><strong>Prévia com dados fictícios</strong><div>{preview || 'A prévia aparece aqui.'}</div></div>

        {versions.length > 0 && <div className="contract-version-history">
          <div className="contract-section-title"><FileClock size={15} /> Histórico de versões</div>
          <div className="contract-version-pills">{versions.map(version => <button key={version.id} type="button" onClick={() => setHistoryVersion(version)}>v{version.version_number} · {new Date(version.created_at).toLocaleDateString('pt-BR')}</button>)}</div>
          {historyVersion && <div className="contract-history-preview"><strong>Versão {historyVersion.version_number} — somente leitura</strong><div>{historyVersion.name_snapshot}</div><pre>{historyVersion.body}</pre></div>}
        </div>}
      </section>
    </div>
  </div>;
}
