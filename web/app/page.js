import Link from 'next/link';
import { q, me as getMe, money, compact, ratio, pct, num, iso, verdict, WIN, PERSON_OK } from '../lib/db';
import { Kpi, Card, PageHead, Avatar, Meter, Segmented, Icon, Tag, Empty } from './ui';
import LineChart from './linechart';

const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
// last 7 days vs the 7 before, for the stat-tile deltas
const wow = (vals) => {
  const a = vals.slice(-7).reduce((s, v) => s + v, 0), b = vals.slice(-14, -7).reduce((s, v) => s + v, 0);
  return b ? a / b - 1 : null;
};
const ratioWow = (num_, den) => {
  const r = (n, d) => n.reduce((s, v) => s + v, 0) / (d.reduce((s, v) => s + v, 0) || 1);
  const a = r(num_.slice(-7), den.slice(-7)), b = r(num_.slice(-14, -7), den.slice(-14, -7));
  return b ? a / b - 1 : null;
};

function group(rows, key) {
  const by = {};
  for (const r of rows) {
    const g = (by[r[key]] ||= { who: r[key], creatives: 0, spend: 0, value: 0, purchases: 0, v3: 0, imp: 0, thru: 0, winners: 0, tested: 0 });
    g.creatives++; g.spend += +r.spend; g.value += +r.purchase_value; g.purchases += +r.purchases;
    g.v3 += +r.video_3s; g.imp += +r.impressions; g.thru += +r.thruplays;
    if (verdict(r).key === 'winner') g.winners++;
    if (+r.spend >= WIN.tested) g.tested++;
  }
  return Object.values(by).sort((a, b) => b.value / b.spend - a.value / a.spend);
}

