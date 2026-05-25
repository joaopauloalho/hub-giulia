import { X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  const isDanger = tone === 'danger';
  const confirmClass = isDanger ? 'btn btn--danger btn--md' : 'btn btn--primary btn--md';

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
        style={{ maxWidth: 420, alignSelf: 'center', borderRadius: 'var(--radius-lg)' }}
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="confirm-modal-title">{title}</h2>
          <button className="modal-close" type="button" onClick={onCancel} aria-label="Fechar confirmação">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body" id="confirm-modal-message" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
          {message}
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost btn--md w-full" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={confirmClass} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
