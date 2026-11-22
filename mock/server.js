// Mock of the three APIs the portal reads, shaped like the real ones:
//   Meta Marketing API  /meta/v23.0/act_X/insights, /act_X/ads, /act_X/adsets
//   Google Sheets       /sheets/v4/spreadsheets/:id/values/:range
//   Shopify Admin REST  /shopify/admin/api/2025-10/orders.json (Link-header paging)
// It also reproduces the behaviours that bite in production: string numbers, three
// overlapping purchase action types, archived/deleted ads missing from ad-level pulls,
// Business Use Case throttling (#80000 / #80004) and Shopify 429s with Retry-After.
import http from 'node:http';
import fs from 'node:fs';
import { URL } from 'node:url';

const truth = JSON.parse(fs.readFileSync('data/meta_truth.json', 'utf8'));
const sheet = JSON.parse(fs.readFileSync('data/sheet_values.json', 'utf8'));
const orders = JSON.parse(fs.readFileSync('data/shopify_orders.json', 'utf8'));
const adById = Object.fromEntries(truth.ads.map((a) => [a.ad_id, a]));

const TOKENS = { read: 'mock-read-token', manage: 'mock-manage-token', shopify: 'mock-shopify-token' };
export const state = { calls: { insights: 0, ads: 0, shopify: 0 }, created: [], log: [], buc: { insights: 0, ads: 0 } };
const opts = { throttleInsightsEvery: Number(process.env.MOCK_THROTTLE_EVERY || 7), throttleAdsAfter: 12 };

function json(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
const metaErr = (res, code, msg, type = 'OAuthException', status = 400) => json(res, status, { error: { message: msg, type, code, fbtrace_id: 'mock' + Date.now() } });

function insightRow(r, level) {
  const ad = adById[r.ad_id];
  const n = (x) => String(x);
  const purch = n(r.purchases), val = r.purchase_value.toFixed(2);
  const row = {
    date_start: r.date, date_stop: r.date, account_currency: 'USD',
    spend: r.spend.toFixed(2), impressions: n(r.impressions), inline_link_clicks: n(r.clicks),
    actions: [
      { action_type: 'link_click', value: n(r.clicks) },
      { action_type: 'video_view', value: n(r.video_3s) },
      { action_type: 'purchase', value: purch },
      { action_type: 'omni_purchase', value: purch },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: purch },
    ],
    action_values: [
      { action_type: 'purchase', value: val },
      { action_type: 'omni_purchase', value: val },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: val },
    ],
    video_thruplay_watched_actions: [{ action_type: 'video_view', value: n(r.thruplays) }],
  };
  if (level === 'ad') Object.assign(row, { ad_id: r.ad_id, ad_name: ad.name, adset_id: 'as_' + ad.ad_id.slice(-6), campaign_id: 'cmp_testing' });
  return row;
}

function sumRows(rs) {
  const keys = ['spend', 'impressions', 'clicks', 'video_3s', 'thruplays', 'purchases', 'purchase_value'];
  const o = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rs) for (const k of keys) o[k] += r[k];
  o.spend = Math.round(o.spend * 100) / 100; o.purchase_value = Math.round(o.purchase_value * 100) / 100;
  return o;
}

function handleInsights(req, res, u) {
  if (u.searchParams.get('access_token') !== TOKENS.read && u.searchParams.get('access_token') !== TOKENS.manage) return metaErr(res, 190, 'Invalid OAuth access token.');
  state.calls.insights++;
  state.buc.insights += 9;
  const usage = { [truth.account.id.replace('act_', '')]: [{ type: 'ads_insights', call_count: Math.min(100, state.buc.insights), total_cputime: 10, total_time: Math.min(100, state.buc.insights), estimated_time_to_regain_access: 0 }] };
  if (opts.throttleInsightsEvery && state.calls.insights % opts.throttleInsightsEvery === 0) {
    usage[truth.account.id.replace('act_', '')][0].estimated_time_to_regain_access = 1;
    res.setHeader('x-business-use-case-usage', JSON.stringify(usage));
    return metaErr(res, 80000, 'There have been too many calls from this ad-account. Wait a bit and try again.', 'OAuthException');
  }
  res.setHeader('x-business-use-case-usage', JSON.stringify(usage));
  const level = u.searchParams.get('level') || 'account';
  const tr = JSON.parse(u.searchParams.get('time_range') || '{}');
  const inRange = truth.insights.filter((r) => (!tr.since || r.date >= tr.since) && (!tr.until || r.date <= tr.until));
  let filterStatuses = null;
  const f = u.searchParams.get('filtering');
  if (f) { const ff = JSON.parse(f).find((x) => x.field === 'ad.effective_status'); if (ff) filterStatuses = ff.value; }

  let data;
  if (level === 'account') {
    const byDate = {};
    for (const r of inRange) (byDate[r.date] ||= []).push(r);
    data = Object.keys(byDate).sort().map((d) => insightRow({ date: d, ...sumRows(byDate[d]) }, 'account'));
  } else {
    // Real Meta behaviour: ARCHIVED / DELETED ads are left out unless asked for.
    const allowed = filterStatuses || ['ACTIVE', 'PAUSED'];
    data = inRange.filter((r) => allowed.includes(adById[r.ad_id].status)).map((r) => insightRow(r, 'ad'));
  }
  const limit = Number(u.searchParams.get('limit') || 25);
  const after = Number(u.searchParams.get('after') ? Buffer.from(u.searchParams.get('after'), 'base64').toString() : 0);
  const page = data.slice(after, after + limit);
  const body = { data: page, paging: { cursors: { before: Buffer.from(String(after)).toString('base64'), after: Buffer.from(String(after + limit)).toString('base64') } } };
  if (after + limit < data.length) {
    const next = new URL(u.toString()); next.searchParams.set('after', Buffer.from(String(after + limit)).toString('base64'));
    body.paging.next = next.toString();
  }
  json(res, 200, body);
}

