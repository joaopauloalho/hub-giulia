import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, RotateCcw, Check } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { supabase } from '../../lib/supabase';
import type { Patient, ContractTemplate } from '../../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { interpolateContract } from '../../lib/contractUtils';
import { useToast } from '../../hooks/useToast';

interface Props {
  patient: Patient;
  onClose: () => void;
  onDone: () => void;
}

const pdfStyles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 11 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 4, color: '#be185d' },
  sub: { fontSize: 10, color: '#666', marginBottom: 20 },
  body: { lineHeight: 1.6, marginBottom: 24 },
  sigSection: { borderTop: '1px solid #eee', paddingTop: 16, marginTop: 8 },
  sigLabel: { fontSize: 9, color: '#888', marginBottom: 6 },
  sigImg: { width: 200, height: 80, objectFit: 'contain' },
  sigName: { fontSize: 10, marginTop: 8, borderTop: '1px solid #000', paddingTop: 4, width: 200 },
});

function ContractPDF({ patient, template, signatureDataUrl, date, body }: {
  patient: Patient;
  template: ContractTemplate | null;
  signatureDataUrl: string;
  date: string;
  body: string;
}) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <Text style={pdfStyles.title}>{template?.name ?? 'Contrato'}</Text>
        <Text style={pdfStyles.sub}>
          Paciente: {patient.name} — Data: {date}
        </Text>
        <Text style={pdfStyles.body}>{body}</Text>
        <View style={pdfStyles.sigSection}>
          <Text style={pdfStyles.sigLabel}>Assinatura da paciente:</Text>
          <Image style={pdfStyles.sigImg} src={signatureDataUrl} />
          <Text style={pdfStyles.sigName}>{patient.name}</Text>
        </View>
      </Page>
    </Document>
  );
}

export function SignatureScreen({ patient, onClose, onDone }: Props) {
  const sigRef = useRef<SignatureCanvas>(null);
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [professional, setProfessional] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setProfessional(user.email ?? 'Profissional');
      supabase
        .from('contract_templates')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at')
        .then(({ data }) => {
          if (data?.length) {
            setTemplates(data as ContractTemplate[]);
            setSelectedTemplate(data[0] as ContractTemplate);
          }
        });
    });
  }, []);

  const handleSave = async () => {
    if (sigRef.current?.isEmpty()) {
      toast.error('Por favor, assine antes de continuar.');
      return;
    }
    setSaving(true);
    let contractId: string | null = null;
    let pdfPath: string | null = null;

    try {
      const signatureDataUrl = sigRef.current!.toDataURL('image/png');
      const now = new Date();
      const dateStr = format(now, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
      const contractBody = interpolateContract(
        selectedTemplate?.body ?? 'Termo de responsabilidade e consentimento para realização de procedimentos estéticos.',
        {
          nome: patient.name,
          data: format(now, 'dd/MM/yyyy'),
          servico: 'Servico estetico',
          valor: '',
          profissional: professional,
          cpf: patient.cpf ?? '',
        },
      );

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario nao autenticado.');

      const { data: inserted, error: insertErr } = await supabase
        .from('contracts')
        .insert({
          patient_id: patient.id,
          user_id: user.id,
          template_id: selectedTemplate?.id ?? null,
          signature_data: signatureDataUrl,
          pdf_url: null,
          signed_at: now.toISOString(),
        })
        .select('id')
        .single();
      if (insertErr) throw insertErr;

      contractId = (inserted as { id: string }).id;

      const pdfBlob = await pdf(
        <ContractPDF
          patient={patient}
          template={selectedTemplate}
          signatureDataUrl={signatureDataUrl}
          date={dateStr}
          body={contractBody}
        />
      ).toBlob();

      pdfPath = `${user.id}/${patient.id}/${contractId}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from('contracts')
        .upload(pdfPath, pdfBlob, { contentType: 'application/pdf', upsert: true });
      if (uploadErr) throw uploadErr;

      const { error: updateErr } = await supabase.from('contracts').update({ pdf_url: pdfPath }).eq('id', contractId);
      if (updateErr) throw updateErr;

      onDone();
    } catch (err) {
      await Promise.allSettled([
        pdfPath ? supabase.storage.from('contracts').remove([pdfPath]) : Promise.resolve(),
        contractId ? supabase.from('contracts').delete().eq('id', contractId) : Promise.resolve(),
      ]);
      console.error(err);
      toast.error('Erro ao salvar contrato. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const previewBody = interpolateContract(selectedTemplate?.body ?? '', {
    nome: patient.name,
    data: format(new Date(), 'dd/MM/yyyy'),
    servico: 'Servico estetico',
    valor: '',
    profissional: professional,
    cpf: patient.cpf ?? '',
  });

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="signature-title" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <button className="drawer-back" onClick={onClose} aria-label="Fechar assinatura">
            <ChevronLeft size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div className="drawer-title" id="signature-title">Assinar Contrato</div>
            <div className="drawer-sub">{patient.name}</div>
          </div>
        </div>

        <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Template selector */}
          {templates.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <label className="field-label">Modelo de contrato</label>
              <select
                className="field-input"
                value={selectedTemplate?.id ?? ''}
                onChange={e => setSelectedTemplate(templates.find(t => t.id === e.target.value) ?? null)}
              >
                <option value="">Sem modelo</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Contract preview */}
          {selectedTemplate && (
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              maxHeight: 180,
              overflowY: 'auto',
              background: 'var(--bg-2)',
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)', marginBottom: 6 }}>
                {selectedTemplate.name}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {previewBody}
              </div>
            </div>
          )}

          {/* Signature canvas */}
          <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-2)', marginBottom: 10 }}>
              Assine abaixo com o dedo:
            </div>
            <div style={{
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: '#fff',
              overflow: 'hidden',
              flex: 1,
              minHeight: 200,
              position: 'relative',
            }}>
              <SignatureCanvas
                ref={sigRef}
                canvasProps={{
                  style: { width: '100%', height: '100%', position: 'absolute', inset: 0 },
                }}
                backgroundColor="white"
                penColor="#1a1a2e"
              />
            </div>
            <button
              className="btn btn--ghost btn--sm"
              style={{ marginTop: 8, alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => sigRef.current?.clear()}
            >
              <RotateCcw size={13} /> Limpar
            </button>
          </div>

          {/* Footer actions */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 10,
          }}>
            <button className="btn btn--ghost btn--md" style={{ flex: 1 }} onClick={onClose}>
              Cancelar
            </button>
            <button
              className="btn btn--primary btn--md"
              style={{ flex: 2 }}
              onClick={handleSave}
              disabled={saving}
            >
              <Check size={16} />{saving ? 'Salvando...' : 'Assinar e salvar'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
