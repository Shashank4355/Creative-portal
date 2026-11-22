import { q, money, ratio, pct, WIN } from '../lib/db';

async function board(by) {
  return q(`select ${by} as who, count(*) creatives, sum(spend) spend, sum(purchase_value) value, sum(purchases) purchases,
      sum(video_3s) v3, sum(impressions) imp, sum(thruplays) thru,
      count(*) filter (where spend >= $1 and purchase_value / nullif(spend,0) >= $2) winners,
      count(*) filter (where spend >= 300) tested
    from creative_perf group by ${by} order by sum(purchase_value) / nullif(sum(spend),0) desc`, [WIN.minSpend, WIN.roas]);
}

function Board({ rows, label }) {
  return (
    <div className="scroll"><table>
      <thead><tr><th>{label}</th><th>Creatives</th><th>Spend</th><th>Purchase value</th><th>ROAS</th><th>CPA</th><th>Hook rate</th><th>Hold rate</th><th>Winners</th><th>Hit rate</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.who}><td>{r.who}</td><td>{r.creatives}</td><td>{money(r.spend)}</td><td>{money(r.value)}</td><td>{ratio(r.value, r.spend)}</td>
          <td>{money(Number(r.spend) / Number(r.purchases || 1))}</td><td>{pct(r.v3, r.imp)}</td><td>{pct(r.thru, r.v3)}</td>
          <td>{r.winners}</td><td>{pct(r.winners, r.tested)}</td></tr>))}
      </tbody></table></div>
  );
}

export default async function Page() {
  const [me] = await q('select * from app_users where id = auth.uid()');
  const checks = await q(`select check_name, status, count(*)::int n from data_checks group by 1,2`);
  const [run] = await q('select * from sync_runs order by id desc limit 1');
  const [pub] = await q('select count(*)::int n, min(date) a, max(date) b from published_dates');
  const metaFail = checks.filter((c) => c.check_name === 'meta_spend_matches_account' && c.status === 'fail').reduce((s, c) => s + c.n, 0);
  const [tot] = await q(`select sum(spend) spend, sum(purchase_value) value, sum(purchases) purchases from creative_perf`);
  const acct = await q(`select sum(spend) spend, sum(purchase_value) value from account_daily`);
  const shop = await q(`select sum(net_sales) net, sum(meta_utm_net_sales) utm, sum(orders) orders from shopify_daily`);
  const st = await board('strategist'), ed = await board('editor');
  const isMgr = me.role === 'manager';
  return (
    <>
      <h1>{isMgr ? 'Team leaderboard' : `${me.person}'s numbers`}</h1>
      {metaFail === 0
        ? <div className="banner ok">Numbers match Meta: ad-level spend, purchases and purchase value equal the ad account totals on all {pub.n} days ({pub.a?.toISOString?.().slice(0,10)} to {pub.b?.toISOString?.().slice(0,10)}). Last sync run #{run.id}, {run.meta_calls} Meta calls, {run.meta_throttles} throttle(s) retried.</div>
        : <div className="banner bad">{metaFail} day(s) held back: ad-level rows don't add up to the Meta account total. Those days are not shown below.</div>}
      <div className="kpis">
        <div className="kpi"><span>Meta spend (credited)</span><b>{money(tot.spend)}</b>{isMgr && <small> of {money(acct[0].spend)} total</small>}</div>
        <div className="kpi"><span>Meta purchase value</span><b>{money(tot.value)}</b><small> 7d click + 1d view</small></div>
        <div className="kpi"><span>Meta ROAS</span><b>{ratio(tot.value, tot.spend)}</b></div>
        <div className="kpi"><span>CPA</span><b>{money(Number(tot.spend) / Number(tot.purchases || 1))}</b></div>
        {isMgr && <>
          <div className="kpi"><span>Shopify net sales</span><b>{money(shop[0].net)}</b><small> {Number(shop[0].orders).toLocaleString()} orders</small></div>
          <div className="kpi"><span>MER (Shopify net ÷ Meta spend)</span><b>{ratio(shop[0].net, acct[0].spend)}</b></div>
          <div className="kpi"><span>Meta-tagged Shopify sales</span><b>{money(shop[0].utm)}</b><small> {pct(shop[0].utm, acct[0].value)} of what Meta claims</small></div>
        </>}
      </div>
      <h2>Strategists</h2><Board rows={st} label="Strategist" />
      <h2>Editors</h2><Board rows={ed} label="Editor" />
      <p className="note">Winner = at least {money(WIN.minSpend)} spent at ROAS ≥ {WIN.roas}. Hit rate = winners ÷ creatives that got at least $300 of spend (so a creative cut on day one doesn't count against anyone). Hook rate = 3-second views ÷ impressions; hold rate = ThruPlays ÷ 3-second views. Spend on ads the tracker sheet can't place is left out until the sheet is fixed; see Data checks.</p>
    </>
  );
}
