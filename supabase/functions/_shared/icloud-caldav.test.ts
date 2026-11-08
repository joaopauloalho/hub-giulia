import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14';
import { davResponses, parseCalendarResource, safeIcloudUrl, calendarQueryXml } from './icloud-caldav.ts';

Deno.test('CalDAV multistatus parsing preserves href and iCalendar payload', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <D:response>
        <D:href>/123/calendars/abc/test.ics</D:href>
        <D:propstat><D:prop>
          <D:getetag>"etag-1"</D:getetag>
          <C:calendar-data>BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR</C:calendar-data>
        </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      </D:response>
    </D:multistatus>`;
  const rows = davResponses(xml);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].href, '/123/calendars/abc/test.ics');
  assertEquals(rows[0].prop.getetag, '"etag-1"');
});

Deno.test('CalDAV parser expands recurring events while respecting EXDATE', () => {
  const data = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:series-1@unit.test\r
DTSTART:20261110T150000Z\r
DTEND:20261110T160000Z\r
SUMMARY:Consulta de acompanhamento\r
RRULE:FREQ=DAILY;COUNT=3\r
EXDATE:20261111T150000Z\r
END:VEVENT\r
END:VCALENDAR\r
`.replace(/\r\n/g,'\r\n');
  const entries = parseCalendarResource(data, 'https://p10-caldav.icloud.com/abc.ics', '"a"',
    new Date('2026-11-10T00:00:00Z'), new Date('2026-11-14T00:00:00Z'));
  assertEquals(entries.length, 2);
  assertEquals(entries.map(e => e.starts_at), [
    '2026-11-10T15:00:00.000Z', '2026-11-12T15:00:00.000Z',
  ]);
  assertEquals(entries[0].event_uid,'series-1@unit.test');
});

Deno.test('all-day private event preserves date without UTC day drift', () => {
  const data = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:private-1
DTSTART;VALUE=DATE:20261127
DTEND;VALUE=DATE:20261128
SUMMARY:Compromisso pessoal
CLASS:PRIVATE
END:VEVENT
END:VCALENDAR`;
  const entry = parseCalendarResource(data,'https://caldav.icloud.com/a.ics',null,
    new Date('2026-11-26T00:00:00Z'),new Date('2026-11-29T00:00:00Z'))[0];
  assertEquals(entry.is_all_day,true);
  assertEquals(entry.is_private,true);
  assertEquals(entry.starts_at,'2026-11-27T03:00:00.000Z');
});

Deno.test('CalDAV host allowlist rejects off-platform and HTTP redirects', () => {
  assertThrows(()=>safeIcloudUrl('https://attacker.test/event.ics'));
  assertThrows(()=>safeIcloudUrl('http://caldav.icloud.com/1.ics'));
  assertThrows(()=>safeIcloudUrl('https://caldav.icloud.com.attacker.test/1.ics'));
  assertEquals(safeIcloudUrl('/a.ics','https://p22-caldav.icloud.com/calendars/'),
    'https://p22-caldav.icloud.com/a.ics');
});

Deno.test('CalDAV date query is half-open and UTC based', () => {
  const xml = calendarQueryXml(new Date('2026-11-10T00:00:00Z'),new Date('2026-11-20T00:00:00Z'));
  assertEquals(xml.includes('start="20261110T000000Z"'),true);
  assertEquals(xml.includes('end="20261120T000000Z"'),true);
});
