import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, FileCheck2, RotateCcw, ShieldCheck } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { Patient, PreparedContract, ContractTemplate } from '../../types';
import {
  finalizePreparedContract,
  loadContractContexts,
  loadContractTemplates,
  loadPreparedContract,
  prepareContract,
  type ContractContextOption,
  uploadContractArtifact,
  voidContract,
} from '../../hooks/useContracts';
import { useToast } from '../../hooks/useToast';
import './contracts.css';

interface Props {
  patient: Patient;
  contractId?: string | null;
  initialProcedureId?: string | null;
  initialAppointmentId?: string | null;
  onClose: () => void;
  onDone: () => void;
}

const pdfStyles = StyleSheet.create({
  page: { padding: 42, fontFamily: 'Helvetica', fontSize: 10.5, color: '#222' },
  title: { fontSize: 17, fontWeight: 'bold', marginBottom: 5 },
  meta: { fontSize: 9, color: '#666', marginBottom: 18 },
  body: { lineHeight: 1.65, marginBottom: 26 },
  signature: { borderTop: '1px solid #ddd', paddingTop: 14, marginTop: 12 },
  signatureLabel: { fontSize: 8.5, color: '#666', marginBottom: 5 },
  signatureImage: { width: 210, height: 80, objectFit: 'contain' },
  signatureName: { fontSize: 9.5, marginTop: 7, paddingTop: 4, borderTop: '1px solid #333', width: 210 },
  integrity: { fontSize: 7, color: '#777', marginTop: 18 },
});

function ContractPDF({ contract, signatureDataUrl, signedLabel }: { contract: PreparedContract; signatureDataUrl: string; signedLabel: string }) {
  return <Document>
    <Page size="A4" style={pdfStyles.page}>
      <Text style={pdfStyles.title}>{contract.document_name}</Text>
      <Text style={pdfStyles.meta}>Paciente: {contract.patient_snapshot.name} · Assinatura capturada em {signedLabel}</Text>
      <Text style={pdfStyles.body}>{contract.rendered_content}</Text>
      <View style={pdfStyles.signature}>
        <Text style={pdfStyles.signatureLabel}>Assinatura da paciente</Text>
        <Image style={pdfStyles.signatureImage} src={signatureDataUrl} />
        <Text style={pdfStyles.signatureName}>{contract.patient_snapshot.name}</Text>
      </View>
      <Text style={pdfStyles.integrity}>Integridade do conteúdo: SHA-256 {contract.content_sha256}</Text>
    </Page>
  </Document>;
}

function contextValue(option: ContractContextOption) { return option.key; }

