// Nightly sync: Meta (ad + account level) + creative tracker sheet + Shopify -> Postgres.
// A day reaches the leaderboard only when ad-level rows add up to Meta's own account total.
import fs from 'node:fs';
import { loadEnv } from '../lib/env.js';
import { metaGetAll, metaInsightsUrl, parseInsight, sheetValues, shopifyOrders, stats } from '../lib/clients.js';
import { openDb, applySchema, USERS } from '../lib/db.js';

loadEnv();
const E = process.env;
const SINCE = E.SYNC_SINCE || '2026-10-23', UNTIL = E.SYNC_UNTIL || '2026-11-21';
const log = (m) => console.log(`[sync] ${m}`);
const r2 = (x) => Math.round(x * 100) / 100;

export const norm = (s) => String(s ?? '').trim();
export const normName = (s) => { const t = norm(s).toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
export const codeFromName = (name) => name.match(/_(C\d+)$/i)?.[1].toUpperCase() || null;

export function matchCreatives(adRows, sheet) {
  const [header, ...rows] = sheet;
  const col = (n) => header.indexOf(n);
  const recs = rows.map((r) => ({
    code: norm(r[col('Creative Code')]).toUpperCase(), ad_id: norm(r[col('Ad ID')]),
    concept: norm(r[col('Concept')]), format: norm(r[col('Format')]), hook: norm(r[col('Hook')]),
    strategist: normName(r[col('Strategist')]), editor: normName(r[col('Editor')]), launch_date: norm(r[col('Launch Date')]) || null,
  }));
  const byCode = {}, byAdId = {};
  for (const r of recs) { if (r.code) (byCode[r.code] ||= []).push(r); if (r.ad_id) byAdId[r.ad_id] = r; }
  const ads = {};
  for (const row of adRows) ads[row.ad_id] ||= row.ad_name;
  const out = [];
  for (const [ad_id, ad_name] of Object.entries(ads)) {
    const code = codeFromName(ad_name);
    const hits = code ? byCode[code] || [] : [];
    const owners = new Set(hits.map((h) => `${h.strategist}|${h.editor}`));
    if (hits.length && owners.size > 1) {
      out.push({ ad_id, ad_name, code, match_method: 'conflict', note: `sheet has ${hits.length} rows for ${code} with different owners: ${[...owners].join(' vs ')}` });
    } else if (hits.length) {
      out.push({ ...hits[0], ad_id, ad_name, code, match_method: 'name_code' });
    } else if (byAdId[ad_id]) {
      out.push({ ...byAdId[ad_id], ad_id, ad_name, match_method: 'sheet_ad_id', note: 'legacy ad name, matched on Ad ID column' });
    } else {
      out.push({ ad_id, ad_name, code, match_method: 'unmatched', note: code ? `code ${code} not in tracker sheet` : 'no code in ad name and no Ad ID in sheet' });
    }
  }
  return out;
}

export function shopifyDaily(orders) {
  const by = {};
  for (const o of orders) {
    if (o.test) continue;                       // brand's own test orders
    const d = o.created_at.slice(0, 10);       // created_at is already in shop time
    const b = (by[d] ||= { orders: 0, net_sales: 0, refunds: 0, meta_utm_orders: 0, meta_utm_net_sales: 0 });
    const net = Number(o.subtotal_price) - Number(o.refunded_amount); // net sales: no tax, no shipping
    b.orders++; b.net_sales += net; b.refunds += Number(o.refunded_amount);
    if (/utm_source=facebook/.test(o.landing_site || '')) { b.meta_utm_orders++; b.meta_utm_net_sales += net; }
  }
  return by;
}

export async function pull({ naive = false } = {}) {
  const base = { base: E.META_BASE, account: E.META_AD_ACCOUNT, token: E.META_READ_TOKEN, since: SINCE, until: UNTIL };
  const accountRows = (await metaGetAll(metaInsightsUrl({ ...base, level: 'account' }), { log })).map((r) => parseInsight(r));
  const adRows = (await metaGetAll(metaInsightsUrl({ ...base, level: 'ad', includeArchived: !naive }), { log }))
    .map((r) => parseInsight(r, { sumAllPurchaseTypes: naive }));
  return { accountRows, adRows };
}

export function reconcile(accountRows, adRows) {
  const sum = {};
  for (const r of adRows) { const s = (sum[r.date] ||= { spend: 0, purchases: 0, purchase_value: 0 }); s.spend += r.spend; s.purchases += r.purchases; s.purchase_value += r.purchase_value; }
  return accountRows.map((a) => {
    const s = sum[a.date] || { spend: 0, purchases: 0, purchase_value: 0 };
    const ok = Math.abs(r2(s.spend) - a.spend) <= 0.01 && s.purchases === a.purchases && Math.abs(r2(s.purchase_value) - a.purchase_value) <= 0.01;
    return { date: a.date, ok, account: a, adSum: { spend: r2(s.spend), purchases: s.purchases, purchase_value: r2(s.purchase_value) } };
  });
}

async function main() {
  const t0 = Date.now();
  // 1. what a quick first version gets wrong
  const naive = await pull({ naive: true });
  const naiveRec = reconcile(naive.accountRows, naive.adRows);
  // 2. the real pull
  const { accountRows, adRows } = await pull();
  const rec = reconcile(accountRows, adRows);
  const sheet = await sheetValues({ base: E.SHEETS_BASE, sheetId: E.SHEET_ID, range: 'Tracker!A1:I', token: E.SHEETS_TOKEN });
  const creatives = matchCreatives(adRows, sheet);
  const orders = await shopifyOrders({ base: E.SHOPIFY_BASE, token: E.SHOPIFY_TOKEN, min: `${SINCE}T00:00:00-04:00`, max: `${UNTIL}T23:59:59-05:00`, log });
  const shop = shopifyDaily(orders);

  const db = await openDb({ fresh: true });
  await applySchema(db);
  for (const u of USERS) await db.query('insert into app_users values ($1,$2,$3,$4)', [u.id, u.email, u.role, u.person]);
  const run = (await db.query(`insert into sync_runs(status) values ('running') returning id`)).rows[0].id;

  for (const c of creatives) {
    await db.query(`insert into creatives values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.ad_id, c.ad_name, c.code, c.concept || null, c.format || null, c.hook || null, c.strategist || null, c.editor || null, c.launch_date || null, c.match_method, c.note || null]);
  }
  for (const r of adRows) {
    await db.query(`insert into ad_daily(date,ad_id,spend,impressions,clicks,video_3s,thruplays,purchases,purchase_value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (date, ad_id) do update set spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, video_3s=excluded.video_3s,
      thruplays=excluded.thruplays, purchases=excluded.purchases, purchase_value=excluded.purchase_value, pulled_at=now()`,
      [r.date, r.ad_id, r.spend, r.impressions, r.clicks, r.video_3s, r.thruplays, r.purchases, r.purchase_value]);
  }
  for (const a of accountRows) await db.query('insert into account_daily values ($1,$2,$3,$4)', [a.date, a.spend, a.purchases, a.purchase_value]);
  for (const [d, b] of Object.entries(shop)) await db.query('insert into shopify_daily values ($1,$2,$3,$4,$5,$6)', [d, b.orders, r2(b.net_sales), r2(b.refunds), b.meta_utm_orders, r2(b.meta_utm_net_sales)]);

  const status = Object.fromEntries(creatives.map((c) => [c.ad_id, c.match_method]));
  const check = (date, name, st, expected, actual, detail) => db.query('insert into data_checks values ($1,$2,$3,$4,$5,$6,$7)', [run, date, name, st, expected, actual, detail]);
  let published = 0;
  for (const x of rec) {
    await check(x.date, 'meta_spend_matches_account', x.ok ? 'pass' : 'fail', x.account.spend, x.adSum.spend,
      x.ok ? 'ad-level rows add up to the account total' : `ad-level ${x.adSum.spend} vs account ${x.account.spend}`);
    const day = adRows.filter((r) => r.date === x.date);
    const bad = day.filter((r) => status[r.ad_id] === 'unmatched' || status[r.ad_id] === 'conflict');
    const badSpend = r2(bad.reduce((s, r) => s + r.spend, 0));
    const share = x.account.spend ? badSpend / x.account.spend : 0;
    await check(x.date, 'spend_credited_to_a_person', share <= 0.01 ? 'pass' : share <= 0.05 ? 'warn' : 'fail', x.account.spend, r2(x.account.spend - badSpend),
      bad.length ? `$${badSpend} on ${bad.length} ad(s) not credited until the sheet is fixed` : 'all spend credited');
    const s = shop[x.date];
    if (s) await check(x.date, 'meta_vs_shopify', 'info', r2(s.net_sales), x.account.purchase_value,
      `Meta claims $${x.account.purchase_value} (7d click + 1d view). Shopify net sales $${r2(s.net_sales)}, UTM-tagged from Meta $${r2(s.meta_utm_net_sales)}`);
    if (x.ok) { await db.query('insert into published_dates(date, run_id) values ($1,$2)', [x.date, run]); published++; }
  }
  // keep what a quick pull would have reported next to the checked numbers, for the Data checks page
  const sumOf = (rows, k) => r2(rows.reduce((s, r) => s + r[k], 0));
  for (const [method, rows, recs, note] of [
    ['quick', naive.adRows, naiveRec, 'purchase + omni_purchase + fb_pixel_purchase summed; archived and deleted ads not requested'],
    ['checked', adRows, rec, 'one purchase type counted; archived and deleted ads included; every day reconciled to the account total'],
  ]) {
    await db.query('insert into sync_compare values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [run, method, sumOf(rows, 'spend'), sumOf(rows, 'purchases'), sumOf(rows, 'purchase_value'), recs.filter((x) => x.ok).length, recs.length, note]);
  }

  await db.query(`update sync_runs set finished_at=now(), status=$2, meta_calls=$3, meta_throttles=$4, shopify_calls=$5, shopify_429=$6 where id=$1`,
    [run, published === rec.length ? 'ok' : 'partial', stats.metaCalls, stats.metaThrottles, stats.shopifyCalls, stats.shopify429]);

  // summary file used by the README / PDF
  const tot = (rows, k) => r2(rows.reduce((s, r) => s + r[k], 0));
  const acct = { spend: tot(accountRows, 'spend'), purchases: tot(accountRows, 'purchases'), value: tot(accountRows, 'purchase_value') };
  const summary = {
    range: [SINCE, UNTIL],
    account_total: { ...acct, roas: r2(acct.value / acct.spend) },
    naive: { spend: tot(naive.adRows, 'spend'), purchases: tot(naive.adRows, 'purchases'), value: tot(naive.adRows, 'purchase_value'),
      roas: r2(tot(naive.adRows, 'purchase_value') / tot(naive.adRows, 'spend')), days_matching: naiveRec.filter((x) => x.ok).length, days: naiveRec.length },
    guarded: { spend: tot(adRows, 'spend'), purchases: tot(adRows, 'purchases'), value: tot(adRows, 'purchase_value'),
      roas: r2(tot(adRows, 'purchase_value') / tot(adRows, 'spend')), days_matching: rec.filter((x) => x.ok).length, days: rec.length },
    creatives: creatives.reduce((m, c) => ((m[c.match_method] = (m[c.match_method] || 0) + 1), m), {}),
    shopify: { orders: orders.filter((o) => !o.test).length, test_orders_dropped: orders.filter((o) => o.test).length,
      net_sales: r2(Object.values(shop).reduce((s, b) => s + b.net_sales, 0)), meta_utm_net_sales: r2(Object.values(shop).reduce((s, b) => s + b.meta_utm_net_sales, 0)) },
    api: { ...stats },
    published_days: published, seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/sync_summary.json', JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary, null, 2));
  await db.close();
}

if (process.argv[1]?.endsWith('run.js')) main().catch((e) => { console.error(e.message); process.exit(1); });
