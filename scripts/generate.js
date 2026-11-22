// Builds the synthetic "source of truth" the mock APIs serve.
// Fictional DTC brand (Fernlow, sleep and bedding), 30 days, one Meta ad account,
// a creative tracker Google Sheet, and Shopify orders. Seeded, so every run is identical.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data');
fs.mkdirSync(OUT, { recursive: true });

let s = 20261122;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const round2 = (x) => Math.round(x * 100) / 100;
const poisson = (l) => { if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

const DAYS = 30;
const START = new Date('2026-10-23T00:00:00Z');
const day = (i) => new Date(START.getTime() + i * 864e5).toISOString().slice(0, 10);

const STRATEGISTS = [
  { name: 'Priya', skill: 1.18 }, { name: 'Marco', skill: 1.0 },
  { name: 'Dana', skill: 0.9 }, { name: 'Sam', skill: 1.05 },
];
const EDITORS = [
  { name: 'Leo', skill: 1.12 }, { name: 'Ines', skill: 1.0 }, { name: 'Kofi', skill: 0.92 },
  { name: 'Mei', skill: 1.06 }, { name: 'Ruth', skill: 0.97 },
];
const CONCEPTS = ['CoolTouch', 'SleepScore', 'HotelBed', 'BackPain', 'Unboxing', 'PartnerSnore', 'Reviews'];
const FORMATS = ['UGC', 'Static', 'Founder', 'Demo', 'Carousel'];
const HOOKS = ['Q', 'Stat', 'POV', 'Problem', 'Before-After', 'Callout'];

// Ads and their latent quality
const ads = [];
let code = 400;
for (let d = 0; d < DAYS - 2; d++) {
  const n = d < 3 ? 8 : 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const st = pick(STRATEGISTS), ed = pick(EDITORS);
    const concept = pick(CONCEPTS), format = pick(FORMATS), hook = pick(HOOKS);
    code++;
    const q = Math.exp(gauss() * 0.35) * st.skill * ed.skill;
    const launch = day(d).replace(/-/g, '').slice(2);
    ads.push({
      ad_id: String(23850000000000 + code * 7),
      code: `C${code}`,
      launch_day: d,
      strategist: st.name, editor: ed.name, concept, format, hook,
      name: `FL_${launch}_${concept}_${format}_${hook}_ST-${st.name}_ED-${ed.name}_C${code}`,
      q,
      hook_rate: Math.min(0.55, 0.22 * Math.exp(gauss() * 0.25) * Math.sqrt(ed.skill)),
      ctr: 0.0105 * Math.sqrt(q) * Math.exp(gauss() * 0.15),
      cvr: 0.019 * Math.sqrt(q) * Math.exp(gauss() * 0.15),
      cpm: between(14, 22),
      aov: between(118, 152),
      status: 'ACTIVE',
    });
  }
}

// Spend path: test budget, then scale winners, cut losers
const rows = [];
for (const ad of ads) {
  let budget = between(90, 160), spent = 0, value = 0;
  for (let d = ad.launch_day; d < DAYS; d++) {
    const age = d - ad.launch_day;
    if (age === 3) {
      const roas = spent ? value / spent : 0;
      if (roas >= 2.3) budget = between(350, 800);
      else if (roas < 1.4) budget = 0;
      else budget = between(160, 260);
    }
    if (age === 10 && budget < 340) budget = 0;
    if (age > 10 && rnd() < 0.12) budget = 0; // fatigue
    if (budget === 0) break;
    const spend = round2(budget * between(0.85, 1.05));
    const impressions = Math.round((spend / ad.cpm) * 1000);
    const clicks = poisson(impressions * ad.ctr);
    const v3 = Math.round(impressions * ad.hook_rate * between(0.9, 1.1));
    const thru = Math.round(v3 * between(0.18, 0.34));
    const purchases = poisson(clicks * ad.cvr * 1.25 * Math.pow(0.985, age)); // includes 1-day view
    const pv = round2(purchases * ad.aov * between(0.9, 1.1));
    spent += spend; value += pv;
    rows.push({ date: day(d), ad_id: ad.ad_id, spend, impressions, clicks, video_3s: v3, thruplays: thru, purchases, purchase_value: pv });
  }
  ad.last_day = rows.filter((r) => r.ad_id === ad.ad_id).at(-1)?.date;
}

// Turned-off ads: some get ARCHIVED or DELETED later. Meta drops those from ad-level
// insights unless you filter on ad.effective_status, which is the trap the sync must handle.
for (const ad of ads) {
  if (ad.last_day && ad.last_day < day(DAYS - 1)) {
    const r = rnd();
    ad.status = r < 0.25 ? 'ARCHIVED' : r < 0.35 ? 'DELETED' : 'PAUSED';
  }
}

