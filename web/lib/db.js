import { cookies } from 'next/headers';

// The portal never touches the database directly. It calls the data API (db/server.js,
// standing in for Supabase's API) with the signed-in user's id, and Postgres RLS
// decides what comes back.
const API = process.env.DB_API || 'http://127.0.0.1:4020';

// In production this is the Supabase session. Here a cookie picks the demo user.
export async function currentUid() {
  return (await cookies()).get('as')?.value || 'u-mgr-ana';
}

export async function q(sql, params = []) {
  const res = await fetch(`${API}/query`, {
    method: 'POST', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-user-id': await currentUid() },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body.map((row) => {
    for (const k of Object.keys(row)) if (typeof row[k] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row[k])) row[k] = new Date(row[k]);
    return row;
  });
}

export async function users() {
  return (await fetch(`${API}/users`, { cache: 'no-store' })).json();
}

export const money = (x) => '$' + Number(x || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const money2 = (x) => '$' + Number(x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ratio = (a, b, d = 2) => (Number(b) ? (Number(a) / Number(b)).toFixed(d) : '–');
export const pct = (a, b) => (Number(b) ? ((100 * Number(a)) / Number(b)).toFixed(1) + '%' : '–');
export const WIN = { minSpend: 1000, roas: 2.5 };
