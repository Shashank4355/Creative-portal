// Local stand-in for Supabase's API layer. The portal sends the signed-in user's id;
// every query runs as role "authenticated" with that user's JWT claims, so the RLS
// policies decide what comes back. Bound to 127.0.0.1 only.
//   POST /query           read-only: one SELECT/WITH statement
//   POST /launch/request  strategist/manager asks for a test (RLS checks who and how much)
//   POST /launch/review   a manager approves/rejects (RLS refuses self-approval and non-managers)
// Nothing here can publish to Meta: that is the launcher job, the only holder of the
// ads_management token, and this process never loads .env.
import http from 'node:http';
import crypto from 'node:crypto';
import { openDb, asUser } from '../lib/db.js';
import { requestLaunch, review, LIMITS } from '../launch/launcher.js';

const db = await openDb();
const server = http.createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = async () => { let b = ''; for await (const c of req) b += c; return JSON.parse(b || '{}'); };
  const uid = req.headers['x-user-id'] || null;
  try {
    if (req.method === 'GET' && req.url === '/users') return send(200, (await db.query('select id, role, person from app_users order by role, person')).rows);
    if (req.method === 'POST' && req.url === '/query') {
      const { sql, params = [] } = await body();
      if (!/^\s*(select|with)\b/i.test(sql) || /;\s*\S/.test(sql)) return send(400, { error: 'read-only, single statement' });
      const r = await asUser(db, uid, (tx) => tx.query(sql, params));
      return send(200, r.rows);
    }
    if (req.method === 'POST' && req.url === '/launch/request') {
      if (!uid) return send(401, { error: 'sign in first' });
      const b = await body();
      const cents = Math.round(Number(b.dailyBudget) * 100);
      if (!/^FL_\d{6}_[A-Za-z0-9_-]+_C\d+$/.test(b.adName || '')) return send(400, { error: 'ad name must follow the tracker convention, e.g. FL_261124_CoolTouch_UGC_POV_ST-Priya_ED-Leo_C530' });
      if (!(cents > 0)) return send(400, { error: 'daily budget must be a positive amount' });
      const r = await requestLaunch(db, uid, {
        idempotencyKey: b.idempotencyKey || crypto.randomUUID(), adName: b.adName,
        campaignId: 'cmp_testing', creativeId: `cr_${b.adName.match(/_C(\d+)$/)[1]}`, dailyBudgetCents: cents,
      });
      return send(200, r);
    }
    if (req.method === 'POST' && req.url === '/launch/review') {
      if (!uid) return send(401, { error: 'sign in first' });
      const b = await body();
      if (!['approved', 'rejected'].includes(b.decision)) return send(400, { error: 'decision must be approved or rejected' });
      return send(200, await review(db, uid, Number(b.id), b.decision));
    }
    if (req.method === 'GET' && req.url === '/limits') return send(200, LIMITS);
    send(404, { error: 'not found' });
  } catch (e) {
    const denied = /row-level security|not allowed|permission denied|over the/.test(e.message);
    send(denied ? 403 : 400, { error: e.message });
  }
});
server.listen(4020, '127.0.0.1', () => console.log('db api on http://127.0.0.1:4020'));
