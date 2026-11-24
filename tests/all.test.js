// node --test tests/   (mock APIs must be running: node mock/server.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb, applySchema, asUser, USERS } from '../lib/db.js';
import { parseInsight, metaGetAll, metaInsightsUrl } from '../lib/clients.js';
import { matchCreatives, shopifyDaily, reconcile, pull } from '../sync/run.js';
import { requestLaunch, review, publishApproved, LIMITS } from '../launch/launcher.js';
import { loadEnv } from '../lib/env.js';

loadEnv();
process.env.BACKOFF_UNIT_MS = '50';
const env = process.env;
const summary = JSON.parse(fs.readFileSync('out/sync_summary.json', 'utf8'));

// ---------- data ----------
test('data: purchase counted once, not three times', () => {
  const row = { date_start: '2026-11-01', spend: '10.00', impressions: '500', inline_link_clicks: '7',
    actions: [{ action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '2' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }],
    action_values: [{ action_type: 'purchase', value: '240.00' }, { action_type: 'omni_purchase', value: '240.00' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '240.00' }] };
  assert.equal(parseInsight(row).purchases, 2);
  assert.equal(parseInsight(row).purchase_value, 240);
  assert.equal(parseInsight(row, { sumAllPurchaseTypes: true }).purchase_value, 720);
});

test('data: ad-level pull matches account total on every day', async () => {
  const { accountRows, adRows } = await pull();
  const rec = reconcile(accountRows, adRows);
  assert.equal(rec.length, 30);
  assert.ok(rec.every((x) => x.ok), rec.filter((x) => !x.ok).map((x) => x.date).join(','));
});

test('data: without the effective_status filter, archived/deleted ads go missing and the check catches it', async () => {
  const { accountRows, adRows } = await pull({ naive: true });
  const rec = reconcile(accountRows, adRows);
  assert.ok(rec.some((x) => !x.ok));
  assert.ok(summary.naive.spend < summary.account_total.spend);
});

test('data: sheet join handles messy codes, legacy names, orphans and conflicts', () => {
  const adRows = [
    { ad_id: '1', ad_name: 'FL_261101_X_UGC_Q_ST-Priya_ED-Leo_C900' },
    { ad_id: '2', ad_name: 'Fernlow - HotelBed UGC v2' },
    { ad_id: '3', ad_name: 'FL_261101_X_UGC_Q_ST-Sam_ED-Mei_C901' },
    { ad_id: '4', ad_name: 'FL_261101_X_UGC_Q_ST-Sam_ED-Mei_C902' },
  ];
  const H = ['Creative Code', 'Ad ID', 'Concept', 'Format', 'Hook', 'Strategist', 'Editor', 'Launch Date', 'Status'];
  const sheet = [H,
    [' c900', '', 'X', 'UGC', 'Q', 'priya ', 'Leo', '2026-11-01', 'Live'],
    ['', '2', 'HotelBed', 'UGC', 'Q', 'Marco', 'Ines', '2026-10-23', 'Off'],
    ['C902', '', 'X', 'UGC', 'Q', 'Sam', 'Mei', '2026-11-01', 'Live'],
    ['C902', '', 'X', 'UGC', 'Q', 'Dana', 'Mei', '2026-11-01', 'Live']];
  const m = Object.fromEntries(matchCreatives(adRows, sheet).map((c) => [c.ad_id, c]));
  assert.equal(m['1'].match_method, 'name_code'); assert.equal(m['1'].strategist, 'Priya');
  assert.equal(m['2'].match_method, 'sheet_ad_id');
  assert.equal(m['3'].match_method, 'unmatched');
  assert.equal(m['4'].match_method, 'conflict');
});

test('data: Shopify net sales exclude tax, shipping, refunds and test orders', () => {
  const o = (x) => ({ created_at: '2026-11-02T10:00:00-05:00', subtotal_price: '100.00', total_tax: '7.00', total_shipping: '9.95', refunded_amount: '0.00', landing_site: '/', test: false, ...x });
  const d = shopifyDaily([o({}), o({ refunded_amount: '100.00' }), o({ test: true }), o({ landing_site: '/?utm_source=facebook&utm_content=1' })])['2026-11-02'];
  assert.equal(d.orders, 3); assert.equal(d.net_sales, 200); assert.equal(d.meta_utm_orders, 1);
});

