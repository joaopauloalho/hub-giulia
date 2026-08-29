import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './MedicationAutocomplete.css';

type MedicationSuggestion = {
  source_key: string;
  registration_number: string | null;
  product_name: string;
  active_ingredient: string | null;
  company_name: string | null;
  category: string | null;
  therapeutic_class: string | null;
};

type MedicationAutocompleteProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

const CATALOG_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function suggestionLabel(suggestion: MedicationSuggestion) {
  const product = suggestion.product_name.trim();
  const ingredient = suggestion.active_ingredient?.trim();
  if (!ingredient || normalized(ingredient) === normalized(product)) return product;
  return `${product} — ${ingredient}`;
}

export function MedicationAutocomplete({ id, value, onChange }: MedicationAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MedicationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [catalogAvailable, setCatalogAvailable] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const refreshCatalogIfNeeded = async () => {
      const { data, error } = await supabase
        .from('medication_catalog_sync_status')
        .select('last_success_at')
        .eq('id', 1)
        .maybeSingle();

      if (cancelled || error) return;
      const lastSuccessAt = data?.last_success_at ? new Date(String(data.last_success_at)).getTime() : 0;
      if (lastSuccessAt && Date.now() - lastSuccessAt < CATALOG_REFRESH_MS) return;

      // Refresh is deliberately best-effort. The existing catalog and the manual
      // textarea remain usable if ANVISA or the sync function is unavailable.
      void supabase.functions.invoke('sync-anvisa-medications', { body: {} });
    };

    void refreshCatalogIfNeeded();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const term = query.trim();
    setActiveIndex(-1);
    if (term.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void supabase
        .rpc('search_medication_catalog_v1', { p_query: term, p_limit: 12 })
        .then(({ data, error }) => {
          if (requestId !== requestIdRef.current) return;
          if (error) {
            setSuggestions([]);
            setCatalogAvailable(false);
            return;
          }
          setSuggestions((data ?? []) as MedicationSuggestion[]);
          setCatalogAvailable(true);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query]);

  const existingLines = useMemo(
    () => new Set(value.split('\n').map(line => normalized(line)).filter(Boolean)),
    [value],
  );

  const choose = (suggestion: MedicationSuggestion) => {
    const label = suggestionLabel(suggestion);
    if (!existingLines.has(normalized(label))) {
      const next = value.trim() ? `${value.trimEnd()}\n${label}` : label;
      onChange(next);
    }
    setQuery('');
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choose(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setSuggestions([]);
      setActiveIndex(-1);
    }
  };

  const showDropdown = query.trim().length >= 3 && (loading || suggestions.length > 0 || !catalogAvailable);

  return (
    <div className="medication-autocomplete">
      <div className="medication-autocomplete__search-wrap">
        <Search size={17} aria-hidden="true" />
        <input
          className="field-input medication-autocomplete__search"
          type="search"
          value={query}
          placeholder="Buscar por nome ou princípio ativo na ANVISA"
          autoComplete="off"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Buscar medicamento na base da ANVISA"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
        />
        {loading && <Loader2 className="medication-autocomplete__loader" size={17} aria-label="Buscando" />}
      </div>

      {showDropdown && (
        <div className="medication-autocomplete__dropdown" role="listbox" aria-label="Sugestões de medicamentos">
          {!catalogAvailable ? (
            <div className="medication-autocomplete__state">A busca oficial está indisponível agora. Você ainda pode escrever o medicamento manualmente abaixo.</div>
          ) : suggestions.length ? (
            suggestions.map((suggestion, index) => {
              const label = suggestionLabel(suggestion);
              const alreadyAdded = existingLines.has(normalized(label));
              return (
                <button
                  key={suggestion.source_key}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`medication-autocomplete__option${index === activeIndex ? ' is-active' : ''}`}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => choose(suggestion)}
                >
                  <span className="medication-autocomplete__option-main">
                    <strong>{suggestion.product_name}</strong>
                    {suggestion.active_ingredient && <small>Princípio ativo: {suggestion.active_ingredient}</small>}
                    <small>{[suggestion.company_name, suggestion.category].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="medication-autocomplete__option-meta">
                    {alreadyAdded ? <><Check size={14} /> Adicionado</> : suggestion.registration_number ? `ANVISA ${suggestion.registration_number}` : 'ANVISA'}
                  </span>
                </button>
              );
            })
          ) : !loading ? (
            <div className="medication-autocomplete__state">Nenhum medicamento encontrado para “{query.trim()}”. Confira a escrita ou preencha manualmente.</div>
          ) : null}
          <div className="medication-autocomplete__source">Fonte de referência: dados abertos da ANVISA. Confirme dose, via e posologia clinicamente.</div>
        </div>
      )}

      <label className="field-label" htmlFor={id}>Medicamentos em uso / observações</label>
      <textarea
        id={id}
        data-focus-target
        className="field-input"
        rows={4}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Selecione acima ou escreva manualmente. Você pode complementar com dose, frequência e outras observações."
      />
      <small className="medication-autocomplete__help">Digite pelo menos 3 letras para buscar. A seleção apenas padroniza o nome; a decisão clínica continua sendo da profissional.</small>
    </div>
  );
}
