import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PatientPhoto } from '../types';

export function usePatientPhotos(patientId: string) {
  const [photos, setPhotos] = useState<PatientPhoto[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('patient_photos')
      .select('*')
      .eq('patient_id', patientId)
      .order('taken_at', { ascending: false });
    setPhotos(data ?? []);
    setLoading(false);
  }, [patientId]);

  const upload = async (file: File, label: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const ext = file.name.split('.').pop();
    const path = `${user!.id}/${patientId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('patient-photos')
      .upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('patient-photos')
      .getPublicUrl(path);

    const { error: insertError } = await supabase.from('patient_photos').insert({
      patient_id: patientId,
      user_id: user!.id,
      photo_url: urlData.publicUrl,
      label: label || null,
      taken_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
    await load();
  };

  const remove = async (photo: PatientPhoto) => {
    const url = new URL(photo.photo_url);
    const path = url.pathname.split('/patient-photos/')[1];
    if (path) {
      await supabase.storage.from('patient-photos').remove([path]);
    }
    await supabase.from('patient_photos').delete().eq('id', photo.id);
    await load();
  };

  return { photos, loading, load, upload, remove };
}
