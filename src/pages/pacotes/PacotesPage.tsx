import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Gift, Loader2, PackagePlus, RefreshCw, Search, WalletCards } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { usePackagesActions } from '../../hooks/usePackages';
import { useToast } from '../../hooks/useToast';
import { supabase } from '../../lib/supabase';
import type { PatientEntitlement, VoucherRecord } from '../../types/packages';

type PackageRow = {
  id: string;
  patient_id: string;
  title_snapshot: string;
  source_type: 'proposal' | 'manual' | 'voucher' | 'complimentary';
  status: 'draft' | 'active' | 'voided';
  commercial_total_snapshot: number;
  valid_from: string | null;
  valid_until: string | null;
  sale_recorded_at: string | null;
  created_at: string;
};

type ProposalRow = {
  id: string;
  title: string;
  total_value: number;
  accepted_at: string | null;
};

const sourceLabels = { proposal: 'Proposta', manual: 'Manual', voucher: 'Voucher', complimentary: 'Cortesia' } as const;
const statusLabels = { draft: 'Pendente', active: 'Ativo', voided: 'Anulado' } as const;
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string | null) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem validade';

export function PacotesPage() {
  const { toast } = useToast();
  const { pacientes, loading: patientsLoading } = usePacientes({ pageSize: 200 });
  const { servicos, loading: servicesLoading } = useServicos();
  const actions = usePackagesActions();
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [entitlements, setEntitlements] = useState<PatientEntitlement[]>([]);
  const [vouchers, setVouchers] = useState<VoucherRecord[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [proposalVersionId, setProposalVersionId] = useState('');
  const [manualPatientId, setManualPatientId] = useState('');
  const [manualServiceId, setManualServiceId] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualValidUntil, setManualValidUntil] = useState('');
  const [manualSource, setManualSource] = useState<'manual' | 'complimentary'>('manual');
  const [manualReason, setManualReason] = useState('');
  const [voucherServiceId, setVoucherServiceId] = useState('');
  const [voucherQuantity, setVoucherQuantity] = useState(1);
  const [voucherValidUntil, setVoucherValidUntil] = useState('');
  const [voucherRecipient, setVoucherRecipient] = useState('');
  const [voucherPatientId, setVoucherPatientId] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemPatientId, setRedeemPatientId] = useState('');
  const [lastVoucherCode, setLastVoucherCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [packageResult, balanceResult, voucherResult, proposalResult] = await Promise.all([
        supabase.from('patient_packages').select('id,patient_id,title_snapshot,source_type,status,commercial_total_snapshot,valid_from,valid_until,sale_recorded_at,created_at').order('created_at', { ascending: false }).limit(100),
        supabase.from('patient_credit_item_balances_v').select('*').order('package_title').order('service_name_snapshot'),
        supabase.from('vouchers').select('*').order('issued_at', { ascending: false }).limit(100),
        supabase.from('treatment_proposal_versions').select('id,title,total_value,accepted_at').eq('status', 'accepted').order('accepted_at', { ascending: false }).limit(100),
      ]);
      if (packageResult.error) throw packageResult.error;
      if (balanceResult.error) throw balanceResult.error;
      if (voucherResult.error) throw voucherResult.error;
      if (proposalResult.error) throw proposalResult.error;
      setPackages((packageResult.data ?? []).map(row => ({ ...row, commercial_total_snapshot: Number(row.commercial_total_snapshot) })) as PackageRow[]);
      setEntitlements((balanceResult.data ?? []).map(row => ({
        ...row,
        quantity_granted: Number(row.quantity_granted),
        commercial_value_snapshot: row.commercial_value_snapshot == null ? null : Number(row.commercial_value_snapshot),
        granted: Number(row.granted),
        redeemed: Number(row.redeemed),
        reversed: Number(row.reversed),
        adjusted: Number(row.adjusted),
        raw_balance: Number(row.raw_balance),
        available_balance: Number(row.available_balance),
      })) as PatientEntitlement[]);
      setVouchers((voucherResult.data ?? []).map(row => ({ ...row, quantity: Number(row.quantity) })) as VoucherRecord[]);
      setProposals((proposalResult.data ?? []).map(row => ({ ...row, total_value: Number(row.total_value) })) as ProposalRow[]);
    } catch (error) {
      console.error('[PacotesPage.refresh]', error);
      toast.error('Não foi possível carregar pacotes e vouchers.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const patientName = useCallback((id: string) => pacientes.find(patient => patient.id === id)?.name ?? 'Paciente', [pacientes]);
  const packageIdsFromProposal = useMemo(() => new Set(packages.filter(pkg => pkg.source_type === 'proposal').map(pkg => entitlements.find(item => item.package_id === pkg.id)?.source_proposal_version_id).filter(Boolean)), [packages, entitlements]);
  const availableProposals = proposals.filter(proposal => !packageIdsFromProposal.has(proposal.id));
  const filteredPackages = packages.filter(pkg => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return pkg.title_snapshot.toLowerCase().includes(query) || patientName(pkg.patient_id).toLowerCase().includes(query);
  });

  const createFromProposal = async () => {
    if (!proposalVersionId) return;
    try {
      await actions.createFromProposal(proposalVersionId);
      toast.success('Pacote criado a partir da proposta aceita. Ative quando os créditos puderem ser usados.');
      setProposalVersionId('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o pacote.');
    }
  };

  const createManual = async () => {
    const service = servicos.find(item => item.id === manualServiceId);
    if (!manualPatientId || !service || !manualTitle.trim() || manualQuantity <= 0 || !manualReason.trim()) {
      toast.error('Preencha paciente, nome, serviço, quantidade e motivo.');
      return;
    }
    try {
      await actions.createManual({
        patientId: manualPatientId,
        title: manualTitle.trim(),
        sourceType: manualSource,
        items: [{ service_id: service.id, quantity: manualQuantity, commercial_value: manualSource === 'complimentary' ? 0 : service.price * manualQuantity }],
        validUntil: manualValidUntil || null,
        reason: manualReason.trim(),
      });
      toast.success('Pacote manual criado. Ative para conceder os créditos.');
      setManualTitle(''); setManualServiceId(''); setManualQuantity(1); setManualValidUntil(''); setManualReason('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o pacote.');
    }
  };

  const activatePackage = async (packageId: string) => {
    try {
      await actions.activate(packageId);
      toast.success('Pacote ativado e créditos concedidos.');
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível ativar.'); }
  };

  const adjustCredit = async (packageId: string) => {
    const item = entitlements.find(row => row.package_id === packageId);
    if (!item) { toast.error('Item do pacote não localizado.'); return; }
    const quantityText = window.prompt(`Ajuste para ${item.service_name_snapshot}. Use número positivo ou negativo:`);
    if (quantityText == null) return;
    const quantity = Number(quantityText.replace(',', '.'));
    const reason = window.prompt('Motivo obrigatório do ajuste:')?.trim();
    if (!Number.isFinite(quantity) || quantity === 0 || !reason) { toast.error('Informe uma quantidade válida e o motivo.'); return; }
    try { await actions.adjust(item.package_item_id, quantity, reason); toast.success('Ajuste registrado no ledger.'); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível ajustar.'); }
  };

  const voidPackage = async (packageId: string) => {
    const reason = window.prompt('Motivo obrigatório para anular o pacote:')?.trim();
    if (!reason) return;
    try { await actions.voidPackage(packageId, reason); toast.success('Pacote anulado sem apagar o histórico.'); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível anular.'); }
  };

  const issueVoucher = async () => {
    if (!voucherServiceId || voucherQuantity <= 0) { toast.error('Selecione serviço e quantidade.'); return; }
    try {
      const voucher = await actions.issueVoucher({ serviceId: voucherServiceId, quantity: voucherQuantity, validUntil: voucherValidUntil || null, recipientName: voucherRecipient || null, patientId: voucherPatientId || null, source: 'manual' });
      setLastVoucherCode(voucher.code);
      toast.success(`Voucher ${voucher.code} emitido.`);
      setVoucherQuantity(1); setVoucherValidUntil(''); setVoucherRecipient(''); setVoucherPatientId('');
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível emitir o voucher.'); }
  };

  const redeemVoucher = async () => {
    if (!redeemCode.trim() || !redeemPatientId) { toast.error('Informe o código e a paciente.'); return; }
    try { await actions.redeemVoucher(redeemCode.trim(), redeemPatientId); toast.success('Voucher resgatado e convertido em créditos.'); setRedeemCode(''); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível resgatar.'); }
  };

  const voidVoucher = async (voucherId: string) => {
    const reason = window.prompt('Motivo obrigatório para anular o voucher:')?.trim();
    if (!reason) return;
    try { await actions.voidVoucher(voucherId, reason); toast.success('Voucher anulado.'); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível anular.'); }
  };

  if (loading || patientsLoading || servicesLoading) return <div className="page"><div className="full-loader"><Loader2 className="spin" size={24} /> Carregando pacotes…</div></div>;

  return <div className="page">
    <div className="page-header"><div><h1 className="page-title">Pacotes & Vouchers</h1><p className="page-sub">Direitos operacionais da paciente, com saldo derivado do histórico.</p></div><button className="btn btn--secondary btn--sm" onClick={() => void refresh()}><RefreshCw size={15} /> Atualizar</button></div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginBottom: 14 }}>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><PackagePlus size={17} /><strong>Da proposta aceita</strong></div>
        <select className="field-input" value={proposalVersionId} onChange={event => setProposalVersionId(event.target.value)}><option value="">Selecionar proposta aceita…</option>{availableProposals.map(proposal => <option key={proposal.id} value={proposal.id}>{proposal.title} · {money(proposal.total_value)}</option>)}</select>
        <p className="page-sub" style={{ margin: '7px 0 10px' }}>Criar pacote não significa pagamento recebido e não concede créditos até a ativação.</p>
        <button className="btn-primary" type="button" disabled={!proposalVersionId || actions.loading} onClick={() => void createFromProposal()}>Criar pacote</button>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><WalletCards size={17} /><strong>Novo pacote manual</strong></div>
        <div style={{ display: 'grid', gap: 8 }}>
          <select className="field-input" value={manualPatientId} onChange={event => setManualPatientId(event.target.value)}><option value="">Paciente…</option>{pacientes.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select>
          <input className="field-input" placeholder="Nome do pacote" value={manualTitle} onChange={event => setManualTitle(event.target.value)} />
          <select className="field-input" value={manualServiceId} onChange={event => setManualServiceId(event.target.value)}><option value="">Serviço…</option>{servicos.filter(service => service.active).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><input className="field-input" type="number" min="1" step="1" value={manualQuantity} onChange={event => setManualQuantity(Number(event.target.value))} /><select className="field-input" value={manualSource} onChange={event => setManualSource(event.target.value as 'manual' | 'complimentary')}><option value="manual">Manual / vendido</option><option value="complimentary">Cortesia</option></select></div>
          <input className="field-input" type="date" value={manualValidUntil} onChange={event => setManualValidUntil(event.target.value)} />
          <input className="field-input" placeholder="Motivo obrigatório" value={manualReason} onChange={event => setManualReason(event.target.value)} />
          <button className="btn-primary" type="button" onClick={() => void createManual()} disabled={actions.loading}>Criar pacote</button>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><Gift size={17} /><strong>Voucher</strong></div>
        <div style={{ display: 'grid', gap: 8 }}>
          <select className="field-input" value={voucherServiceId} onChange={event => setVoucherServiceId(event.target.value)}><option value="">Serviço…</option>{servicos.filter(service => service.active).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><input className="field-input" type="number" min="1" value={voucherQuantity} onChange={event => setVoucherQuantity(Number(event.target.value))} /><input className="field-input" type="date" value={voucherValidUntil} onChange={event => setVoucherValidUntil(event.target.value)} /></div>
          <input className="field-input" placeholder="Destinatário (opcional)" value={voucherRecipient} onChange={event => setVoucherRecipient(event.target.value)} />
          <select className="field-input" value={voucherPatientId} onChange={event => setVoucherPatientId(event.target.value)}><option value="">Sem paciente vinculada ainda</option>{pacientes.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select>
          <button className="btn-primary" type="button" onClick={() => void issueVoucher()} disabled={actions.loading}>Emitir voucher</button>
          {lastVoucherCode && <div style={{ padding: 9, borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontWeight: 700 }}>Código: {lastVoucherCode}</div>}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 9, display: 'grid', gap: 7 }}><strong style={{ fontSize: 12 }}>Resgatar código</strong><input className="field-input" placeholder="GIU-..." value={redeemCode} onChange={event => setRedeemCode(event.target.value)} /><select className="field-input" value={redeemPatientId} onChange={event => setRedeemPatientId(event.target.value)}><option value="">Paciente…</option>{pacientes.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select><button className="btn btn--secondary btn--sm" onClick={() => void redeemVoucher()}><Check size={14} /> Resgatar</button></div>
        </div>
      </div>
    </div>

    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><strong style={{ flex: 1 }}>Pacotes</strong><div style={{ position: 'relative', maxWidth: 280, flex: 1 }}><Search size={14} style={{ position: 'absolute', left: 9, top: 10, color: 'var(--text-3)' }} /><input className="field-input" style={{ paddingLeft: 30 }} placeholder="Buscar paciente ou pacote" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
      <div style={{ display: 'grid', gap: 8 }}>{filteredPackages.length === 0 ? <p className="page-sub">Nenhum pacote.</p> : filteredPackages.map(pkg => {
        const items = entitlements.filter(item => item.package_id === pkg.id);
        const available = items.reduce((sum, item) => sum + item.available_balance, 0);
        return <div key={pkg.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 11, background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><strong>{pkg.title_snapshot}</strong><div className="page-sub">{patientName(pkg.patient_id)} · {sourceLabels[pkg.source_type]} · {date(pkg.valid_until)}</div></div><div style={{ textAlign: 'right' }}><strong style={{ fontSize: 12 }}>{statusLabels[pkg.status]}</strong><div className="page-sub">{available.toLocaleString('pt-BR')} crédito{available === 1 ? '' : 's'} disponível{available === 1 ? '' : 'is'}</div></div></div>
          {items.length > 0 && <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>{items.map(item => <div key={item.package_item_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span>{item.service_name_snapshot}</span><strong>{item.available_balance.toLocaleString('pt-BR')} / {item.quantity_granted.toLocaleString('pt-BR')}</strong></div>)}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>{pkg.status === 'draft' && <button className="btn btn--primary btn--sm" onClick={() => void activatePackage(pkg.id)}>Ativar créditos</button>}{pkg.status === 'active' && items.length > 0 && <button className="btn btn--secondary btn--sm" onClick={() => void adjustCredit(pkg.id)}>Ajustar créditos</button>}{pkg.status !== 'voided' && <button className="btn btn--ghost btn--sm" onClick={() => void voidPackage(pkg.id)}>Anular</button>}{pkg.source_type !== 'voucher' && pkg.source_type !== 'complimentary' && <span className="page-sub" style={{ alignSelf: 'center' }}>{pkg.sale_recorded_at ? 'Venda registrada' : `Venda ainda não registrada · ${money(pkg.commercial_total_snapshot)}`}</span>}</div>
        </div>;
      })}</div>
    </div>

    <div className="card" style={{ padding: 14 }}><strong>Vouchers emitidos</strong><div style={{ display: 'grid', gap: 7, marginTop: 9 }}>{vouchers.length === 0 ? <p className="page-sub">Nenhum voucher.</p> : vouchers.slice(0, 30).map(voucher => <div key={voucher.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 7 }}><div><strong style={{ fontSize: 13 }}>{voucher.code}</strong><div className="page-sub">{voucher.service_name_snapshot} · {voucher.quantity.toLocaleString('pt-BR')} · {voucher.valid_until ? `até ${date(voucher.valid_until)}` : 'sem validade'}</div></div><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span className="page-sub">{voucher.status === 'active' ? 'Ativo' : voucher.status === 'redeemed' ? 'Resgatado' : 'Anulado'}</span>{voucher.status === 'active' && <button className="btn btn--ghost btn--sm" onClick={() => void voidVoucher(voucher.id)}>Anular</button>}</div></div>)}</div></div>
  </div>;
}
