import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.PG_DIR || path.resolve(import.meta.dirname, '../.data/pg');

export async function openDb({ fresh = false, dir = DATA_DIR } = {}) {
  if (fresh && dir !== 'memory://') fs.rmSync(dir, { recursive: true, force: true });
  if (dir !== 'memory://') fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = new PGlite(dir === 'memory://' ? undefined : dir);
  await db.waitReady;
  return db;
}

export async function applySchema(db) {
  await db.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
}

// Run fn with the same session state Supabase sets for a logged-in user:
// role "authenticated" plus the JWT claims that auth.uid() reads.
export async function asUser(db, uid, fn) {
  return db.transaction(async (tx) => {
    const claims = uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '';
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}

export const USERS = [
  { id: 'u-mgr-ana', email: 'ana@fernlow.example', role: 'manager', person: 'Ana' },
  { id: 'u-mgr-joel', email: 'joel@fernlow.example', role: 'manager', person: 'Joel' },
  { id: 'u-st-priya', email: 'priya@fernlow.example', role: 'strategist', person: 'Priya' },
  { id: 'u-st-marco', email: 'marco@fernlow.example', role: 'strategist', person: 'Marco' },
  { id: 'u-st-dana', email: 'dana@fernlow.example', role: 'strategist', person: 'Dana' },
  { id: 'u-st-sam', email: 'sam@fernlow.example', role: 'strategist', person: 'Sam' },
  { id: 'u-ed-leo', email: 'leo@fernlow.example', role: 'editor', person: 'Leo' },
  { id: 'u-ed-ines', email: 'ines@fernlow.example', role: 'editor', person: 'Ines' },
  { id: 'u-ed-kofi', email: 'kofi@fernlow.example', role: 'editor', person: 'Kofi' },
  { id: 'u-ed-mei', email: 'mei@fernlow.example', role: 'editor', person: 'Mei' },
  { id: 'u-ed-ruth', email: 'ruth@fernlow.example', role: 'editor', person: 'Ruth' },
];
