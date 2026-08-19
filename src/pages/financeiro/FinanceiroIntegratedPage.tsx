import { useState } from 'react';
import { FinanceiroPage } from './FinanceiroPage';
import { PackageFinancePanel } from './PackageFinancePanel';
import { ServiceFinancialPage } from './ServiceFinancialPage';

export function FinanceiroIntegratedPage() {
  const [tab, setTab] = useState<'overview' | 'services'>('overview');

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, padding: 4, width: 'fit-content', maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)' }} role="tablist" aria-label="Financeiro">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          onClick={() => setTab('overview')}
          style={{ border: 0, borderRadius: 9, padding: '8px 13px', cursor: 'pointer', font: 'inherit', fontSize: '0.82rem', fontWeight: 600, background: tab === 'overview' ? 'var(--bg)' : 'transparent', color: tab === 'overview' ? 'var(--text)' : 'var(--text-3)', boxShadow: tab === 'overview' ? '0 1px 3px rgba(15, 23, 42, .08)' : 'none' }}
        >
          Visão geral
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'services'}
          onClick={() => setTab('services')}
          style={{ border: 0, borderRadius: 9, padding: '8px 13px', cursor: 'pointer', font: 'inherit', fontSize: '0.82rem', fontWeight: 600, background: tab === 'services' ? 'var(--bg)' : 'transparent', color: tab === 'services' ? 'var(--text)' : 'var(--text-3)', boxShadow: tab === 'services' ? '0 1px 3px rgba(15, 23, 42, .08)' : 'none' }}
        >
          Por serviço
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          <FinanceiroPage />
          <PackageFinancePanel />
        </>
      ) : <ServiceFinancialPage />}
    </>
  );
}
