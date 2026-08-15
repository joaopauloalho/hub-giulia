import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  prepareClinicalPhoto,
  photoStoragePaths,
  type ClinicalPhotoSource,
  type PhotoAngle,
  type PhotoCaptureSet,
  type PhotoPose,
  type PhotoSessionType,
} from '../lib/clinicalPhotos';

const PHOTO_BUCKET = 'patient-photos';
const SESSION_PAGE_SIZE = 20;
const SIGNED_THUMB_TTL = 600;
const SIGNED_VIEW_TTL = 300;

type SignedVariant = 'thumbnail' | 'preview' | 'original';

export interface PatientPhoto {
  id: string;
  patient_id: string;
  user_id?: string;
  photo_session_id: string | null;
  procedure_id: string | null;
  appointment_id: string | null;
  service_id: string | null;
  photo_url: string;
  photo_type: 'before' | 'after' | 'general';
  label: string | null;
  caption: string | null;
  angle: PhotoAngle | null;
  region: string | null;
  pose: PhotoPose | null;
  taken_at: string;
  original_path: string | null;
  preview_path: string | null;
  thumbnail_path: string | null;
  mime_type: 'image/jpeg' | 'image/png' | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  sha256: string | null;
  source_type: 'legacy' | ClinicalPhotoSource;
  thumbnail_url?: string | null;
}

export interface PatientPhotoSession {
  session_id: string;
  patient_id: string;
  appointment_id: string | null;
  procedure_id: string | null;
  service_id: string | null;
  service_name: string | null;
  session_type: PhotoSessionType;
  capture_set: PhotoCaptureSet;
  title: string | null;
  captured_at: string;
  notes: string | null;
  photo_count: number;
  photos: PatientPhoto[];
}

export interface PhotoSessionFilters {
  serviceId?: string | null;
  sessionType?: PhotoSessionType | '';
  from?: string;
  to?: string;
}

export interface AttendancePhotoContext {
  appointmentId: string;
  patientId: string;
  patientName: string;
  serviceId: string | null;
  serviceName: string | null;
  procedureId: string | null;
}

export interface CreatePhotoSessionInput {
  appointmentId?: string | null;
  procedureId?: string | null;
  serviceId?: string | null;
  sessionType: PhotoSessionType;
  captureSet: PhotoCaptureSet;
  title?: string | null;
  notes?: string | null;
}

export interface UploadClinicalPhotoInput {
  session: PatientPhotoSession;
  file: File;
  angle: PhotoAngle | null;
  sourceType: ClinicalPhotoSource;
  uploadId: string;
  region?: string | null;
  pose?: PhotoPose | null;
  caption?: string | null;
}

interface SignedCacheEntry {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, SignedCacheEntry>();

function cacheKey(path: string) {
  return `${PHOTO_BUCKET}:${path}`;
}

function getPhotoPath(photo: PatientPhoto, variant: SignedVariant) {
  if (variant === 'thumbnail') return photo.thumbnail_path ?? photo.preview_path ?? photo.original_path ?? photo.photo_url;
  if (variant === 'preview') return photo.preview_path ?? photo.original_path ?? photo.photo_url;
  return photo.original_path ?? photo.photo_url;
}

async function signStoragePaths(paths: readonly string[], expiresIn: number) {
  const unique = [...new Set(paths.filter(Boolean))];
  const output = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];

  for (const path of unique) {
    const cached = signedUrlCache.get(cacheKey(path));
    if (cached && cached.expiresAt > now + 30_000) output.set(path, cached.url);
    else missing.push(path);
  }

  for (let start = 0; start < missing.length; start += 50) {
    const chunk = missing.slice(start, start + 50);
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(chunk, expiresIn);
    if (error) throw error;
    for (let index = 0; index < chunk.length; index += 1) {
      const path = chunk[index];
      const signedUrl = data?.[index]?.signedUrl;
      if (!signedUrl) continue;
      output.set(path, signedUrl);
      signedUrlCache.set(cacheKey(path), { url: signedUrl, expiresAt: Date.now() + expiresIn * 1000 });
    }
  }
  return output;
}

function asPhoto(value: unknown): PatientPhoto {
  const row = value as PatientPhoto;
  return {
    ...row,
    photo_session_id: row.photo_session_id ?? null,
    procedure_id: row.procedure_id ?? null,
    appointment_id: row.appointment_id ?? null,
    service_id: row.service_id ?? null,
    label: row.label ?? null,
    caption: row.caption ?? null,
    angle: row.angle ?? null,
    region: row.region ?? null,
    pose: row.pose ?? null,
    original_path: row.original_path ?? row.photo_url ?? null,
    preview_path: row.preview_path ?? null,
    thumbnail_path: row.thumbnail_path ?? null,
    mime_type: row.mime_type ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    size_bytes: row.size_bytes ?? null,
    sha256: row.sha256 ?? null,
    source_type: row.source_type ?? 'legacy',
  };
}

