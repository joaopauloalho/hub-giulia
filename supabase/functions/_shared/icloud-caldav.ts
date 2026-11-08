import { XMLParser } from 'npm:fast-xml-parser@5.12.0';
import ICAL from 'npm:ical.js@2.2.1';
import { HttpError } from './google-calendar-security.ts';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false,
  processEntities: false, trimValues: false });
const XML_LIMIT = 10 * 1024 * 1024;
const EVENT_LIMIT = 4000;
const REQUEST_TIMEOUT_MS = 18000;

function list<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
function valueOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && '#text' in node) return valueOf((node as Record<string, unknown>)['#text']);
  return '';
}
export function safeIcloudUrl(href: string, base = 'https://caldav.icloud.com/'): string {
  let url: URL;
  try { url = new URL(href, base); }
  catch { throw new HttpError(502, 'icloud_invalid_href', 'O iCloud retornou um endereco invalido.'); }
  if (url.protocol !== 'https:' ||
      !/^(caldav\.icloud\.com|p[0-9]+-caldav\.icloud\.com)$/i.test(url.hostname) ||
      (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) {
    throw new HttpError(502, 'icloud_invalid_href', 'O iCloud retornou um endereco nao permitido.');
  }
  return url.toString();
}

function basicAuth(email: string, password: string): string {
  const bytes = new TextEncoder().encode(email + ':' + password);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return 'Basic ' + btoa(binary);
}

export async function caldavRequest(
  email: string, password: string, href: string, method: string, xml?: string, depth?: number,
  additionalHeaders: Record<string, string> = {},
): Promise<{ body: string; url: string; etag: string | null; status: number }> {
  let target = safeIcloudUrl(href);
  for (let redirect = 0; redirect < 5; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: {
          Authorization: basicAuth(email, password),
          ...(xml != null ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
          ...(depth != null ? { Depth: String(depth) } : {}),
          ...additionalHeaders,
        },
        body: xml,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, 'icloud_unreachable', 'Nao foi possivel acessar o iCloud. Tente novamente.');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new HttpError(502, 'icloud_redirect_invalid', 'Redirecionamento do iCloud invalido.');
      target = safeIcloudUrl(location, target);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, 'icloud_auth_failed', 'Conta Apple ou senha especifica do app recusada.');
    }
    if (response.status === 412) throw new HttpError(409, 'icloud_event_changed', 'Este evento foi alterado no iPhone. Sincronize antes de reenviar.');
    if (![200, 201, 204, 207].includes(response.status)) {
      throw new HttpError(502, 'icloud_provider_error', 'O iCloud nao conseguiu responder ao pedido.');
    }
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > XML_LIMIT) throw new HttpError(413, 'icloud_response_too_large', 'Calendario muito grande para uma sincronizacao.');
    const body = await response.text();
    if (body.length > XML_LIMIT) throw new HttpError(413, 'icloud_response_too_large', 'Calendario muito grande para uma sincronizacao.');
    return { body, url: target, etag: response.headers.get('etag'), status: response.status };
  }
  throw new HttpError(502, 'icloud_redirect_loop', 'O iCloud redirecionou a conexao muitas vezes.');
}

const DAV = 'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"';
const FIND_PRINCIPAL = '<D:propfind ' + DAV + '><D:prop><D:current-user-principal/><C:calendar-home-set/></D:prop></D:propfind>';
const FIND_HOME = '<D:propfind ' + DAV + '><D:prop><C:calendar-home-set/></D:prop></D:propfind>';
const FIND_COLLECTIONS = '<D:propfind ' + DAV + '><D:prop><D:displayname/><D:resourcetype/><D:current-user-privilege-set/><C:supported-calendar-component-set/></D:prop></D:propfind>';

type XmlObj = Record<string, unknown>;
function xmlNode(value: unknown): XmlObj { return value && typeof value === 'object' ? value as XmlObj : {}; }
export function davResponses(body: string): Array<{ href: string; prop: XmlObj }> {
  const root = xmlNode(parser.parse(body));
  const responses = list(xmlNode(root.multistatus).response);
  return responses.map(raw => {
    const node = xmlNode(raw);
    const prop = Object.assign({}, ...list(node.propstat).filter(status => {
      const match = valueOf(xmlNode(status).status);
      return match.includes('200');
    }).map(status => xmlNode(xmlNode(status).prop)));
    return { href: valueOf(node.href), prop };
  }).filter(r => !!r.href);
}
function childHref(node: unknown): string {
  return valueOf(xmlNode(node).href);
}
function hasTag(node: unknown, tag: string) {
  return Object.prototype.hasOwnProperty.call(xmlNode(node), tag);
}

