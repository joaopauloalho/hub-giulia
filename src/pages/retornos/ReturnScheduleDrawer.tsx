import { X } from 'lucide-react';
import { formatClinicDate } from '../../lib/returnStatus';
import type { RetornoInfo } from '../../hooks/useRetornos';

export function ReturnScheduleDrawer({
  item,
  date,
  time,
  saving,
  onDate,
  onTime,
  onSave,
  onClose,
}: {
  item: RetornoInfo;
  date: string;
  time: string;
  saving: boolean;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="drawer-overlay" onClick={() => !saving && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="return-schedule-title" onClick={event => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2 className="drawer-title" id="return-schedule-title">Agendar retorno</h2>
            <p className="page-sub">{item.patientName} · {item.serviceName}</p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={saving} aria-label="Fechar"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label className="field-label">Data</label><input className="field-input" type="date" value={date} onChange={e => onDate(e.target.value)} /></div>
            <div><label className="field-label">Horário</label><input className="field-input" type="time" value={time} onChange={e => onTime(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: '14px', background: 'var(--bg-2)', padding: '12px', borderRadius: 'var(--radius)' }}>
            <div className="page-sub">Janela recomendada</div>
            <strong>{formatClinicDate(item.windowStartIso)} a {formatClinicDate(item.windowEndIso)}</strong>
          </div>
        </div>
        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Agendando...' : 'Criar agendamento'}</button>
        </div>
      </div>
    </div>
  );
}