test('data: throttling (#80000) is retried, not surfaced as missing data', async () => {
  const before = (await (await fetch('http://127.0.0.1:4010/__state')).json()).calls.insights;
  const rows = await metaGetAll(metaInsightsUrl({ base: env.META_BASE, account: env.META_AD_ACCOUNT, token: env.META_READ_TOKEN, level: 'ad', since: '2026-10-23', until: '2026-11-21' }));
  const after = (await (await fetch('http://127.0.0.1:4010/__state')).json()).calls.insights;
  assert.equal(rows.length, 940);
  assert.ok(after - before >= 5);
});

// ---------- access ----------
async function seeded() {
  const db = await openDb({ dir: 'memory://' });
  await applySchema(db);
  for (const u of USERS) await db.query('insert into app_users values ($1,$2,$3,$4)', [u.id, u.email, u.role, u.person]);
  await db.query(`insert into creatives values ('a1','n1','C1',null,null,null,'Priya','Leo',null,'name_code',null), ('a2','n2','C2',null,null,null,'Marco','Mei',null,'name_code',null)`);
  await db.query(`insert into ad_daily(date,ad_id,spend,impressions,clicks,video_3s,thruplays,purchases,purchase_value) values ('2026-11-01','a1',100,1,1,1,1,1,200), ('2026-11-01','a2',50,1,1,1,1,1,90)`);
  await db.query(`insert into account_daily values ('2026-11-01',150,2,290)`);
  await db.query(`insert into published_dates(date) values ('2026-11-01')`);
  return db;
}
const ids = async (db, uid, sql) => (await asUser(db, uid, (tx) => tx.query(sql))).rows;

test('access: strategist sees only own creatives and spend', async () => {
  const db = await seeded();
  assert.deepEqual((await ids(db, 'u-st-priya', 'select ad_id from ad_daily')).map((r) => r.ad_id), ['a1']);
  assert.deepEqual((await ids(db, 'u-st-priya', 'select ad_id from creative_perf')).map((r) => r.ad_id), ['a1']);
});
test('access: editor sees only creatives they cut', async () => {
  const db = await seeded();
  assert.deepEqual((await ids(db, 'u-ed-mei', 'select ad_id from creatives')).map((r) => r.ad_id), ['a2']);
});
test('access: manager sees everything; others cannot read account revenue', async () => {
  const db = await seeded();
  assert.equal((await ids(db, 'u-mgr-ana', 'select * from creatives')).length, 2);
  assert.equal((await ids(db, 'u-st-priya', 'select * from account_daily')).length, 0);
  assert.equal((await ids(db, 'u-ed-leo', 'select * from shopify_daily')).length, 0);
});
test('access: data checks carry revenue, so only managers read amounts; others get pass/fail only', async () => {
  const db = await seeded();
  await db.query(`insert into sync_runs(status) values ('ok')`);
  await db.query(`insert into data_checks values (1,'2026-11-01','meta_vs_shopify','info',60809.58,37700.4,'Shopify net sales $60809.58')`);
  await db.query(`insert into sync_compare values (1,'quick',100,3,720,0,1,'x'), (1,'checked',150,2,290,1,1,'y')`);
  assert.equal((await ids(db, 'u-mgr-ana', 'select * from data_checks')).length, 1);
  assert.equal((await ids(db, 'u-mgr-ana', 'select * from sync_compare')).length, 2);
  for (const uid of ['u-st-priya', 'u-ed-leo']) {
    assert.equal((await ids(db, uid, 'select * from data_checks')).length, 0);
    assert.equal((await ids(db, uid, 'select * from sync_compare')).length, 0);
    const st = await ids(db, uid, 'select * from check_status()');
    assert.deepEqual(Object.keys(st[0]).sort(), ['check_name', 'date', 'status']);
  }
  await assert.rejects(() => ids(db, null, 'select * from check_status()'), /permission denied/);
});
test('access: anonymous gets nothing', async () => {
  const db = await seeded();
  await assert.rejects(() => ids(db, null, 'select * from creatives'), /permission denied/);
});
test('access: editors cannot request launches', async () => {
  const db = await seeded();
  await assert.rejects(() => requestLaunch(db, 'u-ed-leo', { idempotencyKey: 'k', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 1000 }), /row-level security/);
});

