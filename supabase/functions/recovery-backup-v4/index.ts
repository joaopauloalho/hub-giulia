import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { Client } from 'npm:pg@8.16.3';

type Fingerprint = { count: number; sha256: string };
type BackupPackage = {
  format: 1;
  created_at: string;
  source_project: string;
  migration_version: string | null;
  tables: Record<string, string[]>;
  table_fingerprints: Record<string, Fingerprint>;
  objects: Array<{ bucket: string; path: string; content_type: string; size: number; sha256: string; data_base64: string }>;
};
const RECOVERY_URL = 'https://coimstexbntzxzrwlrws.supabase.co/functions/v1/recovery-backup-ingest';
const enc = new TextEncoder();
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }
function qi(v: string) { return '"' + v.replaceAll('"', '""') + '"'; }
async function sha256Hex(bytes: Uint8Array) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); return [...d].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function rowsFingerprint(rows: string[]) { return sha256Hex(enc.encode([...rows].sort().join('\n'))); }
function toB64(bytes: Uint8Array) { let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return btoa(binary); }
async function gzip(bytes: Uint8Array) { const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')); return new Uint8Array(await new Response(stream).arrayBuffer()); }
async function pgClient() { const url = Deno.env.get('SUPABASE_DB_URL'); if (!url) throw new Error('db_url_missing'); const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } }); await c.connect(); return c; }
function adminClient() { const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !key) throw new Error('admin_env_missing'); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function vaultSecret(db: Client, name: string) { const r = await db.query(`select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1`, [name]); return r.rows[0]?.decrypted_secret as string | undefined; }
async function buildPackage(db: Client): Promise<BackupPackage> {
  const tables: Record<string, string[]> = {}; const tableFingerprints: Record<string, Fingerprint> = {};
  const publicTables = await db.query(`select tablename from pg_tables where schemaname='public' order by tablename`);
  for (const r of publicTables.rows) { const key = `public.${r.tablename}`; const rows = (await db.query(`select to_jsonb(t)::text as row_json from public.${qi(String(r.tablename))} t`)).rows.map((x: any) => String(x.row_json)); tables[key] = rows; tableFingerprints[key] = { count: rows.length, sha256: await rowsFingerprint(rows) }; }
  for (const table of ['users', 'identities']) { const key = `auth.${table}`; const rows = (await db.query(`select to_jsonb(t)::text as row_json from auth.${qi(table)} t`)).rows.map((x: any) => String(x.row_json)); tables[key] = rows; tableFingerprints[key] = { count: rows.length, sha256: await rowsFingerprint(rows) }; }
  const migration = await db.query(`select max(version::text) as version from supabase_migrations.schema_migrations`);
  const admin = adminClient(); const objectRows = await db.query(`select bucket_id, name, metadata from storage.objects where bucket_id in ('patient-photos','contracts','proposals') order by bucket_id,name`); const objects: BackupPackage['objects'] = [];
  for (const o of objectRows.rows) { const { data, error } = await admin.storage.from(o.bucket_id).download(o.name); if (error || !data) throw new Error(`storage_download:${o.bucket_id}`); const bytes = new Uint8Array(await data.arrayBuffer()); const contentType = String(o.metadata?.mimetype || o.metadata?.contentType || data.type || 'application/octet-stream'); objects.push({ bucket: String(o.bucket_id), path: String(o.name), content_type: contentType, size: bytes.length, sha256: await sha256Hex(bytes), data_base64: toB64(bytes) }); }
  return { format: 1, created_at: new Date().toISOString(), source_project: 'pvkrwjryvwsfwaxougyy', migration_version: migration.rows[0]?.version ?? null, tables, table_fingerprints: tableFingerprints, objects };
}
Deno.serve(async (req: Request) => { const started = Date.now(); const db = await pgClient(); try { const invoke = await vaultSecret(db, 'hub_giulia_backup_invoke_token'); if (!invoke || req.headers.get('x-invoke-token') !== invoke) return json({ error: 'not_found' }, 404); const transfer = await vaultSecret(db, 'hub_giulia_backup_transfer_token'); if (!transfer) throw new Error('transfer_secret_missing'); const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}; if (body?.mode !== 'snapshot') return json({ error: 'bad_mode' }, 400); const pkg = await buildPackage(db); const raw = enc.encode(JSON.stringify(pkg)); const compressed = await gzip(raw); const archiveName = `${pkg.created_at.replace(/[:.]/g, '-')}.hub-giulia.json.gz`; const response = await fetch(RECOVERY_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-backup-token': transfer }, body: JSON.stringify({ action: 'store-and-restore', archive_name: archiveName, archive_base64: toB64(compressed) }) }); const result = await response.json().catch(() => ({})) as Record<string, unknown>; if (!response.ok || result.ok !== true) throw new Error(`recovery_restore_${response.status}`); return json({ ok: true, created_at: pkg.created_at, migration_version: pkg.migration_version, public_table_count: Object.keys(pkg.tables).filter(k => k.startsWith('public.')).length, auth_table_count: 2, object_count: pkg.objects.length, raw_bytes: raw.length, compressed_bytes: compressed.length, archive_path: result.archive_path, archive_sha256: result.archive_sha256, restore_mismatches: result.mismatches, duration_ms: Date.now() - started }); } catch (e) { console.error('[recovery-backup-v4]', { code: e instanceof Error ? e.message.split(':')[0] : 'unknown' }); return json({ ok: false, error: e instanceof Error ? e.message.split(':')[0] : 'backup_failed', duration_ms: Date.now() - started }, 500); } finally { await db.end(); } });