async function readBody(req) { let b = ''; for await (const c of req) b += c; try { return JSON.parse(b || '{}'); } catch { return Object.fromEntries(new URLSearchParams(b)); } }

async function handleCreateAd(req, res, u) {
  const body = await readBody(req);
  const token = body.access_token || u.searchParams.get('access_token');
  if (token !== TOKENS.manage) return metaErr(res, 200, '(#200) Requires ads_management permission to manage the object', 'OAuthException', 403);
  state.calls.ads++;
  state.buc.ads++;
  res.setHeader('x-business-use-case-usage', JSON.stringify({ '1000000001': [{ type: 'ads_management', call_count: state.buc.ads * 7, total_time: 5, total_cputime: 5, estimated_time_to_regain_access: 0 }] }));
  if (state.calls.ads === opts.throttleAdsAfter) return metaErr(res, 80004, 'There have been too many calls to this ad-account. Wait a bit and try again.');
  const kind = u.pathname.endsWith('/adsets') ? 'adset' : 'ad';
  if (kind === 'ad' && !state.created.some((o) => o.kind === 'adset' && o.id === body.adset_id)) return metaErr(res, 100, 'Invalid parameter: adset_id', 'OAuthException');
  const id = String((kind === 'adset' ? 23870000000000 : 23869000000000) + state.created.length);
  // Meta's default status is ACTIVE when none is sent, which is why the launcher always sends PAUSED.
  const obj = { kind, id, name: body.name, status: body.status || 'ACTIVE', adset_id: body.adset_id, daily_budget: body.daily_budget ? Number(body.daily_budget) : undefined };
  state.created.push(obj);
  json(res, 200, { id });
}

function handleSheets(req, res, u) {
  if (req.headers.authorization !== 'Bearer mock-sheets-token') return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
  json(res, 200, sheet);
}

let shopifyN = 0;
function handleOrders(req, res, u) {
  if (req.headers['x-shopify-access-token'] !== TOKENS.shopify) return json(res, 401, { errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' });
  state.calls.shopify++;
  if (++shopifyN % 6 === 0) return json(res, 429, { errors: 'Exceeded 2 calls per second for api client. Reduce request rates to resume uninterrupted service.' }, { 'retry-after': '0.2' });
  const limit = Math.min(250, Number(u.searchParams.get('limit') || 50));
  const info = u.searchParams.get('page_info');
  let start = 0, min = u.searchParams.get('created_at_min'), max = u.searchParams.get('created_at_max');
  if (info) ({ start, min, max } = JSON.parse(Buffer.from(info, 'base64url').toString()));
  const filtered = orders.filter((o) => (!min || new Date(o.created_at) >= new Date(min)) && (!max || new Date(o.created_at) <= new Date(max)));
  const page = filtered.slice(start, start + limit);
  const headers = { 'x-shopify-shop-api-call-limit': `${(shopifyN % 40) + 1}/40` };
  if (start + limit < filtered.length) {
    const pi = Buffer.from(JSON.stringify({ start: start + limit, min, max })).toString('base64url');
    headers.link = `<${u.origin}${u.pathname}?limit=${limit}&page_info=${pi}>; rel="next"`;
  }
  json(res, 200, { orders: page }, headers);
}

export function start(port = 4010) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    state.log.push(`${req.method} ${u.pathname}`);
    try {
      if (/^\/meta\/v[\d.]+\/act_\d+\/insights$/.test(u.pathname) && req.method === 'GET') return handleInsights(req, res, u);
      if (/^\/meta\/v[\d.]+\/act_\d+\/(ads|adsets)$/.test(u.pathname) && req.method === 'POST') return handleCreateAd(req, res, u);
      if (u.pathname.startsWith('/sheets/v4/spreadsheets/')) return handleSheets(req, res, u);
      if (u.pathname.endsWith('/orders.json')) return handleOrders(req, res, u);
      if (u.pathname === '/__state') return json(res, 200, state);
      if (u.pathname === '/__reset') { state.created = []; state.calls.ads = 0; state.buc.ads = 0; return json(res, 200, { ok: true }); }
      json(res, 404, { error: 'not found' });
    } catch (e) { json(res, 500, { error: String(e) }); }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  start().then(() => console.log('mock APIs on http://127.0.0.1:4010'));
}