export type DiscoveredCalendar = {
  calendar_id: string;
  calendar_url: string;
  display_name: string;
  is_writable: boolean;
  is_selected: boolean;
};
export async function discoverCalendars(email: string, password: string): Promise<{
  home: string; calendars: DiscoveredCalendar[];
}> {
  const entry = await caldavRequest(email, password, 'https://caldav.icloud.com/.well-known/caldav', 'PROPFIND', FIND_PRINCIPAL, 0);
  const first = davResponses(entry.body)[0]?.prop ?? {};
  const principal = childHref(first['current-user-principal']);
  let homeHref = childHref(first['calendar-home-set']);
  let homeBase = entry.url;
  if (!homeHref && principal) {
    const principalUrl = safeIcloudUrl(principal, entry.url);
    const p = await caldavRequest(email, password, principalUrl, 'PROPFIND', FIND_HOME, 0);
    homeHref = childHref(davResponses(p.body)[0]?.prop['calendar-home-set']);
    homeBase = p.url;
  }
  if (!homeHref) throw new HttpError(502, 'icloud_discovery_failed', 'Nao foi possivel encontrar os calendarios na Conta Apple.');
  const home = safeIcloudUrl(homeHref, homeBase);
  const response = await caldavRequest(email, password, home, 'PROPFIND', FIND_COLLECTIONS, 1);
  const calendars = davResponses(response.body).flatMap(item => {
    if (!hasTag(item.prop.resourcetype, 'calendar')) return [];
    const components = xmlNode(item.prop['supported-calendar-component-set']);
    const names = list(components.comp).map(comp => String(xmlNode(comp)['@_name'] ?? '').toUpperCase());
    if (names.length > 0 && !names.includes('VEVENT')) return [];
    const calendarUrl = safeIcloudUrl(item.href, response.url);
    const privileges = xmlNode(item.prop['current-user-privilege-set']);
    const namesOfPrivileges = list(privileges.privilege).map(x => xmlNode(x));
    const writable = namesOfPrivileges.some(x => hasTag(x,'write') || hasTag(x,'write-content') || hasTag(x,'all'));
    return [{
      calendar_id: new URL(calendarUrl).pathname,
      calendar_url: calendarUrl,
      display_name: valueOf(item.prop.displayname) || 'Calendario iCloud',
      is_writable: writable,
      is_selected: true,
    }];
  });
  if (!calendars.length) throw new HttpError(502, 'icloud_no_calendars', 'Nenhum calendario do iCloud foi encontrado.');
  return { home, calendars };
}

