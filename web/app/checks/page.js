import Link from 'next/link';
import { q, me as getMe, money, money2, compact, ratio, num, iso, day } from '../../lib/db';
import { PageHead, Card, Tag, Icon, Empty, Kpi } from '../ui';
import LineChart from '../linechart';

const NAMES = {
  meta_spend_matches_account: 'Ads add up to the Meta account total',
  spend_credited_to_a_person: 'Spend credited to a person',
  meta_vs_shopify: 'Meta vs Shopify (context only)',
};
const PROBLEM = {
  sheet_ad_id: ['info', 'Legacy ad name', 'Credited. Fix: rename the ad so it carries its code.'],
  unmatched: ['warn', 'Not in the sheet', 'Not credited. Fix: add the row to the tracker.'],
  conflict: ['fail', 'Code pasted twice', 'Not credited. Fix: delete the wrong row.'],
};

export default async function Page() {
  const me = await getMe();
  if (!me) return <Empty>No signed-in user.</Empty>;
  const isMgr = me.role === 'manager';
  const status = await q('select * from check_status() order by date');
  const [run] = await q('select * from sync_runs order by id desc limit 1');

  const byCheck = {};
  for (const s of status) (byCheck[s.check_name] ||= { pass: 0, warn: 0, fail: 0, info: 0 })[s.status]++;
  const metaDays = status.filter((s) => s.check_name === 'meta_spend_matches_account');
  const credit = Object.fromEntries(status.filter((s) => s.check_name === 'spend_credited_to_a_person').map((s) => [iso(s.date), s.status]));

  const head = (
    <PageHead title="Data checks" sub={`Run on every sync before anyone sees a number · sync #${run.id}, ${run.status}`}>
      <span className="chip"><Icon name="meta" size={13} />{run.meta_calls} Meta calls · {run.meta_throttles} throttles retried</span>
      <span className="chip"><Icon name="store" size={13} />{run.shopify_calls} Shopify calls · {run.shopify_429} 429s retried</span>
    </PageHead>
  );

  const summary = (
    <div className="kpis k4">
      {Object.entries(NAMES).map(([k, label]) => {
        const c = byCheck[k] || {};
        const total = Object.values(c).reduce((s, n) => s + n, 0);
        return (
          <div className="kpi" key={k}>
            <div className="kpi-l">{label}</div>
            <div className="kpi-v">{k === 'meta_vs_shopify' ? `${c.info || 0} days` : `${c.pass || 0}/${total}`}</div>
            <div className="kpi-f row" style={{ gap: 6 }}>
              {c.pass ? <Tag tone="pass">{c.pass} pass</Tag> : null}{c.warn ? <Tag tone="warn">{c.warn} warn</Tag> : null}
              {c.fail ? <Tag tone="fail">{c.fail} fail</Tag> : null}{c.info ? <Tag tone="info">shown for context</Tag> : null}
            </div>
          </div>
        );
      })}
      <div className="kpi"><div className="kpi-l">Purchase types counted</div><div className="kpi-v">1 of 3</div>
        <div className="kpi-f">purchase, not omni_purchase or pixel purchase too</div></div>
    </div>
  );

  // Pass/fail per day, visible to every role. Amounts only for managers.
  const meta = isMgr ? Object.fromEntries((await q(`select date, expected, actual from data_checks where check_name = 'meta_spend_matches_account' and run_id = $1`, [run.id])).map((r) => [iso(r.date), r])) : {};
  const calendar = (
    <Card title="Ad-level vs account total, day by day" sub="Spend, purchases and purchase value must all match Meta’s account-level number to the cent, or the day is held back">
      <div className="cal">{metaDays.map((s) => {
        const d = iso(s.date), m = meta[d];
        return (
          <div key={d} className={s.status} title={m ? `Account ${money2(m.expected)} · ads ${money2(m.actual)}` : s.status}>
            <b><Icon name={s.status === 'pass' ? 'check' : 'x'} size={11} />{day(d)}</b>
            <span>{m ? compact(m.expected) : s.status}</span>
            {credit[d] && credit[d] !== 'pass' && <small title="some spend not credited to a person">sheet gap</small>}
          </div>
        );
      })}</div>
    </Card>
  );

  if (!isMgr) {
    return (
      <>
        {head}
        <div className="banner info"><Icon name="lock" /><div><b>Amounts on this page are manager-only.</b> The check rows carry account spend and Shopify revenue, so row-level security gives {me.person} the pass/fail result for each day and nothing else.</div></div>
        {summary}
        {calendar}
      </>
    );
  }

  const cmp = Object.fromEntries((await q('select * from sync_compare where run_id = $1', [run.id])).map((r) => [r.method, r]));
  const loose = await q(`select c.ad_id, c.ad_name, c.code, c.match_method, c.note, coalesce(sum(d.spend),0) spend, count(d.date)::int days
    from creatives c left join ad_daily d using (ad_id) where c.match_method in ('unmatched','conflict','sheet_ad_id') group by c.ad_id order by c.match_method desc, spend desc`);
  const uncredited = await q(`select date, status, detail from data_checks where check_name = 'spend_credited_to_a_person' and status <> 'pass' and run_id = $1 order by date desc`, [run.id]);
  const acct = await q('select * from account_daily order by date');
  const shop = Object.fromEntries((await q('select * from shopify_daily order by date')).map((s) => [iso(s.date), s]));
  const dates = acct.map((a) => iso(a.date));
  const { quick, checked } = cmp;
  const lost = loose.filter((l) => l.match_method !== 'sheet_ad_id').reduce((s, l) => s + +l.spend, 0);
  const metaClaim = acct.reduce((s, a) => s + +a.purchase_value, 0);
  const shopNet = Object.values(shop).reduce((s, x) => s + +x.net_sales, 0), shopUtm = Object.values(shop).reduce((s, x) => s + +x.meta_utm_net_sales, 0);

  return (
    <>
      {head}
      {quick && checked && (
        <Card title="Why the checks exist" sub="The same 30 days, pulled two ways from the same Meta account">
          <div className="vs">
            <div className="vs-card bad">
              <Tag tone="fail">Quick pull</Tag>
              <div className="big">{ratio(quick.purchase_value, quick.spend)} <small style={{ fontSize: 16 }}>ROAS</small></div>
              <dl><dt>Spend</dt><dd>{money(quick.spend)}</dd><dt>Purchases</dt><dd>{num(quick.purchases)}</dd><dt>Purchase value</dt><dd>{money(quick.purchase_value)}</dd>
                <dt>Days matching Meta</dt><dd>{quick.days_matching} of {quick.days}</dd></dl>
            </div>
            <div className="vs-arrow"><Icon name="arrow" size={22} /></div>
            <div className="vs-card ok">
              <Tag tone="pass">Checked pull</Tag>
              <div className="big">{ratio(checked.purchase_value, checked.spend)} <small style={{ fontSize: 16 }}>ROAS</small></div>
              <dl><dt>Spend</dt><dd>{money(checked.spend)}</dd><dt>Purchases</dt><dd>{num(checked.purchases)}</dd><dt>Purchase value</dt><dd>{money(checked.purchase_value)}</dd>
                <dt>Days matching Meta</dt><dd>{checked.days_matching} of {checked.days}</dd></dl>
            </div>
          </div>
          <ul className="fixlist" style={{ marginTop: 16 }}>
            <li><Icon name="check" /><span><b>Purchases counted once.</b> Meta returns <code>purchase</code>, <code>omni_purchase</code> and <code>offsite_conversion.fb_pixel_purchase</code> for the same orders. Adding them up gave {num(quick.purchases)} purchases instead of {num(checked.purchases)}.</span></li>
            <li><Icon name="check" /><span><b>Archived and deleted ads included.</b> An ad-level pull leaves them out unless you filter on <code>ad.effective_status</code>. That was {money(+checked.spend - +quick.spend)} of spend the quick pull never saw.</span></li>
            <li><Icon name="check" /><span><b>Every day reconciled.</b> Ad-level rows are summed and compared with Meta’s own account-level number for that day. A day that doesn’t match is held off the leaderboard until it does.</span></li>
          </ul>
        </Card>
      )}

      {summary}
      {calendar}

      <div className="grid">
        <Card title="Needs a fix in the tracker sheet" sub={`${money(lost)} of spend is credited to nobody until these rows are fixed`} pad={false}>
          <div className="scroll"><table>
            <thead><tr><th>Ad</th><th className="l">Problem</th><th className="l">Detail</th><th>Days</th><th>Spend</th></tr></thead>
            <tbody>{loose.map((r) => {
              const [tone, label, what] = PROBLEM[r.match_method];
              return (
                <tr key={r.ad_id}><td className="l"><b>{r.code || '—'}</b><div className="muted" style={{ fontSize: 12 }}>{r.ad_name}</div></td>
                  <td className="l"><Tag tone={tone}>{label}</Tag></td>
                  <td className="wrap l">{r.note}<div className="muted">{what}</div></td><td>{r.days}</td><td>{money(r.spend)}</td></tr>
              );
            })}</tbody>
          </table></div>
        </Card>
        <Card title="Days with uncredited spend" sub="Warn above 1% of the day’s spend, fail above 5%" pad={false}>
          <div className="scroll"><table>
            <thead><tr><th>Date</th><th className="l">Status</th><th className="l">Detail</th></tr></thead>
            <tbody>{uncredited.map((r) => (
              <tr key={iso(r.date)}><td>{day(r.date)}</td><td className="l"><Tag tone={r.status}>{r.status}</Tag></td><td className="l wrap" style={{ minWidth: 180 }}>{r.detail}</td></tr>))}</tbody>
          </table></div>
        </Card>
      </div>

      <Card title="Meta vs Shopify, for context" sub="These never match and aren’t meant to. Shown side by side, not as a pass/fail.">
        <div className="kpis k4" style={{ marginBottom: 16 }}>
          <Kpi label="Meta claims (7d click + 1d view)" value={compact(metaClaim)} />
          <Kpi label="Shopify net sales, all channels" value={compact(shopNet)} />
          <Kpi label="Shopify net sales tagged utm_source=facebook" value={compact(shopUtm)} foot={`${((100 * shopUtm) / metaClaim).toFixed(0)}% of Meta’s claim`} />
          <Kpi label="MER (Shopify net ÷ Meta spend)" value={ratio(shopNet, acct.reduce((s, a) => s + +a.spend, 0))} />
        </div>
        <LineChart dates={dates} area={false} series={[
          { name: 'Meta claimed purchase value', color: 'var(--series-1)', values: acct.map((a) => +a.purchase_value) },
          { name: 'Shopify net sales', color: 'var(--series-2)', values: dates.map((d) => +(shop[d]?.net_sales || 0)) },
          { name: 'Shopify, Meta-tagged', color: 'var(--series-3)', values: dates.map((d) => +(shop[d]?.meta_utm_net_sales || 0)) },
        ]} />
        <ul className="fixlist" style={{ marginTop: 14 }}>
          <li><Icon name="info" /><span><b>Different clocks.</b> Meta books a purchase on the day of the click or view, up to 7 days after a click or 1 day after a view. Shopify books it on the day the order was placed.</span></li>
          <li><Icon name="info" /><span><b>Different credit.</b> Meta claims any order it touched, including ones Google, email or a direct visit also claim. Shopify counts each order once.</span></li>
          <li><Icon name="info" /><span><b>Different money.</b> Shopify net sales here leave out tax, shipping, refunds and the brand’s own test orders. Meta reports what the pixel sent.</span></li>
        </ul>
      </Card>

      <details className="card card-b">
        <summary>Show account total vs sum of ads for every day</summary>
        <div className="scroll"><table>
          <thead><tr><th>Date</th><th>Account spend</th><th>Sum of ads</th><th>Difference</th><th className="l">Status</th></tr></thead>
          <tbody>{[...metaDays].reverse().map((s) => { const m = meta[iso(s.date)]; return (
            <tr key={iso(s.date)}><td>{iso(s.date)}</td><td>{money2(m?.expected)}</td><td>{money2(m?.actual)}</td><td>{money2(+m?.actual - +m?.expected)}</td><td className="l"><Tag tone={s.status}>{s.status}</Tag></td></tr>); })}</tbody>
        </table></div>
      </details>
      <p className="note">Pulled with the <code>ads_read</code> token only. <Link href="/controls">See who can read what →</Link></p>
    </>
  );
}