export function SignatureScreen({ patient, contractId, initialProcedureId, initialAppointmentId, onClose, onDone }: Props) {
  const sigRef = useRef<SignatureCanvas>(null);
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const finalizeLock = useRef(false);
  const { toast, confirm } = useToast();
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [contexts, setContexts] = useState<ContractContextOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedContextKey, setSelectedContextKey] = useState('patient');
  const [prepareKey, setPrepareKey] = useState(() => crypto.randomUUID());
  const [finalizeKey, setFinalizeKey] = useState(() => crypto.randomUUID());
  const [prepared, setPrepared] = useState<PreparedContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [templateRows, contextRows] = await Promise.all([
          loadContractTemplates(true),
          loadContractContexts(patient.id),
        ]);
        if (!active) return;
        setTemplates(templateRows);
        setContexts(contextRows);
        setSelectedTemplateId(templateRows[0]?.id ?? '');
        const initialContext = initialProcedureId
          ? contextRows.find(item => item.type === 'procedure' && item.id === initialProcedureId)
          : initialAppointmentId
            ? contextRows.find(item => item.type === 'appointment' && item.id === initialAppointmentId)
            : null;
        setSelectedContextKey(initialContext?.key ?? 'patient');
        if (contractId) setPrepared(await loadPreparedContract(patient.id, contractId));
      } catch (error) {
        console.error('[contracts:signature:init]', error);
        toast.error('Não foi possível preparar a tela de assinatura.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [contractId, initialAppointmentId, initialProcedureId, patient.id, toast]);

  useEffect(() => {
    if (!prepared) return;
    const box = canvasBoxRef.current;
    const signature = sigRef.current;
    if (!box || !signature) return;

    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = signature.getCanvas();
        const rect = box.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;
        const hadSignature = !signature.isEmpty();
        const data = hadSignature ? signature.toDataURL('image/png') : null;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = Math.floor(rect.width * ratio);
        canvas.height = Math.floor(rect.height * ratio);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        canvas.getContext('2d')?.scale(ratio, ratio);
        signature.clear();
        if (data) signature.fromDataURL(data, { ratio, width: rect.width, height: rect.height });
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    resize();
    window.addEventListener('orientationchange', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', resize);
      cancelAnimationFrame(frame);
    };
  }, [prepared?.id]);

  const selectedTemplate = templates.find(item => item.id === selectedTemplateId) ?? null;
  const selectedContext = contexts.find(item => item.key === selectedContextKey) ?? contexts[0];

  const changeTemplate = (id: string) => {
    setSelectedTemplateId(id);
    setPrepareKey(crypto.randomUUID());
  };
  const changeContext = (key: string) => {
    setSelectedContextKey(key);
    setPrepareKey(crypto.randomUUID());
  };

  const handlePrepare = async () => {
    if (!selectedTemplate || !selectedContext) { toast.error('Selecione um modelo válido.'); return; }
    setPreparing(true);
    try {
      setPrepared(await prepareContract({
        patientId: patient.id,
        templateId: selectedTemplate.id,
        context: selectedContext,
        idempotencyKey: prepareKey,
      }));
      setFinalizeKey(crypto.randomUUID());
    } catch (error) {
      console.error('[contracts:prepare]', error);
      toast.error(error instanceof Error ? error.message : 'Não foi possível preparar o contrato.');
    } finally { setPreparing(false); }
  };

  const handleClear = async () => {
    if (sigRef.current?.isEmpty()) return;
    const ok = await confirm({
      title: 'Limpar assinatura?',
      message: 'O traço atual será apagado e precisará ser feito novamente.',
      confirmLabel: 'Limpar',
      cancelLabel: 'Manter',
      tone: 'warning',
    });
    if (ok) sigRef.current?.clear();
  };

  const handleCancel = async () => {
    if (!prepared) { onClose(); return; }
    try {
      await voidContract(prepared.id, 'Preparação cancelada antes da assinatura.');
      onClose();
    } catch (error) {
      console.error('[contracts:cancel-ready]', error);
      toast.error('Não foi possível cancelar este documento com segurança.');
    }
  };

  const handleFinalize = async () => {
    if (!prepared || finalizeLock.current || saving) return;
    if (!sigRef.current || sigRef.current.isEmpty()) { toast.error('Assine antes de confirmar.'); return; }
    finalizeLock.current = true;
    setSaving(true);
    try {
      const signatureDataUrl = sigRef.current.toDataURL('image/png');
      const signatureBlob = await (await fetch(signatureDataUrl)).blob();
      await uploadContractArtifact(prepared.id, 'signature.png', signatureBlob);

      const signedLabel = new Date().toLocaleString('pt-BR');
      const pdfBlob = await pdf(<ContractPDF contract={prepared} signatureDataUrl={signatureDataUrl} signedLabel={signedLabel} />).toBlob();
      await uploadContractArtifact(prepared.id, 'document.pdf', pdfBlob);
      await finalizePreparedContract(prepared.id, finalizeKey);
      toast.success('Documento assinado e finalizado.');
      onDone();
    } catch (error) {
      console.error('[contracts:finalize]', {
        contract_id: prepared.id,
        code: error instanceof Error ? error.message : 'unknown',
      });
      toast.error(error instanceof Error ? error.message : 'Não foi possível finalizar o contrato.');
      finalizeLock.current = false;
    } finally { setSaving(false); }
  };

  return <div className="contract-signature-root" role="dialog" aria-modal="true" aria-labelledby="contract-sign-title">
    <header className="contract-signature-header">
      <button className="drawer-back" onClick={() => void handleCancel()} aria-label="Voltar"><ChevronLeft size={18} /></button>
      <div style={{ flex: 1 }}><strong id="contract-sign-title">Documento clínico</strong><div className="page-sub">{patient.name}</div></div>
      {prepared && <span className="contract-status-badge contract-status-badge--ready"><FileCheck2 size={12} /> Conteúdo congelado</span>}
    </header>

    {loading ? <div className="full-loader">Carregando documento...</div> : <main className="contract-signature-main">
      <section className="contract-document-pane">
        <article className="contract-document-paper">
          {prepared ? <>
            <h2>{prepared.document_name}</h2>
            <div className="contract-document-meta"><span>Paciente: {prepared.patient_snapshot.name}</span><span>Preparado: {new Date(prepared.ready_at).toLocaleString('pt-BR')}</span></div>
            <div className="contract-document-body">{prepared.rendered_content}</div>
            <div className="contract-integrity" style={{ marginTop: 24 }}><ShieldCheck size={12} style={{ verticalAlign: 'middle' }} /> SHA-256 do conteúdo: {prepared.content_sha256}</div>
          </> : <>
            <h2>{selectedTemplate?.name ?? 'Prepare o documento'}</h2>
            <div className="contract-document-meta">A revisão exata aparece aqui depois de congelar os dados.</div>
            <div className="contract-document-body">{selectedTemplate?.body ?? 'Não há modelo ativo. Feche esta tela e crie um modelo em “Modelos e dados profissionais”.'}</div>
          </>}
        </article>
      </section>

      <aside className="contract-sign-pane">
        {!prepared ? <div className="contract-setup">
          <div><strong>1. Escolha o modelo</strong><div className="page-sub">O conteúdo jurídico/clínico vem somente dos modelos cadastrados.</div></div>
          <select className="field-input" value={selectedTemplateId} onChange={e => changeTemplate(e.target.value)} disabled={templates.length === 0}>
            {templates.length === 0 && <option value="">Nenhum modelo ativo</option>}
            {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <div><strong>2. Contexto</strong><div className="page-sub">Se o modelo usa serviço/valor/data, selecione o atendimento ou agendamento correspondente.</div></div>
          <select className="field-input" value={selectedContextKey} onChange={e => changeContext(e.target.value)}>
            {contexts.map(option => <option key={option.key} value={contextValue(option)}>{option.label} — {option.detail}</option>)}
          </select>
          <button className="btn btn--primary btn--md" onClick={() => void handlePrepare()} disabled={preparing || !selectedTemplateId}>{preparing ? 'Congelando dados...' : 'Preparar para assinatura'}</button>
          <button className="btn btn--ghost btn--md" onClick={onClose}>Cancelar</button>
        </div> : <>
          <div><strong>3. Assinatura</strong><div className="page-sub">Revise o documento ao lado e assine abaixo com o dedo ou Apple Pencil.</div></div>
          <div ref={canvasBoxRef} className="contract-signature-box">
            <SignatureCanvas ref={sigRef} backgroundColor="white" penColor="#1a1a2e" canvasProps={{ 'aria-label': 'Área de assinatura' }} />
          </div>
          <div className="contract-signature-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => void handleClear()} disabled={saving}><RotateCcw size={14} /> Limpar assinatura</button>
          </div>
          <div className="page-sub">A assinatura não finaliza automaticamente. O PDF e os hashes só são consolidados após a confirmação abaixo.</div>
          <button className="btn btn--primary btn--md" onClick={() => void handleFinalize()} disabled={saving}><Check size={16} /> {saving ? 'Validando artefatos...' : 'Confirmar assinatura'}</button>
          <button className="btn btn--ghost btn--md" onClick={() => void handleCancel()} disabled={saving}>Cancelar documento</button>
        </>}
      </aside>
    </main>}
  </div>;
}