export type CalendarOccurrence = {
  resource_href: string;
  recurrence_id: string;
  event_uid: string;
  etag: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  is_private: boolean;
};
function jsInstant(time: ICAL.Time): string {
  if (time.isDate) {
    const y = String(time.year).padStart(4,'0');
    const m = String(time.month).padStart(2,'0');
    const d = String(time.day).padStart(2,'0');
    return new Date(y + '-' + m + '-' + d + 'T00:00:00-03:00').toISOString();
  }
  if (time.zone?.tzid === 'floating') {
    // Floating times use the clinic's wall clock, not UTC.
    const pad = (x: number) => String(x).padStart(2,'0');
    const local = `${time.year}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}-03:00`;
    return new Date(local).toISOString();
  }
  return time.toJSDate().toISOString();
}
export function parseCalendarResource(icalText: string, href: string, etag: string | null,
  from: Date, to: Date): CalendarOccurrence[] {
  let root: ICAL.Component;
  try { root = new ICAL.Component(ICAL.parse(icalText)); }
  catch { throw new HttpError(502, 'icloud_invalid_event', 'Um evento retornado pelo iCloud nao pôde ser interpretado.'); }
  const zones = root.getAllSubcomponents('vtimezone');
  for (const zone of zones) {
    try {
      const tz = new ICAL.Timezone({ component: zone });
      ICAL.TimezoneService.register(tz.tzid, tz);
    } catch { /* unknown zone: do not mutate server data */ }
  }
  const components = root.getAllSubcomponents('vevent');
  // Fail closed on unknown named zones: guessing UTC silently shifts patient appointments.
  for (const component of components) {
    const property = component.getFirstProperty('dtstart');
    const tzid = property?.getParameter('tzid');
    if (tzid && tzid !== 'UTC' && !ICAL.TimezoneService.get(tzid)) {
      throw new HttpError(422,'icloud_unknown_timezone','O iCloud retornou um fuso horario nao reconhecido.');
    }
  }
  const masters = components.filter(component => !component.hasProperty('recurrence-id'));
  const exceptions = components.filter(component => component.hasProperty('recurrence-id'));
  const occurrences: CalendarOccurrence[] = [];
  for (const component of masters) {
    const master = new ICAL.Event(component);
    for (const exception of exceptions) {
      if (exception.getFirstPropertyValue('uid') === master.uid) master.relateException(exception);
    }
    const emit = (date: ICAL.Time) => {
      const details = master.getOccurrenceDetails(date);
      const item = details.item;
      const start = jsInstant(details.startDate);
      const end = jsInstant(details.endDate);
      if (new Date(start) >= to || new Date(end) <= from) return;
      if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
      if (!(new Date(end) > new Date(start))) return;
      if (occurrences.length >= EVENT_LIMIT) {
        throw new HttpError(413, 'icloud_events_limit', 'Ha muitos eventos neste periodo. Reduza o intervalo.');
      }
      const classification = String(item.component.getFirstPropertyValue('class') ?? '').toUpperCase();
      occurrences.push({
        resource_href: href,
        recurrence_id: master.isRecurring() ? date.toString() : '',
        event_uid: String(master.uid ?? ''),
        etag,
        title: String(item.component.getFirstPropertyValue('summary') ?? 'Compromisso').slice(0, 500),
        starts_at: start,
        ends_at: end,
        is_all_day: details.startDate.isDate,
        is_private: classification === 'PRIVATE' || classification === 'CONFIDENTIAL',
      });
    };
    if (master.isRecurring()) {
      const iterator = master.iterator();
      let next: ICAL.Time | null;
      let steps = 0;
      while ((next = iterator.next())) {
        if (++steps > 30000) throw new HttpError(413,'icloud_recurrence_limit','Recorrencia muito extensa; sincronizacao pausada para proteger a agenda.');
        if (new Date(jsInstant(next)) >= to) break;
        emit(next);
      }
    } else emit(master.startDate);
  }
  return occurrences;
}

function toCalDavTime(date: Date) {
  return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
}
export function calendarQueryXml(from: Date, to: Date) {
  return '<C:calendar-query ' + DAV + '><D:prop><D:getetag/><C:calendar-data/></D:prop>' +
    '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="' +
    toCalDavTime(from) + '" end="' + toCalDavTime(to) +
    '"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';
}
export async function readCalendar(email: string, password: string, calendarUrl: string,
  from: Date, to: Date): Promise<CalendarOccurrence[]> {
  const response = await caldavRequest(email, password, calendarUrl, 'REPORT',
    calendarQueryXml(from, to), 1);
  const rows = davResponses(response.body);
  if (rows.length > EVENT_LIMIT) throw new HttpError(413, 'icloud_events_limit', 'Calendario muito grande neste intervalo.');
  const output: CalendarOccurrence[] = [];
  for (const row of rows) {
    const resource = safeIcloudUrl(row.href, response.url);
    const data = valueOf(row.prop['calendar-data']);
    if (!data) {
      // A partial 207 response is not evidence that an Apple event was deleted.
      // Fail closed rather than let the hourly reconciliation hide valid events.
      const resourcePath = new URL(resource).pathname.replace(/\\/$/, '');
      const calendarPath = new URL(calendarUrl).pathname.replace(/\\/$/, '');
      if (resourcePath === calendarPath) continue;
      throw new HttpError(502,'icloud_incomplete_report',
        'O iCloud devolveu um calendario incompleto. Nenhum evento foi removido.');
    }
    const items = parseCalendarResource(data, resource, valueOf(row.prop.getetag) || null, from, to);
    output.push(...items);
    if (output.length > EVENT_LIMIT) throw new HttpError(413, 'icloud_events_limit', 'Calendario muito grande neste intervalo.');
  }
  return output;
}

