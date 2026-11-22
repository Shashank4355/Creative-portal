// API clients: Meta Marketing API (read), Google Sheets, Shopify Admin.
// Each one pages to the end, backs off on throttling and never logs a token.
import { redact } from './env.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Meta's estimated_time_to_regain_access is in minutes. The mock shortens it.
const BACKOFF_UNIT_MS = Number(process.env.BACKOFF_UNIT_MS || 60000);
export const stats = { metaCalls: 0, metaThrottles: 0, shopifyCalls: 0, shopify429: 0 };

const THROTTLE_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

export async function metaGetAll(url, { log = () => {} } = {}) {
  const out = [];
  let next = url, attempt = 0;
  while (next) {
    stats.metaCalls++;
    const res = await fetch(next);
    const usage = res.headers.get('x-business-use-case-usage');
    const body = await res.json();
    if (body.error) {
      if (THROTTLE_CODES.has(body.error.code) && attempt < 6) {
        stats.metaThrottles++;
        let wait = 2 ** attempt * 250;
        try { const u = Object.values(JSON.parse(usage))[0][0]; wait = Math.max(wait, u.estimated_time_to_regain_access * BACKOFF_UNIT_MS); } catch {}
        log(`meta throttled (#${body.error.code}), waiting ${wait}ms`);
        attempt++; await sleep(wait); continue;
      }
      throw new Error(redact(`Meta error ${body.error.code}: ${body.error.message} on ${next}`));
    }
    attempt = 0;
    out.push(...body.data);
    // slow down before Meta makes us
    try { const u = Object.values(JSON.parse(usage))[0][0]; if (Math.max(u.call_count, u.total_time) > 75) await sleep(200); } catch {}
    next = body.paging?.next || null;
  }
  return out;
}

export function metaInsightsUrl({ base, account, token, level, since, until, includeArchived = true }) {
  const u = new URL(`${base}/${account}/insights`);
  u.searchParams.set('level', level);
  u.searchParams.set('time_increment', '1');
  u.searchParams.set('time_range', JSON.stringify({ since, until }));
  u.searchParams.set('fields', 'spend,impressions,inline_link_clicks,actions,action_values,video_thruplay_watched_actions,ad_id,ad_name');
  u.searchParams.set('action_attribution_windows', JSON.stringify(['7d_click', '1d_view']));
  u.searchParams.set('limit', '200');
  if (level === 'ad' && includeArchived) {
    u.searchParams.set('filtering', JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'] }]));
  }
  u.searchParams.set('access_token', token);
  return u.toString();
}

// Meta returns purchase, omni_purchase and offsite_conversion.fb_pixel_purchase for the
// same conversions. Pick one. Adding them all triples revenue.
export function parseInsight(row, { purchaseType = 'omni_purchase', sumAllPurchaseTypes = false } = {}) {
  const pick = (arr, type) => Number((arr || []).find((a) => a.action_type === type)?.value || 0);
  const all = (arr) => (arr || []).filter((a) => /purchase/.test(a.action_type)).reduce((s, a) => s + Number(a.value), 0);
  return {
    date: row.date_start,
    ad_id: row.ad_id || null,
    ad_name: row.ad_name || null,
    spend: Number(row.spend),
    impressions: Number(row.impressions),
    clicks: Number(row.inline_link_clicks || pick(row.actions, 'link_click')),
    video_3s: pick(row.actions, 'video_view'),
    thruplays: pick(row.video_thruplay_watched_actions, 'video_view'),
    purchases: sumAllPurchaseTypes ? all(row.actions) : pick(row.actions, purchaseType) || pick(row.actions, 'purchase'),
    purchase_value: sumAllPurchaseTypes ? all(row.action_values) : pick(row.action_values, purchaseType) || pick(row.action_values, 'purchase'),
  };
}

export async function sheetValues({ base, sheetId, range, token }) {
  const res = await fetch(`${base}/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets ${res.status}`);
  return (await res.json()).values;
}

export async function shopifyOrders({ base, token, min, max, log = () => {} }) {
  const out = [];
  let next = `${base}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(min)}&created_at_max=${encodeURIComponent(max)}`;
  let attempt = 0;
  while (next) {
    stats.shopifyCalls++;
    const res = await fetch(next, { headers: { 'x-shopify-access-token': token } });
    if (res.status === 429 && attempt < 6) {
      stats.shopify429++;
      const wait = Number(res.headers.get('retry-after') || 1) * 1000;
      log(`shopify 429, waiting ${wait}ms`); attempt++; await sleep(wait); continue;
    }
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    attempt = 0;
    out.push(...(await res.json()).orders);
    const link = res.headers.get('link') || '';
    next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
  }
  return out;
}
