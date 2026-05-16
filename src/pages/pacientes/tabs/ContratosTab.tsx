import { useEffect } from 'react';
import { FileText, PenLine, Download } from 'lucide-react';
import { useContracts } from '../../../hooks/useContracts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Props {
  patientId: string;
  onSignNew: () => void;
}

export function ContratosTab({ patientId, onSignNew }: Props) {
  const { contracts, loading, error, load } = useContracts(patientId);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso: string) => {
    try { return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
    catch { return iso; }
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn--secondary btn--sm" onClick={onSignNew}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PenLine size={14} /> Novo contrato
        </button>
      </div>

      {error ? (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="loading-state">Carregando contratos...</div>
      ) : contracts.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <FileText size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
          <p>Nenhum contrato assinado ainda.</p>
          <button className="btn btn--primary btn--sm" onClick={onSignNew}>
            <PenLine size={14} /> Assinar primeiro contrato
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {contracts.map(c => (
            <div key={c.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              background: 'var(--bg-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <FileText size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
                  {c.template?.name ?? 'Contrato sem modelo'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 2 }}>
                  Assinado em {fmtDate(c.signed_at)}
                </div>
              </div>
              {c.pdf_url && (
                <a href={c.pdf_url} target="_blank" rel="noopener noreferrer"
                  aria-label="Abrir contrato assinado"
                  style={{ color: 'var(--primary)', flexShrink: 0 }}>
                  <Download size={18} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
