import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

export const E2E_USERS = {
  a: { email: 'e2e-a@hub-giulia.local', password: 'E2E-Local-Only-2026-A!' },
  b: { email: 'e2e-b@hub-giulia.local', password: 'E2E-Local-Only-2026-B!' },
} as const;

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required isolated E2E env: ${name}`);
  return value;
}

export function anonClient() {
  return createClient(requiredEnv('E2E_SUPABASE_URL'), requiredEnv('E2E_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function adminClient() {
  return createClient(requiredEnv('E2E_SUPABASE_URL'), requiredEnv('E2E_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function signedInClient(which: keyof typeof E2E_USERS) {
  const client = anonClient();
  const credentials = E2E_USERS[which];
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) throw error;
  return client;
}

export async function browserLogin(page: Page, which: keyof typeof E2E_USERS = 'a') {
  const credentials = E2E_USERS[which];
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Senha').fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/agenda');
}