function Board({ rows, label }) {
  const maxRoas = Math.max(4, ...rows.map((r) => r.value / r.spend));
  return (
    <div className="scroll"><table>
      <thead><tr><th>{label}</th><th>Creatives</th><th>Spend</th><th>Purchase value</th><th>ROAS</th><th>CPA</th><th>Hook rate</th><th>Hold rate</th><th>Winners</th><th>Hit rate</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        const roas = r.value / r.spend, hit = r.tested ? r.winners / r.tested : 0;
        return (
          <tr key={r.who}>
            <td><span className="who"><span className={`rank r${i + 1}`}>{i + 1}</span><Avatar name={r.who} />{r.who}</span></td>
            <td>{r.creatives}</td><td>{money(r.spend)}</td><td>{money(r.value)}</td>
            <td><span className="cellbar"><b className={roas >= WIN.roas ? 'good-n' : roas < 2 ? 'bad-n' : ''}>{roas.toFixed(2)}</b>
              <Meter value={roas} max={maxRoas} mark={WIN.roas} tone={roas >= WIN.roas ? 'ok' : roas < 2 ? 'bad' : 'warn'} /></span></td>
            <td>{money(r.spend / (r.purchases || 1))}</td><td>{pct(r.v3, r.imp)}</td><td>{pct(r.thru, r.v3)}</td>
            <td>{r.winners}</td>
            <td><span className="cellbar">{(hit * 100).toFixed(1)}%<Meter value={hit} max={0.6} /></span></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

export default async function Page() {
  const me = await getMe();
  if (!me) return <Empty>No signed-in user. Pick one from “Viewing as”.</Empty>;
  const isMgr = me.role === 'manager';
  const [run] = await q('select * from sync_runs order by id desc limit 1');
  const st = await q(`select status, count(*)::int n from check_status() where check_name = 'meta_spend_matches_account' group by 1`);
  const [pub] = await q('select count(*)::int n, min(date) a, max(date) b from published_dates');
  const rows = await q('select * from creative_perf');
  const daily = await q(`select d.date, sum(d.spend) spend, sum(d.purchase_value) value, sum(d.purchases) purchases
    from ad_daily d join creatives c using (ad_id) join published_dates p using (date)
    where c.match_method = any($1) group by d.date order by d.date`, [PERSON_OK]);
  const acct = isMgr ? await q('select * from account_daily order by date') : [];
  const shop = isMgr ? await q('select * from shopify_daily order by date') : [];
  const cmp = isMgr ? await q('select * from sync_compare where run_id = $1', [run.id]) : [];

  const failDays = st.filter((s) => s.status === 'fail').reduce((s, x) => s + x.n, 0);
  const dates = daily.map((d) => iso(d.date));
  const sp = daily.map((d) => +d.spend), va = daily.map((d) => +d.value), pu = daily.map((d) => +d.purchases);
  const tot = { spend: sum(rows, 'spend'), value: sum(rows, 'purchase_value'), purchases: sum(rows, 'purchases') };
  const shopBy = Object.fromEntries(shop.map((s) => [iso(s.date), +s.net_sales]));
  const acctSpend = sum(acct, 'spend'), shopNet = sum(shop, 'net_sales'), shopUtm = sum(shop, 'meta_utm_net_sales');

  const vcount = { winner: 0, middle: 0, loser: 0, early: 0 }, vspend = { winner: 0, middle: 0, loser: 0, early: 0 };
  for (const r of rows) { const v = verdict(r).key; vcount[v]++; vspend[v] += +r.spend; }
  const top = rows.filter((r) => verdict(r).key === 'winner').sort((a, b) => b.purchase_value - a.purchase_value).slice(0, 5);
  const quick = cmp.find((c) => c.method === 'quick'), checked = cmp.find((c) => c.method === 'checked');

  const series = [
    { name: 'Meta spend', color: 'var(--series-1)', values: sp },
    { name: 'Meta purchase value', color: 'var(--series-2)', values: va },
    ...(isMgr ? [{ name: 'Shopify net sales', color: 'var(--series-3)', values: dates.map((d) => shopBy[d] || 0) }] : []),
  ];

  return (
    <>
      <PageHead
        title={isMgr ? 'Team performance' : `${me.person}'s performance`}
        sub={`${iso(pub.a)} to ${iso(pub.b)} · ${pub.n} published days · ${rows.length} creatives ${isMgr ? 'credited to a person' : 'you can see'}`}>
        <Link className="btn" href="/creatives"><Icon name="film" />All creatives</Link>
        <Link className="btn" href="/insights"><Icon name="bulb" />What's working</Link>
      </PageHead>

      {failDays === 0
        ? <div className="banner ok"><Icon name="shield" /><div><b>Numbers match Meta.</b> Ad-level spend, purchases and purchase value equal the ad account totals on all {pub.n} days, to the cent. Sync #{run.id} made {run.meta_calls} Meta calls and retried {run.meta_throttles} throttle{run.meta_throttles === 1 ? '' : 's'}; Shopify: {run.shopify_calls} calls, {run.shopify_429} rate-limit retries.</div></div>
        : <div className="banner bad"><Icon name="alert" /><div><b>{failDays} day(s) held back.</b> Their ad-level rows don't add up to the Meta account total, so they are not in any number below.</div></div>}

      <div className="kpis k4">
        <Kpi icon="meta" label="Meta spend (credited)" value={compact(tot.spend)} delta={wow(sp)} goodUp={null} foot={isMgr ? `of ${compact(acctSpend)} account · 7d vs prior` : '7d vs prior 7d'} spark={sp} />
        <Kpi label="Meta purchase value" value={compact(tot.value)} delta={wow(va)} foot="7d click + 1d view" spark={va} />
        <Kpi label="Meta ROAS" value={ratio(tot.value, tot.spend)} delta={ratioWow(va, sp)} foot="7d vs prior 7d" spark={va.map((v, i) => v / (sp[i] || 1))} />
        <Kpi label="CPA" value={money(tot.spend / (tot.purchases || 1))} delta={ratioWow(sp, pu)} goodUp={false} foot={`${num(tot.purchases)} purchases`} spark={sp.map((s, i) => s / (pu[i] || 1))} />
        {isMgr && <>
          <Kpi icon="store" label="Shopify net sales" value={compact(shopNet)} foot={`${num(sum(shop, 'orders'))} orders, no tax/shipping/refunds`} spark={shop.map((s) => +s.net_sales)} />
          <Kpi label="MER" value={ratio(shopNet, acctSpend)} foot="Shopify net ÷ all Meta spend" />
          <Kpi label="Meta-tagged Shopify sales" value={compact(shopUtm)} foot={`${pct(shopUtm, sum(acct, 'purchase_value'), 0)} of what Meta claims`} />
          <Kpi icon="sheet" label="Spend credited to nobody" value={money(acctSpend - tot.spend)} foot={<Link href="/checks">tracker sheet can't place it →</Link>} />
        </>}
      </div>

      <div className="grid g-main">
        <Card title="Spend and return by day" sub={isMgr ? 'Meta numbers on published days; Shopify net sales for context (they never match Meta, see Data checks)' : 'Your creatives only, published days'}>
          <LineChart dates={dates} series={series} />
        </Card>
        <Card title="Creative verdicts" sub={`Winner = ${money(WIN.minSpend)}+ spend at ROAS ≥ ${WIN.roas}`}>
          <Segmented parts={[
            { label: 'Winners', value: vcount.winner, tone: 'pass' },
            { label: 'Middle', value: vcount.middle, tone: 'warn' },
            { label: 'Losers (ROAS < 1.6)', value: vcount.loser, tone: 'fail' },
            { label: `Under ${money(WIN.tested)} spend`, value: vcount.early, tone: 'info' },
          ]} />
          <p className="note" style={{ marginTop: 14 }}>Share of spend: winners {pct(vspend.winner, tot.spend, 0)}, losers {pct(vspend.loser, tot.spend, 0)}.</p>
          {isMgr && quick && checked && (
            <Link href="/checks" className="vs-mini">
              <div className="banner info" style={{ marginTop: 12 }}><Icon name="shield" /><div>A quick pull of the same days says <b>ROAS {ratio(quick.purchase_value, quick.spend)}</b>. Checked: <b>{ratio(checked.purchase_value, checked.spend)}</b>. See why →</div></div>
            </Link>
          )}
        </Card>
      </div>

      <Card title={isMgr ? 'Strategist leaderboard' : 'By strategist'} sub={isMgr ? 'Ranked by ROAS on published days' : 'Only creatives you can see'} pad={false}>
        <Board rows={group(rows, 'strategist')} label="Strategist" />
      </Card>
      <Card title={isMgr ? 'Editor leaderboard' : 'By editor'} sub={isMgr ? 'Ranked by ROAS on published days' : 'Only creatives you can see'} pad={false}>
        <Board rows={group(rows, 'editor')} label="Editor" />
      </Card>

      <Card title="Biggest winners" sub="Most purchase value among creatives that cleared the winner line" pad={false}
        right={<Link href="/creatives" className="btn sm">View all <Icon name="arrow" size={13} /></Link>}>
        {top.length ? (
          <div className="scroll"><table>
            <thead><tr><th>Creative</th><th className="l">Concept · format · hook</th><th className="l">Strategist / editor</th><th>Spend</th><th>Purchase value</th><th>ROAS</th><th>Hook rate</th><th className="l">Verdict</th></tr></thead>
            <tbody>{top.map((r) => (
              <tr key={r.ad_id}>
                <td><Link href={`/creatives/${r.ad_id}`}><b>{r.code}</b></Link></td>
                <td className="l">{r.concept} · {r.format} · {r.hook}</td><td className="l">{r.strategist} / {r.editor}</td>
                <td>{money(r.spend)}</td><td>{money(r.purchase_value)}</td><td className="good-n">{ratio(r.purchase_value, r.spend)}</td><td>{pct(r.video_3s, r.impressions)}</td>
                <td className="l"><Tag tone="pass">Winner</Tag></td>
              </tr>))}</tbody>
          </table></div>
        ) : <div className="card-b"><Empty icon="trophy">No winners yet.</Empty></div>}
      </Card>

      <p className="note">Hit rate = winners ÷ creatives that got at least {money(WIN.tested)} of spend, so a creative cut on day one doesn't count against anyone. Hook rate = 3-second views ÷ impressions; hold rate = ThruPlays ÷ 3-second views. Spend on ads the tracker sheet can't place is left out until the sheet is fixed (see Data checks).</p>
    </>
  );
}
