import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// The authoritative source remains ANVISA. GitHub Actions mirrors and validates
// the official CSV because dados.anvisa.gov.br currently presents a TLS chain
// that Supabase Edge Runtime does not trust. The mirror is owned by this repo.
const SOURCE_URL = 'https://github.com/joaopauloalho/hub-giulia/releases/download/anvisa-data-current/anvisa-medications.csv';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type CatalogRow = {
  source_key: string;
  registration_number: string | null;
  product_name: string;
  active_ingredient: string | null;
  company_name: string | null;
  company_cnpj: string | null;
  category: string | null;
  therapeutic_class: string | null;
  registration_status: string;
  registration_expiry: string | null;
  process_number: string | null;
  source_name: 'ANVISA';
  source_updated_at: string;
  sync_run_id: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseCsv(input: string, delimiter = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      field = '';
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some(value => value.length > 0)) rows.push(row);
  }
  return rows;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseCompany(value: string | undefined) {
  const raw = (value ?? '').trim();
  if (!raw) return { name: null, cnpj: null };
  const match = raw.match(/^([\d./-]{14,18})\s*-\s*(.+)$/);
  if (!match) return { name: raw, cnpj: null };
  return { name: match[2].trim() || raw, cnpj: match[1].trim() || null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'server_configuration_error' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Normal use requires an authenticated Hub user. The no-header path exists
  // only for the one-time empty-catalog bootstrap; production is deployed with
  // platform JWT verification enabled after bootstrap.
  const authorization = req.headers.get('Authorization');
  if (authorization) {
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);
  } else {
    const { data: statusRow, error: statusError } = await admin
      .from('medication_catalog_sync_status')
      .select('last_success_at')
      .eq('id', 1)
      .maybeSingle();
    if (statusError) return json({ error: 'sync_status_unavailable' }, 500);
    if (statusRow?.last_success_at) return json({ error: 'unauthorized' }, 401);
  }

  const { data: runId, error: claimError } = await admin.rpc('claim_medication_catalog_sync_v1');
  if (claimError) return json({ error: 'sync_claim_failed' }, 500);
  if (!runId) return json({ synced: false, reason: 'recent_or_in_progress' }, 202);

  try {
    const response = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Hub-Giulia/1.0 medication-catalog-sync' },
    });
    if (!response.ok) throw new Error(`ANVISA_MIRROR_HTTP_${response.status}`);

    const sourceLastModified = response.headers.get('last-modified');
    const sourceEtag = response.headers.get('etag');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 1_000_000) throw new Error('ANVISA_MIRROR_UNEXPECTEDLY_SMALL');
    const text = new TextDecoder('iso-8859-1').decode(bytes);
    const parsed = parseCsv(text);
    if (parsed.length < 2) throw new Error('ANVISA_CSV_EMPTY');

    const headers = parsed[0].map(value => value.replace(/^\uFEFF/, '').trim().toUpperCase());
    const indexOf = (name: string) => headers.indexOf(name);
    const get = (row: string[], name: string) => {
      const index = indexOf(name);
      return index >= 0 ? (row[index] ?? '').trim() : '';
    };

    const requiredHeaders = ['NOME_PRODUTO', 'SITUACAO_REGISTRO'];
    if (requiredHeaders.some(name => indexOf(name) < 0)) throw new Error('ANVISA_CSV_SCHEMA_CHANGED');

    const now = new Date().toISOString();
    const unique = new Map<string, CatalogRow>();

    for (const row of parsed.slice(1)) {
      const status = get(row, 'SITUACAO_REGISTRO');
      if (normalize(status) !== 'ativo') continue;

      const productName = get(row, 'NOME_PRODUTO');
      if (!productName) continue;

      const registrationNumber = get(row, 'NUMERO_REGISTRO_PRODUTO') || get(row, 'NUMERO_REGISTRO_MEDICAMENTO');
      const processNumber = get(row, 'NUMERO_PROCESSO');
      const activeIngredient = get(row, 'PRINCIPIO_ATIVO');
      const company = parseCompany(get(row, 'EMPRESA_DETENTORA_REGISTRO') || get(row, 'NOME_TITULAR_PRODUTO'));
      const sourceKey = [
        registrationNumber || processNumber || 'sem-registro',
        normalize(productName),
        normalize(activeIngredient),
      ].join('|');

      unique.set(sourceKey, {
        source_key: sourceKey,
        registration_number: registrationNumber || null,
        product_name: productName,
        active_ingredient: activeIngredient || null,
        company_name: company.name,
        company_cnpj: company.cnpj || get(row, 'NUMERO_CNPJ_TITULAR') || null,
        category: get(row, 'CATEGORIA_REGULATORIA') || null,
        therapeutic_class: get(row, 'CLASSE_TERAPEUTICA') || null,
        registration_status: status || 'Ativo',
        registration_expiry: parseDate(get(row, 'DATA_VENCIMENTO_REGISTRO')),
        process_number: processNumber || null,
        source_name: 'ANVISA',
        source_updated_at: now,
        sync_run_id: runId,
      });
    }

    const catalogRows = Array.from(unique.values());
    if (catalogRows.length < 1000) throw new Error('ANVISA_ACTIVE_ROWS_UNEXPECTEDLY_LOW');

    const batchSize = 400;
    for (let index = 0; index < catalogRows.length; index += batchSize) {
      const batch = catalogRows.slice(index, index + batchSize);
      const { error } = await admin
        .from('medication_catalog')
        .upsert(batch, { onConflict: 'source_key' });
      if (error) throw new Error(`CATALOG_UPSERT_FAILED:${error.message}`);
    }

    const { error: cleanupError } = await admin
      .from('medication_catalog')
      .delete()
      .neq('sync_run_id', runId);
    if (cleanupError) throw new Error(`CATALOG_CLEANUP_FAILED:${cleanupError.message}`);

    const { error: finishError } = await admin.rpc('finish_medication_catalog_sync_v1', {
      p_run_id: runId,
      p_imported_rows: catalogRows.length,
      p_source_last_modified: sourceLastModified,
      p_source_etag: sourceEtag,
      p_error: null,
    });
    if (finishError) throw new Error(`SYNC_FINISH_FAILED:${finishError.message}`);

    return json({ synced: true, importedRows: catalogRows.length, source: 'ANVISA' });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'UNKNOWN_SYNC_ERROR';
    await admin.rpc('finish_medication_catalog_sync_v1', {
      p_run_id: runId,
      p_imported_rows: 0,
      p_source_last_modified: null,
      p_source_etag: null,
      p_error: message,
    });
    console.error('[sync-anvisa-medications]', message);
    return json({ error: 'sync_failed' }, 502);
  }
});