// ---------- money ----------
test('money: nobody approves their own request, and only managers approve', async () => {
  const db = await seeded();
  const { id } = await requestLaunch(db, 'u-mgr-ana', { idempotencyKey: 'self', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 1000 });
  await assert.rejects(() => review(db, 'u-mgr-ana', id, 'approved'), /row-level security|not allowed/);
  const r2 = await requestLaunch(db, 'u-st-priya', { idempotencyKey: 'p1', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 1000 });
  await assert.rejects(() => review(db, 'u-st-marco', r2.id, 'approved'), /not allowed/);
  assert.equal((await review(db, 'u-mgr-joel', r2.id, 'approved')).status, 'approved');
});
test('money: reviewers cannot raise the budget while approving', async () => {
  const db = await seeded();
  const { id } = await requestLaunch(db, 'u-st-priya', { idempotencyKey: 'b1', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 1000 });
  await assert.rejects(() => asUser(db, 'u-mgr-ana', (tx) => tx.query(`update launch_requests set daily_budget_cents = 40000 where id = $1`, [id])), /permission denied/);
});
test('money: over-cap budgets are refused in code and in the database', async () => {
  const db = await seeded();
  await assert.rejects(() => requestLaunch(db, 'u-st-priya', { idempotencyKey: 'big', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 90000 }), /cap/);
  await assert.rejects(() => db.query(`insert into launch_requests(idempotency_key, requested_by, ad_name, campaign_id, creative_id, daily_budget_cents) values ('raw','u-st-priya','x','c','cr',90000)`), /check constraint/);
});
test('money: double-submit creates one request', async () => {
  const db = await seeded();
  const a = await requestLaunch(db, 'u-st-sam', { idempotencyKey: 'same', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 1000 });
  const b = await requestLaunch(db, 'u-st-sam', { idempotencyKey: 'same', adName: 'x', campaignId: 'c', creativeId: 'cr', dailyBudgetCents: 1000 });
  assert.equal(a.id, b.id); assert.equal(b.duplicate, true);
});

test('money: publish creates everything PAUSED, holds back over the daily cap, survives #80004, and reruns create nothing new', async () => {
  await fetch('http://127.0.0.1:4010/__reset');
  const db = await seeded();
  const strategists = ['u-st-priya', 'u-st-marco', 'u-st-dana', 'u-st-sam'];
  for (let i = 0; i < 8; i++) {
    const { id } = await requestLaunch(db, strategists[i % 4], { idempotencyKey: `L${i}`, adName: `FL_261122_Test_UGC_Q_C${950 + i}`, campaignId: 'cmp_testing', creativeId: `cr${i}`, dailyBudgetCents: 45000 });
    await review(db, 'u-mgr-ana', id, 'approved');
  }
  const dry = await publishApproved(db, { dryRun: true });
  assert.equal((await (await fetch('http://127.0.0.1:4010/__state')).json()).created.length, 0, 'dry run must not call Meta');
  assert.equal(dry.created.length, 6);
  const live = await publishApproved(db, { dryRun: false });
  assert.equal(live.created.length, 6, JSON.stringify(live));
  assert.equal(live.skipped.length, 2);
  const st = await (await fetch('http://127.0.0.1:4010/__state')).json();
  assert.ok(st.created.every((o) => o.status === 'PAUSED'));
  assert.equal(st.created.filter((o) => o.kind === 'ad').length, 6);
  assert.ok(st.created.filter((o) => o.kind === 'adset').reduce((s, o) => s + o.daily_budget, 0) <= LIMITS.maxNewDailyTotalCents);
  const again = await publishApproved(db, { dryRun: false });
  assert.equal(again.created.length, 0);
  assert.equal((await (await fetch('http://127.0.0.1:4010/__state')).json()).created.length, st.created.length);
  fs.writeFileSync('out/launch_report.json', JSON.stringify({ dry, live, again, meta_objects: st.created }, null, 2));
});
test('money: kill switch stops publishing', async () => {
  const db = await seeded();
  const r = await publishApproved(db, { dryRun: false, env: { ...env, LAUNCH_KILL_SWITCH: 'on' } });
  assert.equal(r.skipped[0].reason, 'kill switch on');
});
test('money: the read-only token cannot create ads', async () => {
  const r = await fetch(`${env.META_BASE}/${env.META_AD_ACCOUNT}/ads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', access_token: env.META_READ_TOKEN }) });
  assert.equal(r.status, 403);
});
test('access: no tokens in source files', () => {
  for (const f of ['lib/clients.js', 'sync/run.js', 'launch/launcher.js']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /mock-(read|manage|shopify|sheets)-token|EAA[A-Za-z0-9]{20,}|shpat_/);
  }
});
