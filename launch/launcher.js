// Ad launcher with money guards.
//   - strategists request, a different manager approves (enforced by RLS, not just the UI)
//   - per-test and per-day budget caps, checked in the database and again here
//   - everything is created PAUSED; going live is a manager's click in Ads Manager
//   - kill switch, dry-run by default, idempotent retries, throttle backoff
//   - the ads_management token is only ever read here, never by the sync or the portal
import { asUser } from '../lib/db.js';
import { redact } from '../lib/env.js';

export const LIMITS = {
  maxTestDailyCents: 50000,       // $500/day per new test ad set
  maxNewDailyTotalCents: 300000,  // $3,000/day of new test budget across all launches
  maxLaunchesPerRun: 20,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function requestLaunch(db, uid, { idempotencyKey, adName, campaignId, creativeId, dailyBudgetCents }) {
  if (dailyBudgetCents > LIMITS.maxTestDailyCents) throw new Error(`budget ${dailyBudgetCents / 100} is over the $${LIMITS.maxTestDailyCents / 100}/day test cap`);
  return asUser(db, uid, async (tx) => {
    const r = await tx.query(
      `insert into launch_requests(idempotency_key, requested_by, ad_name, campaign_id, creative_id, daily_budget_cents)
       values ($1, auth.uid(), $2, $3, $4, $5) on conflict (idempotency_key) do nothing returning id`,
      [idempotencyKey, adName, campaignId, creativeId, dailyBudgetCents]);
    if (r.rows[0]) return { id: r.rows[0].id, duplicate: false };
    const existing = await tx.query('select id from launch_requests where idempotency_key = $1', [idempotencyKey]);
    return { id: existing.rows[0]?.id, duplicate: true };
  });
}

export async function review(db, uid, id, decision) {
  return asUser(db, uid, async (tx) => {
    const r = await tx.query(`update launch_requests set status = $2, reviewed_by = auth.uid() where id = $1 returning id, status`, [id, decision]);
    if (!r.rows.length) throw new Error(`not allowed to review request ${id}`);
    return r.rows[0];
  });
}

async function metaPost(url, body, log) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!j.error) return j;
    if ([17, 613, 80004].includes(j.error.code)) { log(`meta #${j.error.code}, backing off`); await sleep(2 ** attempt * 200); continue; }
    throw new Error(redact(`Meta ${j.error.code}: ${j.error.message}`));
  }
  throw new Error('gave up after repeated throttling');
}

// Service job: runs with the table owner's rights (Supabase service role), after review.
export async function publishApproved(db, { env = process.env, dryRun = true, log = () => {} } = {}) {
  const report = { created: [], skipped: [], failed: [], dryRun };
  if ((env.LAUNCH_KILL_SWITCH || 'off') !== 'off') { report.skipped.push({ reason: 'kill switch on' }); return report; }
  const today = (await db.query(`select coalesce(sum(daily_budget_cents),0)::int c from launch_requests where status='created' and created_at::date = current_date`)).rows[0].c;
  const queue = (await db.query(`select * from launch_requests where status='approved' and meta_ad_id is null order by id limit $1`, [LIMITS.maxLaunchesPerRun])).rows;
  let committed = today;
  for (const q of queue) {
    if (q.reviewed_by === q.requested_by) { report.skipped.push({ id: q.id, reason: 'self-approved' }); continue; }
    if (q.daily_budget_cents > LIMITS.maxTestDailyCents) { report.skipped.push({ id: q.id, reason: 'over per-test cap' }); continue; }
    if (committed + q.daily_budget_cents > LIMITS.maxNewDailyTotalCents) {
      const reason = `held: over $${LIMITS.maxNewDailyTotalCents / 100}/day new-test cap`;
      if (!dryRun) await db.query('update launch_requests set error=$2 where id=$1', [q.id, reason]);
      report.skipped.push({ id: q.id, reason }); continue;
    }
    if (dryRun) { report.created.push({ id: q.id, dryRun: true, would: { name: q.ad_name, daily_budget: q.daily_budget_cents, status: 'PAUSED' } }); committed += q.daily_budget_cents; continue; }
    try {
      const base = `${env.META_BASE}/${env.META_AD_ACCOUNT}`;
      const adset = q.meta_adset_id ? { id: q.meta_adset_id } : await metaPost(`${base}/adsets`, {
        name: `TEST | ${q.ad_name}`, campaign_id: q.campaign_id, daily_budget: q.daily_budget_cents, billing_event: 'IMPRESSIONS',
        optimization_goal: 'OFFSITE_CONVERSIONS', status: 'PAUSED', access_token: env.META_MANAGE_TOKEN }, log);
      await db.query('update launch_requests set meta_adset_id=$2 where id=$1', [q.id, adset.id]); // so a retry never makes a second ad set
      const ad = await metaPost(`${base}/ads`, { name: q.ad_name, adset_id: adset.id, creative: { creative_id: q.creative_id }, status: 'PAUSED', access_token: env.META_MANAGE_TOKEN }, log);
      await db.query(`update launch_requests set meta_ad_id=$2, status='created' where id=$1`, [q.id, ad.id]);
      await db.query(`insert into audit_log(actor, action, detail) values ('launcher', 'created_paused', $1)`, [JSON.stringify({ request: q.id, adset: adset.id, ad: ad.id, budget_cents: q.daily_budget_cents })]);
      committed += q.daily_budget_cents;
      report.created.push({ id: q.id, adset: adset.id, ad: ad.id });
    } catch (e) {
      await db.query(`update launch_requests set status='failed', error=$2 where id=$1`, [q.id, e.message]);
      report.failed.push({ id: q.id, error: e.message });
    }
  }
  return report;
}
