import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ANAMNESIS_AUTOSAVE_MS,
  ANAMNESIS_FORM_SCHEMA_VERSION,
  clearAnamnesisRecovery,
  currentRowToDraft,
  draftToRpcAnswers,
  emptyAnamnesisDraft,
  hasUnsyncedAnamnesis,
  isAnamnesisConflict,
  isAnamnesisSessionError,
  loadAnamnesisRecovery,
  saveAnamnesisRecovery,
  type AnamnesisCurrentRow,
  type AnamnesisDraft,
  type AnamnesisSaveStatus,
} from '../lib/anamnesisV2';

type SaveQueueItem = {
  draft: AnamnesisDraft;
  sequence: number;
};

type SaveRpcRow = {
  id: string;
  draft_revision: number;
  last_saved_at: string;
  status: 'draft' | 'completed';
  latest_version_number: number;
  updated_at: string;
};

type FinalizeRpcRow = {
  version_id: string;
  version_number: number;
  completed_at: string;
  draft_revision: number;
};

function friendlySaveError(error: unknown) {
  if (isAnamnesisConflict(error)) return 'A anamnese foi alterada em outro dispositivo.';
  if (isAnamnesisSessionError(error)) return 'Sua sessão expirou. Entre novamente para salvar.';
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Sem conexão — alterações aguardando sincronização.';
  return 'Não foi possível salvar as últimas alterações.';
}

