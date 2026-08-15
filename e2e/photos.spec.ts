import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = {
  users: { a: string; b: string };
  serviceId: string;
  patientId: string;
  appointmentId: string;
};
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('canonical clinical photo uses private Storage, session metadata, immutable original and void lifecycle', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');

  const { data: session, error: sessionError } = await a.from('patient_photo_sessions').insert({
    patient_id: seeded.patientId,
    appointment_id: seeded.appointmentId,
    service_id: seeded.serviceId,
    session_type: 'baseline',
    capture_set: 'free',
    title: 'E2E TEST Photo Session',
    notes: 'E2E TEST non-sensitive photo session',
  }).select('id,user_id,patient_id,service_name_snapshot,voided_at').single();
  expect(sessionError).toBeNull();
  expect(session?.user_id).toBe(seeded.users.a);
  expect(session?.patient_id).toBe(seeded.patientId);
  expect(session?.service_name_snapshot).toBe('E2E TEST Service');

  const photoId = randomUUID();
  const clientUploadId = randomUUID();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(png).digest('hex');
  const prefix = `${seeded.users.a}/patients/${seeded.patientId}/photos/${photoId}`;
  const originalPath = `${prefix}/original.png`;
  const previewPath = `${prefix}/preview.png`;
  const thumbnailPath = `${prefix}/thumbnail.png`;

  for (const path of [originalPath, previewPath, thumbnailPath]) {
    const uploaded = await a.storage.from('patient-photos').upload(path, png, {
      contentType: 'image/png',
      upsert: false,
    });
    expect(uploaded.error).toBeNull();
  }

  const { data: photo, error: photoError } = await a.from('patient_photos').insert({
    id: photoId,
    patient_id: seeded.patientId,
    photo_session_id: session!.id,
    appointment_id: seeded.appointmentId,
    service_id: seeded.serviceId,
    photo_url: originalPath,
    photo_type: 'general',
    label: 'E2E TEST clinical photo',
    caption: 'E2E TEST non-sensitive fixture',
    original_path: originalPath,
    preview_path: previewPath,
    thumbnail_path: thumbnailPath,
    mime_type: 'image/png',
    width: 1,
    height: 1,
    size_bytes: png.length,
    sha256,
    source_type: 'upload',
    client_upload_id: clientUploadId,
    canonicalized_at: new Date().toISOString(),
  }).select('id,user_id,patient_id,photo_url,original_path,preview_path,thumbnail_path,sha256,voided_at').single();
  expect(photoError).toBeNull();
  expect(photo?.photo_url).toBe(originalPath);
  expect(photo?.original_path).toBe(originalPath);
  expect(photo?.sha256).toBe(sha256);

  const view = await a.storage.from('patient-photos').createSignedUrl(thumbnailPath, 60);
  expect(view.error).toBeNull();
  expect(view.data?.signedUrl).toBeTruthy();

  const bSession = await b.from('patient_photo_sessions').select('id').eq('id', session!.id);
  expect(bSession.error).toBeNull();
  expect(bSession.data).toEqual([]);
  const bPhoto = await b.from('patient_photos').select('id').eq('id', photoId);
  expect(bPhoto.error).toBeNull();
  expect(bPhoto.data).toEqual([]);
  const bSigned = await b.storage.from('patient-photos').createSignedUrl(originalPath, 60);
  expect(bSigned.error).not.toBeNull();

  const immutableRewrite = await a.from('patient_photos')
    .update({ original_path: `${prefix}/tampered.png` })
    .eq('id', photoId)
    .select('id');
  expect(immutableRewrite.error).not.toBeNull();

  const { data: voidedPhoto, error: voidPhotoError } = await a.from('patient_photos')
    .update({ voided_at: new Date().toISOString(), void_reason: 'E2E TEST lifecycle cleanup' })
    .eq('id', photoId)
    .select('id,voided_at,void_reason,voided_by')
    .single();
  expect(voidPhotoError).toBeNull();
  expect(voidedPhoto?.voided_at).toBeTruthy();
  expect(voidedPhoto?.voided_by).toBe(seeded.users.a);

  const deleteRegisteredOriginal = await a.storage.from('patient-photos').remove([originalPath]);
  expect(deleteRegisteredOriginal.error).toBeNull();
  const originalStillPresent = await a.storage.from('patient-photos').download(originalPath);
  expect(originalStillPresent.error).toBeNull();
  expect(originalStillPresent.data).not.toBeNull();

  const { data: voidedSession, error: voidSessionError } = await a.from('patient_photo_sessions')
    .update({ voided_at: new Date().toISOString(), void_reason: 'E2E TEST lifecycle cleanup' })
    .eq('id', session!.id)
    .select('id,voided_at,voided_by')
    .single();
  expect(voidSessionError).toBeNull();
  expect(voidedSession?.voided_at).toBeTruthy();
  expect(voidedSession?.voided_by).toBe(seeded.users.a);
});