// Old naming convention on a few early ads: no code in the name, so the join must
// fall back to the ad_id column in the sheet.
const legacy = ads.filter((a) => a.launch_day === 0).slice(0, 4);
for (const a of legacy) { a.name = `Fernlow - ${a.concept} ${a.format} v2`; a.legacy = true; }

// Creative tracker sheet, typed by people
const sheet = [['Creative Code', 'Ad ID', 'Concept', 'Format', 'Hook', 'Strategist', 'Editor', 'Launch Date', 'Status']];
const orphans = new Set(ads.slice(40, 42).map((a) => a.ad_id)); // launched but never logged
for (const a of ads) {
  if (orphans.has(a.ad_id)) continue;
  let c = a.code, stName = a.strategist, edName = a.editor;
  const r = rnd();
  if (r < 0.06) c = ' ' + c.toLowerCase();
  if (r > 0.94) stName = stName.toLowerCase() + ' ';
  if (r > 0.5 && r < 0.53) edName = edName + ' ';
  sheet.push([c, a.legacy ? a.ad_id : '', a.concept, a.format, a.hook, stName, edName, day(a.launch_day), a.status === 'ACTIVE' ? 'Live' : 'Off']);
}
// A copy-paste duplicate with the wrong strategist
const dup = ads[77];
sheet.push([dup.code, '', dup.concept, dup.format, dup.hook, dup.strategist === 'Dana' ? 'Marco' : 'Dana', dup.editor, day(dup.launch_day), 'Live']);

// Shopify orders. Meta claims (click + view) overlap with other channels, so
// Shopify net sales never equal Meta-reported revenue.
const orders = [];
let oid = 6100000000;
const byDay = {};
for (const r of rows) byDay[r.date] = (byDay[r.date] || 0) + r.purchases;
for (let d = 0; d < DAYS; d++) {
  const date = day(d);
  const metaClaims = byDay[date] || 0;
  const n = Math.round(metaClaims * between(1.5, 1.7));
  const metaAdsToday = rows.filter((r) => r.date === date && r.purchases > 0);
  for (let i = 0; i < n; i++) {
    const hour = Math.floor(between(0, 24)), min = Math.floor(between(0, 60));
    const off = date >= '2026-11-01' ? '-05:00' : '-04:00'; // DST ends 1 Nov 2026
    const local = `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00${off}`;
    const subtotal = round2(between(89, 189));
    const tax = round2(subtotal * 0.07), shipping = subtotal > 120 ? 0 : 9.95;
    const fromMeta = rnd() < 0.42 && metaAdsToday.length;
    const ad = fromMeta ? pick(metaAdsToday) : null;
    const refunded = rnd() < 0.06 ? round2(subtotal) : 0;
    orders.push({
      id: oid++, created_at: local, currency: 'USD',
      subtotal_price: subtotal.toFixed(2), total_tax: tax.toFixed(2),
      total_shipping: shipping.toFixed(2), total_price: round2(subtotal + tax + shipping).toFixed(2),
      refunded_amount: refunded.toFixed(2), test: false,
      landing_site: ad ? `/products/cooltouch?utm_source=facebook&utm_medium=paid&utm_content=${ad.ad_id}` : (rnd() < 0.5 ? '/?utm_source=google&utm_medium=cpc' : '/'),
    });
  }
}
// two test orders the brand placed on itself
orders.push({ ...orders[10], id: oid++, test: true, total_price: '500.00', subtotal_price: '500.00' });
orders.push({ ...orders[20], id: oid++, test: true, total_price: '500.00', subtotal_price: '500.00' });

const truth = {
  account: { id: 'act_1000000001', name: 'Fernlow US', currency: 'USD', timezone_name: 'America/New_York' },
  ads: ads.map(({ q, hook_rate, ctr, cvr, cpm, aov, ...a }) => a),
  insights: rows,
};
fs.writeFileSync(path.join(OUT, 'meta_truth.json'), JSON.stringify(truth));
fs.writeFileSync(path.join(OUT, 'sheet_values.json'), JSON.stringify({ range: 'Tracker!A1:I', majorDimension: 'ROWS', values: sheet }));
fs.writeFileSync(path.join(OUT, 'shopify_orders.json'), JSON.stringify(orders));

const spend = rows.reduce((a, r) => a + r.spend, 0), pv = rows.reduce((a, r) => a + r.purchase_value, 0);
console.log(`ads=${ads.length} ad-days=${rows.length} spend=$${Math.round(spend)} meta_value=$${Math.round(pv)} roas=${(pv / spend).toFixed(2)} orders=${orders.length} sheet_rows=${sheet.length - 1}`);
console.log('status mix', ads.reduce((m, a) => ((m[a.status] = (m[a.status] || 0) + 1), m), {}));
