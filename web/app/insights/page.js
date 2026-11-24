import { q, me as getMe, money, compact, verdict, WIN, iso } from '../../lib/db';
import { PageHead, Card, Empty } from '../ui';

function by(rows, keyFn) {
  const g = {};
  for (const r of rows) {
    const k = keyFn(r);
    const x = (g[k] ||= { k, n: 0, spend: 0, value: 0, winners: 0, tested: 0, v3: 0, imp: 0 });
    x.n++; x.spend += +r.spend; x.value += +r.purchase_value; x.v3 += +r.video_3s; x.imp += +r.impressions;
    if (verdict(r).key === 'winner') x.winners++;
    if (+r.spend >= WIN.tested) x.tested++;
  }
  return Object.values(g).map((x) => ({ ...x, roas: x.spend ? x.value / x.spend : 0 }));
}

// Horizontal bars, one baseline, winner threshold marked. Hover shows the detail.
function Bars({ items, max }) {
  return (
    <div className="bars">{items.map((x) => (
      <div className="bar" key={x.k}>
        <span className="bar-name" title={x.k}>{x.k}</span>
        <span className="bar-track">
          <span className={`bar-fill ${x.roas >= WIN.roas ? 'win' : x.roas < 2 ? 'low' : ''}`} style={{ width: `${(100 * x.roas) / max}%` }} />
          <span className="bar-mark" style={{ left: `${(100 * WIN.roas) / max}%` }} />
        </span>
        <span className="bar-v">{x.roas.toFixed(2)}</span>
        <span className="tip">{x.n} creatives · {money(x.spend)} spend · {x.winners} winner{x.winners === 1 ? '' : 's'} · hook rate {(100 * x.v3 / (x.imp || 1)).toFixed(1)}%</span>
      </div>))}
    </div>
  );
}

const monday = (d) => {
  const t = new Date(iso(d) + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const weekLabel = (k) => 'Week of ' + new Date(k + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default async function Page() {
  const me = await getMe();
  if (!me) return <Empty>No signed-in user.</Empty>;
  const rows = await q('select * from creative_perf');
  if (!rows.length) return <><PageHead title="Insights" /><Empty>No creatives visible to you yet.</Empty></>;
  const dims = [
    ['Concept', 'The angle the ad sells', by(rows, (r) => r.concept)],
    ['Format', 'How it is made', by(rows, (r) => r.format)],
    ['Hook', 'The opening line type', by(rows, (r) => r.hook)],
    ['Launch week', 'Creatives grouped by the week they went live', by(rows, (r) => (r.launch_date ? monday(r.launch_date) : '9999')).sort((a, b) => a.k.localeCompare(b.k)).map((x) => ({ ...x, k: x.k === '9999' ? 'Unknown' : weekLabel(x.k) }))],
  ];
  const max = Math.max(4, ...dims.flatMap(([, , xs]) => xs.map((x) => x.roas))) * 1.05;
  const allRoas = rows.reduce((s, r) => s + +r.purchase_value, 0) / rows.reduce((s, r) => s + +r.spend, 0);
  const best = dims.slice(0, 3).map(([name, , xs]) => [name, xs.filter((x) => x.spend >= 2000).sort((a, b) => b.roas - a.roas)[0]]);
  return (
    <>
      <PageHead title="What's working" sub={`ROAS by concept, format, hook and launch week · ${rows.length} creatives · overall ROAS ${allRoas.toFixed(2)}`} />
      <div className="kpis k4">
        {best.map(([name, x]) => x && (
          <div className="kpi" key={name}><div className="kpi-l">Best {name.toLowerCase()}</div><div className="kpi-v">{x.k}</div>
            <div className="kpi-f"><span className="delta good">{x.roas.toFixed(2)} ROAS</span> on {compact(x.spend)}</div></div>))}
        <div className="kpi"><div className="kpi-l">Winner line</div><div className="kpi-v">{WIN.roas.toFixed(1)}×</div><div className="kpi-f">at {money(WIN.minSpend)}+ spend (marked on every bar)</div></div>
      </div>
      <div className="grid g2">
        {dims.map(([name, sub, xs]) => (
          <Card key={name} title={`ROAS by ${name.toLowerCase()}`} sub={sub}>
            <Bars items={name === 'Launch week' ? xs : [...xs].sort((a, b) => b.roas - a.roas)} max={max} />
          </Card>
        ))}
      </div>
      <p className="note">Green bars clear the {WIN.roas} winner line, red ones are under 2.0. Hover a bar for creatives, spend, winners and hook rate. Groups with little spend move a lot from day to day; the best-of tiles only count groups with $2,000+ of spend.</p>
    </>
  );
}
