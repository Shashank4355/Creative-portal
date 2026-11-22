import { q, money, money2 } from '../../lib/db';

export default async function Page() {
  const summary = await q(`select check_name, status, count(*)::int n from data_checks group by 1,2 order by 1,2`);
  const meta = await q(`select date, status, expected, actual, detail from data_checks where check_name='meta_spend_matches_account' order by date desc`);
  const credit = await q(`select date, status, detail from data_checks where check_name='spend_credited_to_a_person' and status <> 'pass' order by date desc`);
  const loose = await q(`select c.ad_id, c.ad_name, c.match_method, c.note, coalesce(sum(d.spend),0) spend from creatives c left join ad_daily d using (ad_id)
                         where c.match_method in ('unmatched','conflict','sheet_ad_id') group by c.ad_id order by spend desc`);
  const shop = await q(`select date, detail from data_checks where check_name='meta_vs_shopify' order by date desc limit 7`);
  return (
    <>
      <h1>Data checks</h1>
      <p className="note">Every sync re-checks the numbers before anyone sees them. A day whose ad-level rows don't add up to Meta's own account total is held off the leaderboard.</p>
      <div className="kpis">{summary.map((s) => <div className="kpi" key={s.check_name + s.status}><span>{s.check_name.replaceAll('_', ' ')}</span><b>{s.n}</b> <span className={`tag ${s.status}`}>{s.status}</span></div>)}</div>

      <h2>Needs a fix in the tracker sheet</h2>
      <div className="scroll"><table><thead><tr><th className="l">Ad</th><th className="l">Problem</th><th className="l">Detail</th><th>Spend affected</th></tr></thead>
        <tbody>{loose.map((r) => <tr key={r.ad_id}><td className="l">{r.ad_name}</td>
          <td className="l"><span className={`tag ${r.match_method === 'sheet_ad_id' ? 'info' : r.match_method === 'conflict' ? 'fail' : 'warn'}`}>{r.match_method}</span></td>
          <td className="l">{r.note}</td><td>{money(r.spend)}</td></tr>)}</tbody></table></div>

      <h2>Days with spend not credited to anyone</h2>
      <div className="scroll"><table><thead><tr><th className="l">Date</th><th className="l">Status</th><th className="l">Detail</th></tr></thead>
        <tbody>{credit.map((r) => <tr key={r.date.toISOString()}><td className="l">{r.date.toISOString().slice(0, 10)}</td><td className="l"><span className={`tag ${r.status}`}>{r.status}</span></td><td className="l">{r.detail}</td></tr>)}</tbody></table></div>

      <h2>Meta ad-level vs account total</h2>
      <div className="scroll"><table><thead><tr><th className="l">Date</th><th>Account spend</th><th>Sum of ads</th><th className="l">Status</th></tr></thead>
        <tbody>{meta.map((r) => <tr key={r.date.toISOString()}><td className="l">{r.date.toISOString().slice(0, 10)}</td><td>{money2(r.expected)}</td><td>{money2(r.actual)}</td><td className="l"><span className={`tag ${r.status}`}>{r.status}</span></td></tr>)}</tbody></table></div>

      <h2>Meta vs Shopify (last 7 days, for context)</h2>
      <p className="note">These never match and aren't meant to. Meta counts a purchase on the day of the click or view, within 7 days of a click or 1 day of a view, and will claim orders other channels also claim. Shopify counts the order once, on the day it was placed. Net sales here leave out tax, shipping, refunds and test orders.</p>
      <div className="scroll"><table><thead><tr><th className="l">Date</th><th className="l">Detail</th></tr></thead>
        <tbody>{shop.map((r) => <tr key={r.date.toISOString()}><td className="l">{r.date.toISOString().slice(0, 10)}</td><td className="l">{r.detail}</td></tr>)}</tbody></table></div>
    </>
  );
}
