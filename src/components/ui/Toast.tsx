import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastApi {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
  };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
}

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<ToastType, { bg: string; border: string; color: string }> = {
  success: { bg: '#f0fdf4', border: '#bbf7d0', color: 'var(--green)' },
  error: { bg: '#fef2f2', border: '#fecaca', color: 'var(--red)' },
  warning: { bg: '#fffbf0', border: '#fde68a', color: 'var(--amber)' },
  info: { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const dismiss = useCallback((id: string) => {
    setItems(current => current.filter(item => item.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    setItems(current => [...current, { id, type, message }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  const confirm = useCallback((options: ConfirmOptions) => (
    new Promise<boolean>(resolve => setConfirmState({ ...options, resolve }))
  ), []);

  const api = useMemo<ToastApi>(() => ({
    toast: {
      success: message => push('success', message),
      error: message => push('error', message),
      warning: message => push('warning', message),
      info: message => push('info', message),
    },
    confirm,
  }), [confirm, push]);

  const settleConfirm = (value: boolean) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'calc(var(--tab-h) + 16px)',
          zIndex: 500,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: 'min(360px, calc(100vw - 32px))',
        }}
      >
        {items.map(item => {
          const Icon = ICONS[item.type];
          const color = COLORS[item.type];
          return (
            <div
              key={item.id}
              role="status"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 'var(--radius)',
                background: color.bg,
                border: `1px solid ${color.border}`,
                color: 'var(--text)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
              }}
            >
              <Icon size={18} style={{ color: color.color, flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, fontSize: '0.88rem', lineHeight: 1.45 }}>{item.message}</div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Fechar notificação"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 0 }}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        tone={confirmState?.tone}
        onConfirm={() => settleConfirm(true)}
        onCancel={() => settleConfirm(false)}
      />
    </ToastContext.Provider>
  );
}
