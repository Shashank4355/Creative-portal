// Local stand-in for Supabase's API layer. The portal sends the signed-in user's id;
// every query runs as role "authenticated" with that user's JWT claims, so the RLS
// policies decide what comes back. Bound to 127.0.0.1 only. Read-only: SELECT/WITH.
import http from 'node:http';
import { openDb, asUser } from '../lib/db.js';

const db = await openDb();
const server = http.createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (req.method === 'GET' && req.url === '/users') return send(200, (await db.query('select id, role, person from app_users order by role, person')).rows);
    if (req.method !== 'POST' || req.url !== '/query') return send(404, { error: 'not found' });
    let b = ''; for await (const c of req) b += c;
    const { sql, params = [] } = JSON.parse(b);
    if (!/^\s*(select|with)\b/i.test(sql) || /;\s*\S/.test(sql)) return send(400, { error: 'read-only, single statement' });
    const uid = req.headers['x-user-id'] || null;
    const r = await asUser(db, uid, (tx) => tx.query(sql, params));
    send(200, r.rows);
  } catch (e) { send(400, { error: e.message }); }
});
server.listen(4020, '127.0.0.1', () => console.log('db api on http://127.0.0.1:4020'));
