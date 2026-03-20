import { mustEnv } from './env.js';

export type AccountDTO = {
  id: string;
  xUsername: string;
  enabled: boolean;
  sinceId: string | null;
};

export type RunResultDTO = {
  accountsTotal: number;
  accountsProcessed: number;
  tweetsInserted: number;
  errors: Array<{ xUsername: string; error: string }>;
};

function baseUrl() {
  return mustEnv('API_BASE_URL').replace(/\/$/, '');
}

function headers() {
  return {
    authorization: `Bearer ${mustEnv('API_TOKEN')}`,
    'content-type': 'application/json',
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = baseUrl() + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...headers(),
    },
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || json?.detail || `${res.status} ${res.statusText}`;
    throw new Error(`API error: ${msg}`);
  }

  return json as T;
}

export async function apiListAccounts() {
  return apiFetch<{ ok: true; accounts: AccountDTO[] }>('/admin/accounts');
}

export async function apiGetAccount(id: string) {
  return apiFetch<{ ok: true; account: AccountDTO }>(`/admin/accounts/${encodeURIComponent(id)}`);
}

export async function apiAddAccount(xUsername: string) {
  return apiFetch<{ ok: true; account: AccountDTO }>('/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ x_username: xUsername }),
  });
}

export async function apiToggleAccount(id: string, enabled: boolean) {
  return apiFetch<{ ok: true; account: AccountDTO }>(`/admin/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function apiDeleteAccount(id: string) {
  return apiFetch<{ ok: true }>(`/admin/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function apiRunWorker() {
  return apiFetch<{ ok: true; result: RunResultDTO }>('/admin/run', { method: 'POST' });
}
