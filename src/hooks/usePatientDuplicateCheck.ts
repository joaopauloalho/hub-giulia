import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  duplicateSearchKeys,
  duplicateWarningSignature,
  findPatientDuplicates,
  hasDuplicateSearch,
  sortDuplicateMatches,
  type DuplicateMatch,
  type DuplicatePatientRecord,
  type DuplicateSearchInput,
} from '../lib/patientDuplicates';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const VISIBLE_LIMIT = 5;
const DEBOUNCE_MS = 400;

export interface PatientDuplicateMatch extends DuplicateMatch {
  last_attendance_at: string | null;
}

export interface PatientDuplicateCheck {
  signature: string | null;
  unavailable: boolean;
}

type PatientDuplicateRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  archived_at: string | null;
};

const emptyInput: DuplicateSearchInput = { name: null, phone: null, cpf: null, email: null };

async function loadPatientCatalog(): Promise<DuplicatePatientRecord[]> {
  const rows: DuplicatePatientRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    // RLS patients_own already limits the rows to the signed-in clinic.
    const { data, error } = await supabase
      .from('patients')
      .select('id,name,phone,email,cpf,archived_at')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as PatientDuplicateRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadLastAttendances(ids: string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(ids.map(async id => {
    const { data, error } = await supabase
      .from('procedures')
      .select('performed_at')
      .eq('patient_id', id)
      .order('performed_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const performedAt = (data?.[0] as { performed_at?: string } | undefined)?.performed_at;
    return performedAt ? [id, performedAt] as const : null;
  }));
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

export function usePatientDuplicateCheck(input: DuplicateSearchInput, enabled: boolean) {
  const [catalog, setCatalog] = useState<DuplicatePatientRecord[] | null>(null);
  const [query, setQuery] = useState<DuplicateSearchInput>(emptyInput);
  const [attendance, setAttendance] = useState<Map<string, string>>(() => new Map());
  const catalogRef = useRef<DuplicatePatientRecord[] | null>(null);
  const failedRef = useRef(false);
  const inflightRef = useRef<Promise<DuplicatePatientRecord[]> | null>(null);
  const sessionRef = useRef(0);
  const debounceRef = useRef(0);
  const name = input.name ?? null;
  const phone = input.phone ?? null;
  const cpf = input.cpf ?? null;
  const email = input.email ?? null;

  const ensureCatalog = useCallback(async (): Promise<{ rows: DuplicatePatientRecord[]; unavailable: boolean }> => {
    if (catalogRef.current) return { rows: catalogRef.current, unavailable: false };
    if (failedRef.current) return { rows: [], unavailable: true };
    const session = sessionRef.current;
    if (!inflightRef.current) {
      const request = loadPatientCatalog()
        .then(rows => {
          if (session === sessionRef.current) {
            catalogRef.current = rows;
            setCatalog(rows);
          }
          return rows;
        })
        .catch(error => {
          console.error('[patient-duplicates]', error);
          if (session === sessionRef.current) failedRef.current = true;
          throw error;
        })
        .finally(() => {
          if (inflightRef.current === request) inflightRef.current = null;
        });
      inflightRef.current = request;
    }
    try {
      const rows = await inflightRef.current;
      return { rows: catalogRef.current ?? rows, unavailable: false };
    } catch {
      return { rows: [], unavailable: true };
    }
  }, []);

  useEffect(() => {
    if (enabled) return;
    sessionRef.current += 1;
    catalogRef.current = null;
    failedRef.current = false;
    inflightRef.current = null;
    debounceRef.current += 1;
    setCatalog(null);
    setQuery(emptyInput);
    setAttendance(new Map());
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const generation = ++debounceRef.current;
    const timeout = window.setTimeout(() => {
      if (generation === debounceRef.current) setQuery({ name, phone, cpf, email });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [cpf, email, enabled, name, phone]);

  useEffect(() => {
    if (!enabled || !hasDuplicateSearch(duplicateSearchKeys(query))) return;
    void ensureCatalog();
  }, [enabled, ensureCatalog, query]);

  const evaluated = useMemo(() => {
    if (!catalog) return [];
    return sortDuplicateMatches(findPatientDuplicates(catalog, query));
  }, [catalog, query]);

  const matchIds = evaluated.slice(0, VISIBLE_LIMIT).map(match => match.id).join('|');

  useEffect(() => {
    const ids = matchIds ? matchIds.split('|') : [];
    if (!enabled || ids.length === 0) return;
    let active = true;
    void loadLastAttendances(ids).then(map => {
      if (!active) return;
      setAttendance(current => {
        const next = new Map(current);
        map.forEach((value, key) => next.set(key, value));
        return next;
      });
    }).catch(error => {
      console.error('[patient-duplicates:attendance]', error);
    });
    return () => { active = false; };
  }, [enabled, matchIds]);

  const matches: PatientDuplicateMatch[] = evaluated.slice(0, VISIBLE_LIMIT).map(match => ({
    ...match,
    last_attendance_at: attendance.get(match.id) ?? null,
  }));
  const signature = duplicateWarningSignature(query, evaluated);

  const checkNow = useCallback(async (current: DuplicateSearchInput): Promise<PatientDuplicateCheck> => {
    debounceRef.current += 1;
    setQuery(current);
    const { rows, unavailable } = await ensureCatalog();
    if (unavailable) return { signature: null, unavailable: true };
    const found = sortDuplicateMatches(findPatientDuplicates(rows, current));
    return { signature: duplicateWarningSignature(current, found), unavailable: false };
  }, [ensureCatalog]);

  return {
    matches,
    extraCount: Math.max(0, evaluated.length - VISIBLE_LIMIT),
    signature,
    checkNow,
  };
}