function asSession(value: unknown): PatientPhotoSession {
  const row = value as Omit<PatientPhotoSession, 'photo_count' | 'photos'> & { photo_count: number | string; photos: unknown[] | null };
  return {
    ...row,
    photo_count: Number(row.photo_count ?? 0),
    photos: Array.isArray(row.photos) ? row.photos.map(asPhoto) : [],
  };
}

export function usePatientPhotos(patientId: string) {
  const [sessions, setSessions] = useState<PatientPhotoSession[]>([]);
  const [legacyPhotos, setLegacyPhotos] = useState<PatientPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const hydrateThumbnails = useCallback(async (items: PatientPhoto[]) => {
    const pathById = new Map(items.map(photo => [photo.id, getPhotoPath(photo, 'thumbnail')]));
    const signed = await signStoragePaths([...pathById.values()], SIGNED_THUMB_TTL);
    return items.map(photo => ({ ...photo, thumbnail_url: signed.get(pathById.get(photo.id) ?? '') ?? null }));
  }, []);

  const load = useCallback(async (filters: PhotoSessionFilters = {}, offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionRows, error: sessionError } = await supabase.rpc('list_patient_photo_sessions_v1', {
        p_patient_id: patientId,
        p_limit: SESSION_PAGE_SIZE,
        p_offset: offset,
        p_service_id: filters.serviceId || null,
        p_session_type: filters.sessionType || null,
        p_from: filters.from || null,
        p_to: filters.to || null,
      });
      if (sessionError) throw sessionError;
      const parsed: PatientPhotoSession[] = (sessionRows ?? []).map(asSession);
      const allPhotos = parsed.flatMap(session => session.photos);
      const hydrated = await hydrateThumbnails(allPhotos);
      const byId = new Map(hydrated.map(photo => [photo.id, photo]));
      const hydratedSessions = parsed.map(session => ({ ...session, photos: session.photos.map(photo => byId.get(photo.id) ?? photo) }));
      setSessions(previous => offset === 0 ? hydratedSessions : [...previous, ...hydratedSessions]);
      setHasMore(parsed.length === SESSION_PAGE_SIZE);

      if (offset === 0) {
        const { data: legacyRows, error: legacyError } = await supabase
          .from('patient_photos')
          .select('*')
          .eq('patient_id', patientId)
          .is('photo_session_id', null)
          .is('voided_at', null)
          .order('taken_at', { ascending: false })
          .limit(50);
        if (legacyError) throw legacyError;
        setLegacyPhotos(await hydrateThumbnails((legacyRows ?? []).map(asPhoto)));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as fotos.');
    } finally {
      setLoading(false);
    }
  }, [hydrateThumbnails, patientId]);

  const loadMore = useCallback((filters: PhotoSessionFilters = {}) => load(filters, sessions.length), [load, sessions.length]);

  const getAttendanceContext = useCallback(async (appointmentId: string): Promise<AttendancePhotoContext | null> => {
    const { data, error: contextError } = await supabase.rpc('get_attendance_context_v1', { p_appointment_id: appointmentId });
    if (contextError) throw contextError;
    const row = data?.[0];
    if (!row || row.patient_id !== patientId) return null;
    return {
      appointmentId: row.appointment_id,
      patientId: row.patient_id,
      patientName: row.patient_name,
      serviceId: row.service_id ?? null,
      serviceName: row.service_name ?? null,
      procedureId: row.procedure_id ?? null,
    };
  }, [patientId]);

  const createSession = useCallback(async (input: CreatePhotoSessionInput): Promise<PatientPhotoSession> => {
    if (!navigator.onLine) throw new Error('Conecte-se à internet para registrar fotos com segurança.');
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) throw authError ?? new Error('Sessão expirada. Entre novamente.');
    const sessionId = crypto.randomUUID();
    const { data, error: insertError } = await supabase.from('patient_photo_sessions').insert({
      id: sessionId,
      user_id: userData.user.id,
      patient_id: patientId,
      appointment_id: input.appointmentId ?? null,
      procedure_id: input.procedureId ?? null,
      service_id: input.serviceId ?? null,
      session_type: input.sessionType,
      capture_set: input.captureSet,
      title: input.title?.trim() || null,
      notes: input.notes?.trim() || null,
      captured_at: new Date().toISOString(),
    }).select('*').single();
    if (insertError) throw insertError;
    const row = data as Record<string, unknown>;
    return asSession({ ...row, session_id: row.id, service_name: row.service_name_snapshot, photo_count: 0, photos: [] });
  }, [patientId]);

  const cleanupUnregistered = useCallback(async (paths: string[]) => {
    const { error: cleanupError } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
    if (cleanupError && !cleanupError.message.toLowerCase().includes('not found')) console.warn('Photo cleanup failed', cleanupError.message);
  }, []);

  const uploadPhoto = useCallback(async (input: UploadClinicalPhotoInput): Promise<PatientPhoto> => {
    if (!navigator.onLine) throw new Error('Esta foto ainda não foi salva. Verifique a internet e tente novamente.');
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) throw authError ?? new Error('Sessão expirada. Entre novamente.');

    const { data: alreadySaved } = await supabase.from('patient_photos').select('*').eq('patient_id', patientId).eq('client_upload_id', input.uploadId).maybeSingle();
    if (alreadySaved) return asPhoto(alreadySaved);

    const prepared = await prepareClinicalPhoto(input.file, input.sourceType);
    const paths = photoStoragePaths(userData.user.id, patientId, input.uploadId, prepared.mimeType);
    const pathList = [paths.original, paths.preview, paths.thumbnail];
    await cleanupUnregistered(pathList);

    const uploadOne = async (path: string, blob: Blob) => {
      const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
        upsert: false,
        contentType: prepared.mimeType,
        cacheControl: '0',
      });
      if (uploadError) throw uploadError;
    };

    try {
      await uploadOne(paths.original, prepared.original);
      await uploadOne(paths.preview, prepared.preview);
      await uploadOne(paths.thumbnail, prepared.thumbnail);

      const { data, error: insertError } = await supabase.from('patient_photos').insert({
        id: input.uploadId,
        patient_id: patientId,
        user_id: userData.user.id,
        photo_url: paths.original,
        photo_session_id: input.session.session_id,
        appointment_id: input.session.appointment_id,
        procedure_id: input.session.procedure_id,
        service_id: input.session.service_id,
        photo_type: 'general',
        label: input.angle ? null : 'Foto livre',
        caption: input.caption?.trim() || null,
        angle: input.angle,
        region: input.region ?? null,
        pose: input.pose ?? null,
        taken_at: new Date().toISOString(),
        original_path: paths.original,
        preview_path: paths.preview,
        thumbnail_path: paths.thumbnail,
        mime_type: prepared.mimeType,
        width: prepared.width,
        height: prepared.height,
        size_bytes: prepared.sizeBytes,
        sha256: prepared.sha256,
        source_type: input.sourceType,
        client_upload_id: input.uploadId,
        canonicalized_at: new Date().toISOString(),
      }).select('*').single();

      if (insertError) {
        const { data: committed } = await supabase.from('patient_photos').select('*').eq('patient_id', patientId).eq('client_upload_id', input.uploadId).maybeSingle();
        if (committed) return asPhoto(committed);
        throw insertError;
      }
      return asPhoto(data);
    } catch (cause) {
      await cleanupUnregistered(pathList);
      throw cause;
    }
  }, [cleanupUnregistered, patientId]);

  const updatePhotoMetadata = useCallback(async (photoId: string, patch: { angle?: PhotoAngle | null; region?: string | null; pose?: PhotoPose | null; caption?: string | null; photo_session_id?: string | null }) => {
    const { error: updateError } = await supabase.from('patient_photos').update(patch).eq('id', photoId).eq('patient_id', patientId);
    if (updateError) throw updateError;
  }, [patientId]);

  const voidPhoto = useCallback(async (photoId: string, reason: string) => {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) throw new Error('Informe o motivo da anulação.');
    const { error: voidError } = await supabase.from('patient_photos').update({ voided_at: new Date().toISOString(), void_reason: cleanReason }).eq('id', photoId).eq('patient_id', patientId);
    if (voidError) throw voidError;
  }, [patientId]);

  const getPhotoUrl = useCallback(async (photo: PatientPhoto, variant: SignedVariant = 'preview') => {
    const path = getPhotoPath(photo, variant);
    const signed = await signStoragePaths([path], variant === 'thumbnail' ? SIGNED_THUMB_TTL : SIGNED_VIEW_TTL);
    const url = signed.get(path);
    if (!url) throw new Error('Foto indisponível.');
    return url;
  }, []);

  const signPhotoPreviews = useCallback(async (photos: readonly PatientPhoto[]) => {
    const pathById = new Map(photos.map(photo => [photo.id, getPhotoPath(photo, 'preview')]));
    const signed = await signStoragePaths([...pathById.values()], SIGNED_VIEW_TTL);
    return new Map(photos.map(photo => [photo.id, signed.get(pathById.get(photo.id) ?? '') ?? null]));
  }, []);

  return {
    sessions,
    legacyPhotos,
    loading,
    error,
    hasMore,
    load,
    loadMore,
    getAttendanceContext,
    createSession,
    uploadPhoto,
    updatePhotoMetadata,
    voidPhoto,
    getPhotoUrl,
    signPhotoPreviews,
  };
}
