import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { Client } from 'npm:pg@8.16.3';

type Fingerprint = { count: number; sha256: string };
type ColumnInfo = { column_name: string; is_generated: string; identity_generation: string | null };
type BackupPackage = {
  format: 1;
  created_at: string;
  source_project: string;
  migration_version: string | null;
  tables: Record<string, string[]>;
  table_fingerprints: Record<string, Fingerprint>;
  objects: Array<{ bucket: string; path: string; content_type: string; size: number; sha256: string; data_base64: string }>;
};

const enc = new TextEncoder();
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function qi(v: string) { return '"' + v.replaceAll('"', '""') + '"'; }
function fromB64(v: string) {
  const binary = atob(v);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function rowsFingerprint(rows: string[]) { return sha256Hex(enc.encode([...rows].sort().join('\n'))); }
async function gunzip(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function pgClient() {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('db_url_missing');
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}
function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('admin_env_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function vaultSecret(db: Client, name: string) {
  const result = await db.query<{ decrypted_secret: string }>(`select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1`, [name]);
  return result.rows[0]?.decrypted_secret;
}
async function ensureBackupBucket() {
  const admin = adminClient();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some(bucket => bucket.name === 'recovery-backups')) {
    const { error } = await admin.storage.createBucket('recovery-backups', { public: false, fileSizeLimit: 52428800 });
    if (error) throw new Error('backup_bucket_create');
  }
}
async function resetTarget(db: Client) {
  const tables = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname='public' order by tablename`);
  if (tables.rows.length) {
    await db.query(`truncate table ${tables.rows.map(row => `public.${qi(row.tablename)}`).join(',')} restart identity cascade`);
  }
  await db.query('truncate table auth.identities, auth.users cascade');
  const admin = adminClient();
  for (const bucket of ['patient-photos', 'contracts', 'proposals']) {
    const { error } = await admin.storage.emptyBucket(bucket);
    if (error && !/not found/i.test(error.message)) throw new Error(`empty_bucket:${bucket}`);
  }
}
async function ingestTable(db: Client, key: string, rows: string[]) {
  const [schema, table] = key.split('.');
  if (!['public', 'auth'].includes(schema) || !/^[A-Za-z0-9_]+$/.test(table)) throw new Error(`table_not_allowed:${key}`);
  if (!rows.length) return;
  const columnsResult = await db.query<ColumnInfo>(`select column_name, is_generated, identity_generation from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position`, [schema, table]);
  const columns = columnsResult.rows.filter(row => row.is_generated === 'NEVER').map(row => row.column_name);
  if (!columns.length) throw new Error(`no_insertable_columns:${key}`);
  const hasIdentity = columnsResult.rows.some(row => Boolean(row.identity_generation));
  const list = columns.map(qi).join(',');
  const target = `${qi(schema)}.${qi(table)}`;
  const recordsetJson = `[${rows.join(',')}]`;
  const sql = `insert into ${target} (${list}) ${hasIdentity ? 'overriding system value ' : ''}select ${list} from jsonb_populate_recordset(null::${target}, $1::jsonb)`;
  await db.query(sql, [recordsetJson]);
}
async function restorePackage(pkg: BackupPackage) {
  if (pkg.format !== 1 || !pkg.tables || !Array.isArray(pkg.objects)) throw new Error('bad_backup_format');
  const db = await pgClient();
  try {
    await resetTarget(db);
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    for (const key of ['auth.users', 'auth.identities']) if (pkg.tables[key]) await ingestTable(db, key, pkg.tables[key]);
    for (const key of Object.keys(pkg.tables).filter(key => key.startsWith('public.')).sort()) await ingestTable(db, key, pkg.tables[key]);
    await db.query('commit');
  } catch (error) {
    try {
      await db.query('rollback');
    } catch {
      // Best effort only: preserve the original restore failure.
    }
    throw error;
  } finally {
    await db.end();
  }
  const admin = adminClient();
  for (const object of pkg.objects) {
    if (!['patient-photos', 'contracts', 'proposals'].includes(object.bucket)) throw new Error(`bucket_not_allowed:${object.bucket}`);
    const bytes = fromB64(object.data_base64);
    if (bytes.length !== object.size || await sha256Hex(bytes) !== object.sha256) throw new Error(`object_package_hash:${object.bucket}`);
    const { error } = await admin.storage.from(object.bucket).upload(object.path, bytes, { upsert: true, contentType: object.content_type || 'application/octet-stream' });
    if (error) throw new Error(`object_restore:${object.bucket}`);
  }
}
async function verifyPackage(pkg: BackupPackage) {
  const mismatches: string[] = [];
  const db = await pgClient();
  try {
    for (const [key, expected] of Object.entries(pkg.table_fingerprints)) {
      const [schema, table] = key.split('.');
      const result = await db.query<{ row_json: string }>(`select to_jsonb(t)::text as row_json from ${qi(schema)}.${qi(table)} t`);
      const rows = result.rows.map(row => String(row.row_json));
      const actual = { count: rows.length, sha256: await rowsFingerprint(rows) };
      if (actual.count !== expected.count || actual.sha256 !== expected.sha256) mismatches.push(key);
    }
  } finally {
    await db.end();
  }
  const admin = adminClient();
  for (const object of pkg.objects) {
    const { data, error } = await admin.storage.from(object.bucket).download(object.path);
    if (error || !data) {
      mismatches.push(`${object.bucket}/${object.path}`);
      continue;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length !== object.size || await sha256Hex(bytes) !== object.sha256) mismatches.push(`${object.bucket}/${object.path}`);
  }
  return mismatches;
}
async function retainLatestSnapshots() {
  const admin = adminClient();
  const { data, error } = await admin.storage.from('recovery-backups').list('snapshots', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  if (error || !data) return;
  const old = data.filter(item => item.name.endsWith('.json.gz')).slice(14).map(item => `snapshots/${item.name}`);
  if (old.length) await admin.storage.from('recovery-backups').remove(old);
}

Deno.serve(async (req: Request) => {
  const authDb = await pgClient();
  try {
    const expected = await vaultSecret(authDb, 'hub_giulia_backup_transfer_token');
    if (!expected || req.headers.get('x-backup-token') !== expected) return json({ error: 'not_found' }, 404);
  } finally {
    await authDb.end();
  }
  let archivePath: string | null = null;
  let archiveStored = false;
  try {
    const body = await req.json() as { action?: string; archive_name?: string; archive_base64?: string };
    if (body.action !== 'store-and-restore' || !body.archive_name || !body.archive_base64) return json({ error: 'bad_request' }, 400);
    await ensureBackupBucket();
    const compressed = fromB64(body.archive_base64);
    const archiveHash = await sha256Hex(compressed);
    const admin = adminClient();
    archivePath = `snapshots/${body.archive_name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const { error: uploadError } = await admin.storage.from('recovery-backups').upload(archivePath, compressed, { upsert: false, contentType: 'application/gzip' });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error('archive_store');
    archiveStored = !uploadError;
    const raw = await gunzip(compressed);
    const pkg = JSON.parse(new TextDecoder().decode(raw)) as BackupPackage;
    await restorePackage(pkg);
    const mismatches = await verifyPackage(pkg);
    if (mismatches.length) throw new Error(`verify_mismatch:${mismatches.slice(0, 5).join(',')}`);
    await retainLatestSnapshots();
    return json({ ok: true, archive_path: archivePath, archive_sha256: archiveHash, created_at: pkg.created_at, table_count: Object.keys(pkg.tables).length, object_count: pkg.objects.length, mismatches: [] });
  } catch (error) {
    if (archiveStored && archivePath) {
      try {
        await adminClient().storage.from('recovery-backups').remove([archivePath]);
      } catch {
        // Best effort cleanup; the restore error remains authoritative.
      }
    }
    console.error('[recovery-backup-ingest]', { code: error instanceof Error ? error.message.split(':')[0] : 'unknown' });
    return json({ ok: false, error: error instanceof Error ? error.message.split(':')[0] : 'restore_failed' }, 500);
  }
});
