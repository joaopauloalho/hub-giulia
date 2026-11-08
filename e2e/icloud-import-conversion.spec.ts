import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminClient, signedInClient } from './helpers';

type E2EState = { users: { a: string; b: string }; serviceId: string; patientId: string };
const state = async () => JSON.parse(await fs.readFile('.e2e-state.json','utf8')) as E2EState;

test('imported iCloud event is linked explicitly once, with the original external identity intact', async () => {
  const seeded = await state();
  const admin = adminClient();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const id = randomUUID();
  const calendarId = '/test-icloud-' + id + '/';
  const href = 'https://p10-caldav.icloud.com' + calendarId + id + '.ics';
  const patient = await a.from('patients').insert({name:'E2E iCloud ' + id.slice(0,6),phone:'+5543999991234'}).select('id').single();
  expect(patient.error).toBeNull();
  const account = await admin.from('icloud_calendar_accounts').upsert({
    user_id:seeded.users.a,apple_id:'e2e-apple@example.invalid',
    calendar_home_url:'https://p10-caldav.icloud.com/e2e/',connected:false,
    write_enabled:false,secret_id:null,
  },{onConflict:'user_id'});
  expect(account.error).toBeNull();
  const collection = await admin.from('icloud_calendar_collections').insert({
    user_id:seeded.users.a,calendar_id:calendarId,
    calendar_url:'https://p10-caldav.icloud.com' + calendarId,
    display_name:'E2E iCloud',is_selected:true,is_writable:false,
  });
  expect(collection.error).toBeNull();
  const event = await admin.from('icloud_calendar_events').insert({
    user_id:seeded.users.a,calendar_id:calendarId,
    resource_href:href,event_uid:'e2e-' + id,recurrence_id:'',
    etag:'"v1"',title:'Consulta E2E',
    starts_at:'2031-02-12T17:00:00.000Z',
    ends_at:'2031-02-12T18:00:00.000Z',
  }).select('id').single();
  expect(event.error).toBeNull();

  const crossTenant = await b.from('icloud_calendar_events').select('id').eq('id',event.data!.id);
  expect(crossTenant.error).toBeNull();
  expect(crossTenant.data).toEqual([]);

  const directProviderWrite = await a.from('icloud_calendar_events')
    .update({title:'Overwrite Apple event'}).eq('id',event.data!.id);
  expect(directProviderWrite.error).not.toBeNull();

  const linked = await a.from('icloud_calendar_events')
    .update({linked_patient_id:patient.data!.id}).eq('id',event.data!.id).select('linked_patient_id').single();
  expect(linked.error).toBeNull();
  expect(linked.data?.linked_patient_id).toBe(patient.data!.id);

  const first = await a.rpc('convert_icloud_event_v1',{p_event_id:event.data!.id,p_service_id:null});
  const second = await a.rpc('convert_icloud_event_v1',{p_event_id:event.data!.id,p_service_id:null});
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();
  expect(second.data).toBe(first.data);

  const appointment = await a.from('appointments').select('id,patient_id,scheduled_at,duration_minutes')
    .eq('id',first.data).single();
  expect(appointment.error).toBeNull();
  expect(appointment.data?.patient_id).toBe(patient.data!.id);
  expect(new Date(appointment.data!.scheduled_at).toISOString()).toBe('2031-02-12T17:00:00.000Z');
  expect(appointment.data?.duration_minutes).toBe(60);

  const external = await admin.from('icloud_calendar_events')
    .select('resource_href,etag,event_uid,linked_appointment_id')
    .eq('id',event.data!.id).single();
  expect(external.error).toBeNull();
  expect(external.data).toMatchObject({resource_href:href,etag:'"v1"',
    event_uid:'e2e-' + id,linked_appointment_id:first.data});

  const links = await admin.from('icloud_appointment_links').select('resource_href,source_kind')
    .eq('user_id',seeded.users.a).eq('appointment_id',first.data);
  expect(links.error).toBeNull();
  expect(links.data).toHaveLength(1);
  expect(links.data?.[0]).toEqual({resource_href:href,source_kind:'imported'});

  const classification=await a.from('icloud_calendar_events')
    .update({review_state:'personal'}).eq('id',event.data!.id).select('review_state').single();
  expect(classification.error).toBeNull();
  expect(classification.data?.review_state).toBe('personal');

  // Re-import must update Apple-owned details but preserve clinic links and review state.
  const changed=await admin.rpc('ingest_icloud_events_v2',{
    p_user:seeded.users.a,
    p_calendar_id:calendarId,
    p_seen_at:'2031-02-15T12:00:00.000Z',
    p_events:[{
      resource_href:href,recurrence_id:'',event_uid:'e2e-'+id,
      etag:'"v2"',title:'Atualizado no iPhone',
      starts_at:'2031-02-12T17:30:00.000Z',ends_at:'2031-02-12T18:30:00.000Z',
      is_all_day:false,is_private:false,
    }],
  });
  expect(changed.error).toBeNull();
  const retained=await admin.from('icloud_calendar_events')
    .select('review_state,linked_patient_id,linked_appointment_id,title,etag,is_deleted')
    .eq('id',event.data!.id).single();
  expect(retained.error).toBeNull();
  expect(retained.data).toMatchObject({
    review_state:'personal',linked_patient_id:patient.data!.id,
    linked_appointment_id:first.data,title:'Atualizado no iPhone',
    etag:'"v2"',is_deleted:false,
  });

  // A deletion on the iPhone must remove the imported calendar item without
  // deleting/cancelling the existing clinical appointment or patient history.
  const deleted=await admin.rpc('finish_icloud_calendar_sync_v2',{
    p_user:seeded.users.a,p_calendar_id:calendarId,
    p_seen_at:'2031-02-15T13:00:00.000Z',
    p_from:'2031-02-12T00:00:00.000Z',p_to:'2031-02-13T00:00:00.000Z',
  });
  expect(deleted.error).toBeNull();
  expect(deleted.data).toBe(1);
  const tombstone=await admin.from('icloud_calendar_events')
    .select('is_deleted,linked_appointment_id').eq('id',event.data!.id).single();
  expect(tombstone.data).toEqual({is_deleted:true,linked_appointment_id:first.data});
  const stillClinicallyScheduled=await a.from('appointments').select('id')
    .eq('id',first.data).single();
  expect(stillClinicallyScheduled.error).toBeNull();
  expect(stillClinicallyScheduled.data?.id).toBe(first.data);
});