export function useAnamneseDraftV2(patientId: string) {
  const [draft, setDraftState] = useState<AnamnesisDraft>(() => emptyAnamnesisDraft());
  const [current, setCurrent] = useState<AnamnesisCurrentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AnamnesisSaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [localSequence, setLocalSequence] = useState(0);
  const [finalizing, setFinalizing] = useState(false);

  const draftRef = useRef(draft);
  const currentRef = useRef<AnamnesisCurrentRow | null>(null);
  const userIdRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const sequenceRef = useRef(0);
  const syncedSequenceRef = useRef(0);
  const pendingRef = useRef<SaveQueueItem | null>(null);
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  const finalizeKeyRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  const applyServerRow = useCallback((row: AnamnesisCurrentRow | null) => {
    currentRef.current = row;
    setCurrent(row);
    revisionRef.current = row?.draft_revision ?? 0;
  }, []);

  const load = useCallback(async (preferRecovery = true) => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('ANAMNESIS_SESSION_REQUIRED');
      userIdRef.current = authData.user.id;

      const { data, error } = await supabase
        .from('anamnesis')
        .select('*')
        .eq('patient_id', patientId)
        .maybeSingle();
      if (error) throw error;

      const row = (data ?? null) as AnamnesisCurrentRow | null;
      applyServerRow(row);

      const recovery = preferRecovery
        ? await loadAnamnesisRecovery(authData.user.id, patientId)
        : null;

      if (recovery) {
        draftRef.current = recovery.draft;
        setDraftState(recovery.draft);
        revisionRef.current = recovery.baseRevision;
        sequenceRef.current = 1;
        syncedSequenceRef.current = 0;
        setLocalSequence(1);
        setSaveStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'pending');
        setSaveMessage('Alterações locais não sincronizadas foram recuperadas.');
      } else {
        const next = currentRowToDraft(row);
        draftRef.current = next;
        setDraftState(next);
        sequenceRef.current = 0;
        syncedSequenceRef.current = 0;
        setLocalSequence(0);
        setSaveStatus(row?.last_saved_at ? 'saved' : 'idle');
        setSaveMessage(null);
      }
      loadedRef.current = true;
    } catch (error) {
      setLoadError(isAnamnesisSessionError(error)
        ? 'Sua sessão expirou. Entre novamente.'
        : 'Não foi possível carregar a anamnese.');
    } finally {
      setLoading(false);
    }
  }, [applyServerRow, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setDraft = useCallback((updater: (currentDraft: AnamnesisDraft) => AnamnesisDraft) => {
    const next = updater(draftRef.current);
    draftRef.current = next;
    setDraftState(next);

    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setLocalSequence(sequence);

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    setSaveStatus(offline ? 'offline' : 'pending');
    setSaveMessage(offline ? 'Sem conexão — suas alterações ainda não foram sincronizadas.' : null);

    const userId = userIdRef.current;
    if (userId) {
      void saveAnamnesisRecovery(userId, patientId, next, revisionRef.current);
    }
  }, [patientId]);

  const runDrain = useCallback(() => {
    if (drainPromiseRef.current) return drainPromiseRef.current;

    drainPromiseRef.current = (async () => {
      while (pendingRef.current) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSaveStatus('offline');
          setSaveMessage('Sem conexão — suas alterações ainda não foram sincronizadas.');
          pendingRef.current = null;
          break;
        }

        const item = pendingRef.current;
        pendingRef.current = null;
        setSaveStatus('saving');
        setSaveMessage(null);

        const { data, error } = await supabase.rpc('save_anamnesis_draft_v2', {
          p_patient_id: patientId,
          p_expected_revision: revisionRef.current,
          p_answers: draftToRpcAnswers(item.draft),
          p_form_schema_version: ANAMNESIS_FORM_SCHEMA_VERSION,
        });

        if (error) {
          if (isAnamnesisConflict(error)) setSaveStatus('conflict');
          else if (isAnamnesisSessionError(error)) setSaveStatus('session-expired');
          else if (typeof navigator !== 'undefined' && !navigator.onLine) setSaveStatus('offline');
          else setSaveStatus('error');
          setSaveMessage(friendlySaveError(error));
          break;
        }

        const row = (data as SaveRpcRow[] | null)?.[0];
        if (!row) {
          setSaveStatus('error');
          setSaveMessage('O servidor não confirmou o salvamento.');
          break;
        }

        revisionRef.current = Number(row.draft_revision);
        syncedSequenceRef.current = Math.max(syncedSequenceRef.current, item.sequence);
        const base = currentRef.current ?? {
          id: row.id,
          patient_id: patientId,
          user_id: userIdRef.current ?? '',
          conditions: {},
          medications: null,
          medications_status: null,
          allergies: null,
          allergies_status: null,
          surgical_history: {},
          habits: {},
          aesthetics: {},
          created_at: row.updated_at,
          finalized_at: null,
          form_schema_version: ANAMNESIS_FORM_SCHEMA_VERSION,
          draft_revision: row.draft_revision,
          last_saved_at: row.last_saved_at,
          latest_version_number: row.latest_version_number,
          status: row.status,
          updated_at: row.updated_at,
        } satisfies AnamnesisCurrentRow;
        const next = {
          ...base,
          conditions: item.draft.conditions,
          medications: item.draft.medications || null,
          medications_status: item.draft.medicationsStatus,
          allergies: item.draft.allergies || null,
          allergies_status: item.draft.allergiesStatus,
          surgical_history: item.draft.surgicalHistory,
          habits: item.draft.habits,
          aesthetics: item.draft.aesthetics,
          form_schema_version: ANAMNESIS_FORM_SCHEMA_VERSION,
          draft_revision: Number(row.draft_revision),
          last_saved_at: row.last_saved_at,
          latest_version_number: Number(row.latest_version_number),
          status: row.status,
          updated_at: row.updated_at,
        };
        currentRef.current = next;
        setCurrent(next);

        if (sequenceRef.current > item.sequence) {
          pendingRef.current = { draft: draftRef.current, sequence: sequenceRef.current };
          continue;
        }

        const userId = userIdRef.current;
        if (userId) await clearAnamnesisRecovery(userId, patientId);
        setSaveStatus('saved');
        setSaveMessage(null);
      }
    })().finally(() => {
      drainPromiseRef.current = null;
    });

    return drainPromiseRef.current;
  }, [patientId]);

  const flush = useCallback(async () => {
    if (!loadedRef.current) return;
    if (sequenceRef.current <= syncedSequenceRef.current) return;
    if (saveStatus === 'conflict' || saveStatus === 'session-expired') return;

    pendingRef.current = {
      draft: draftRef.current,
      sequence: sequenceRef.current,
    };
    await runDrain();
  }, [runDrain, saveStatus]);

  useEffect(() => {
    if (!loadedRef.current || localSequence <= syncedSequenceRef.current) return;
    const timeout = window.setTimeout(() => { void flush(); }, ANAMNESIS_AUTOSAVE_MS);
    return () => window.clearTimeout(timeout);
  }, [flush, localSequence]);

  useEffect(() => {
    const online = () => {
      if (sequenceRef.current > syncedSequenceRef.current) {
        setSaveStatus('pending');
        setSaveMessage('Conexão restaurada — sincronizando alterações.');
        void flush();
      }
    };
    const offline = () => {
      if (sequenceRef.current > syncedSequenceRef.current) {
        setSaveStatus('offline');
        setSaveMessage('Sem conexão — suas alterações ainda não foram sincronizadas.');
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [flush]);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden' && sequenceRef.current > syncedSequenceRef.current) {
        void flush();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sequenceRef.current <= syncedSequenceRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const retry = useCallback(async () => {
    if (saveStatus === 'conflict') return;
    setSaveStatus('pending');
    setSaveMessage(null);
    await flush();
  }, [flush, saveStatus]);

  const reloadServer = useCallback(async () => {
    const userId = userIdRef.current;
    if (userId) await clearAnamnesisRecovery(userId, patientId);
    pendingRef.current = null;
    sequenceRef.current = 0;
    syncedSequenceRef.current = 0;
    setLocalSequence(0);
    await load(false);
  }, [load, patientId]);

  const hasPendingChanges = useCallback(
    () => sequenceRef.current > syncedSequenceRef.current,
    [],
  );

  const finalize = useCallback(async () => {
    setFinalizing(true);
    try {
      await flush();
      if (sequenceRef.current > syncedSequenceRef.current) {
        throw new Error(saveMessage ?? 'Existem alterações que ainda não foram salvas.');
      }

      const row = currentRef.current;
      if (!row || row.status !== 'draft') {
        throw new Error('Faça uma alteração antes de concluir uma nova versão.');
      }

      if (!finalizeKeyRef.current) finalizeKeyRef.current = crypto.randomUUID();
      const { data, error } = await supabase.rpc('finalize_anamnesis_v2', {
        p_patient_id: patientId,
        p_expected_revision: revisionRef.current,
        p_idempotency_key: finalizeKeyRef.current,
      });
      if (error) throw error;

      const result = (data as FinalizeRpcRow[] | null)?.[0];
      if (!result) throw new Error('O servidor não confirmou a conclusão.');

      revisionRef.current = Number(result.draft_revision);
      if (currentRef.current) {
        const next = {
          ...currentRef.current,
          status: 'completed' as const,
          finalized_at: result.completed_at,
          last_saved_at: result.completed_at,
          updated_at: result.completed_at,
          latest_version_number: Number(result.version_number),
          draft_revision: Number(result.draft_revision),
        };
        currentRef.current = next;
        setCurrent(next);
      }
      setSaveStatus('saved');
      setSaveMessage(null);
      finalizeKeyRef.current = null;
      const userId = userIdRef.current;
      if (userId) await clearAnamnesisRecovery(userId, patientId);
      return result;
    } catch (error) {
      if (isAnamnesisConflict(error)) {
        setSaveStatus('conflict');
        setSaveMessage('A anamnese foi alterada em outro dispositivo.');
      } else if (isAnamnesisSessionError(error)) {
        setSaveStatus('session-expired');
        setSaveMessage('Sua sessão expirou. Entre novamente para salvar.');
      }
      throw error;
    } finally {
      setFinalizing(false);
    }
  }, [flush, patientId, saveMessage]);

  return {
    draft,
    current,
    loading,
    loadError,
    saveStatus,
    saveMessage,
    finalizing,
    setDraft,
    flush,
    retry,
    reloadServer,
    finalize,
    hasPendingChanges,
    hasUnsynced: sequenceRef.current > syncedSequenceRef.current || hasUnsyncedAnamnesis(saveStatus),
  };
}
