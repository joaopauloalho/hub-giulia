import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PatientPhoto } from '../types';
import { createSignedStorageUrl, storagePathFromValue } from '../lib/storage';

export function usePatientPhotos(patientId: string) {
  const [photos, setPhotos] = useState<PatientPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: photosError } = await supabase
        .from('patient_photos')
        .select('*')
        .eq('patient_id', patientId)
        .order('taken_at', { ascending: false });

      if (photosError) throw photosError;

      const signedPhotos = await Promise.all(
        ((data ?? []) as PatientPhoto[]).map(async photo => ({
          ...photo,
          photo_url: await createSignedStorageUrl('patient-photos', photo.photo_url) ?? '',
        }))
      );

      setPhotos(signedPhotos);
    } catch (err) {
      setPhotos([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar fotos.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const upload = async (file: File, label: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const ext = file.name.split('.').pop();
    const path = `${user!.id}/${patientId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('patient-photos')
      .upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from('patient_photos').insert({
      patient_id: patientId,
      user_id: user!.id,
      photo_url: path,
      label: label || null,
      taken_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
    await load();
  };

  const remove = async (photo: PatientPhoto) => {
    const path = storagePathFromValue(photo.photo_url, 'patient-photos');
    if (path) {
      await supabase.storage.from('patient-photos').remove([path]);
    }
    await supabase.from('patient_photos').delete().eq('id', photo.id);
    await load();
  };

  return { photos, loading, error, load, upload, remove };
}
