import { cookies } from 'next/headers';

// The portal never touches the database directly. It calls the data API (db/server.js,
// standing in for Supabase's API) with the signed-in user's id, and Postgres RLS
// decides what comes back.
const API = process.env.DB_API || 'http://127.0.0.1:4020';

// In production this is the Supabase session. Here a cookie picks the demo user.
export async function currentUid() {
  return (await cookies()).get('as')?.value || 'u-mgr-ana';
}

const revive = (row) => {
  for (const k of Object.keys(row)) if (typeof row[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row[k])) row[k] = new Date(row[k]);
  return row;
};

// `as` lets the Controls page run the same query as another user (or '' for anonymous)
// to show what RLS returns for each role. Every other page runs as the signed-in user.
export async function q(sql, params = [], { as } = {}) {
  const uid = as === undefined ? await currentUid() : as;
  const res = await fetch(`${API}/query`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body.map(revive);
}

export async function post(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-user-id': await currentUid() },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

export async function users() {
  return (await fetch(`${API}/users`, { cache: 'no-store' })).json();
}

export async function me() {
  const [m] = await q('select id, role, person from app_users where id = auth.uid()');
  return m;
}

// ---- formatting ----
const n = (x) => Number(x || 0);
export const money = (x) => '$' + n(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const money2 = (x) => '$' + n(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const compact = (x) => {
  const v = n(x), a = Math.abs(v);
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
};
export const ratio = (a, b, d = 2) => (n(b) ? (n(a) / n(b)).toFixed(d) : '–');
export const pct = (a, b, d = 1) => (n(b) ? ((100 * n(a)) / n(b)).toFixed(d) + '%' : '–');
export const num = (x) => n(x).toLocaleString('en-US');
export const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
export const day = (d) => new Date(iso(d) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---- business rules (shown on the pages that use them) ----
export const WIN = { minSpend: 1000, roas: 2.5, tested: 300, loser: 1.6 };
export function verdict(r) {
  const spend = n(r.spend), roas = spend ? n(r.purchase_value) / spend : 0;
  if (spend >= WIN.minSpend && roas >= WIN.roas) return { key: 'winner', label: 'Winner', tone: 'pass' };
  if (spend < WIN.tested) return { key: 'early', label: 'Too little spend', tone: 'info' };
  return roas < WIN.loser ? { key: 'loser', label: 'Loser', tone: 'fail' } : { key: 'middle', label: 'Middle', tone: 'warn' };
}
export const PERSON_OK = ['name_code', 'sheet_ad_id'];
