import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  globalSearchTypeLabel,
  isEditableKeyboardTarget,
  normalizeGlobalSearchQuery,
  shouldRunGlobalSearch,
  type HubSearchResult,
} from '../../lib/globalSearch';

export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HubSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = useMemo(() => normalizeGlobalSearchQuery(query), [query]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const shortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!shortcut && !(slash && !isEditableKeyboardTarget(event.target))) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !shouldRunGlobalSearch(normalized)) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      if (!navigator.onLine) {
        setResults([]);
        setLoading(false);
        setError('Sem conexão. A busca precisa acessar os dados atuais da clínica.');
        return;
      }
      setLoading(true);
      setError(null);
      void supabase.rpc('search_hub_v1', { p_query: normalized, p_limit: 12 }).then(({ data, error: searchError }) => {
        if (!active) return;
        if (searchError) {
          console.error('[global-search]', searchError);
          setResults([]);
          setError('Não foi possível buscar agora. Tente novamente.');
        } else {
          setResults((data ?? []) as HubSearchResult[]);
        }
        setLoading(false);
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [normalized, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setError(null);
  };

  const openResult = (result: HubSearchResult) => {
    close();
    navigate(result.route);
  };

  return (
    <>
      <button type="button" className="hub-global-search-trigger" onClick={() => setOpen(true)} aria-label="Buscar no Hub">
        <Search size={17} />
        <span>Buscar</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="hub-command-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}>
          <section className="hub-command" role="dialog" aria-modal="true" aria-label="Busca global">
            <div className="hub-command-input-row">
              <Search size={19} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Paciente ou lead por nome, telefone ou email"
                aria-label="Buscar paciente ou lead"
              />
              <button type="button" className="icon-btn" onClick={close} aria-label="Fechar busca"><X size={18} /></button>
            </div>
            <div className="hub-command-results" aria-live="polite">
              {!normalized && <div className="hub-command-hint">Digite para localizar pacientes e contatos do CRM. A busca não pesquisa prontuário, anamnese, contratos ou dados financeiros.</div>}
              {normalized && normalized.length < 2 && <div className="hub-command-hint">Digite pelo menos 2 caracteres.</div>}
              {loading && <div className="hub-command-hint">Buscando…</div>}
              {error && <div className="hub-command-error">{error}</div>}
              {!loading && !error && shouldRunGlobalSearch(normalized) && results.length === 0 && <div className="hub-command-hint">Nenhum resultado encontrado.</div>}
              {results.map(result => (
                <button type="button" className="hub-command-result" key={`${result.result_type}:${result.result_id}`} onClick={() => openResult(result)}>
                  <span className="hub-command-avatar">{result.name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
                  <span className="hub-command-result-body">
                    <strong>{result.name}</strong>
                    <small>{result.subtitle}</small>
                  </span>
                  <span className="badge badge--rose">{globalSearchTypeLabel(result.result_type)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
