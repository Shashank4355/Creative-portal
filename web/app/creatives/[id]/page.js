import Link from 'next/link';
import { q, me as getMe, money, compact, ratio, pct, num, iso, verdict } from '../../../lib/db';
import { PageHead, Card, Kpi, Tag, Icon, Empty } from '../../ui';
import LineChart from '../../linechart';

export default async function Page({ params }) {
  const { id } = await params;
  const me = await getMe();
  const [c] = await q('select * from creative_perf where ad_id = $1', [id]);
  if (!c) {
    return (
      <>
        <Link href="/creatives" className="btn sm" style={{ alignSelf: 'flex-start' }}><Icon name="back" size={13} />Creatives</Link>
        <Empty>Ad <code>{id}</code> isn’t visible to {me?.person || 'you'}. Row-level security returned no row for it, so there is nothing to show, not even its name.</Empty>
      </>
    );
  }
  const daily = await q(`select d.* from ad_daily d join published_dates p using (date) where d.ad_id = $1 order by d.date`, [id]);
  const v = verdict(c);
  const dates = daily.map((d) => iso(d.date));
  const imp = +c.impressions, v3 = +c.video_3s, thru = +c.thruplays, clicks = +c.clicks, buys = +c.purchases;
  const funnel = [['Impressions', imp], ['3-second views', v3], ['ThruPlays', thru], ['Link clicks', clicks], ['Purchases', buys]];
  return (
    <>
      <Link href="/creatives" className="btn sm" style={{ alignSelf: 'flex-start' }}><Icon name="back" size={13} />Creatives</Link>
      <PageHead title={c.code} sub={c.ad_name}><Tag tone={v.tone}>{v.label}</Tag></PageHead>
      <div className="facts">
        <span className="chip">Concept <b>{c.concept}</b></span><span className="chip">Format <b>{c.format}</b></span><span className="chip">Hook <b>{c.hook}</b></span>
        <span className="chip">Strategist <b>{c.strategist}</b></span><span className="chip">Editor <b>{c.editor}</b></span>
        <span className="chip">Launched <b>{iso(c.launch_date)}</b></span><span className="chip">Meta ad ID <b className="mono">{c.ad_id}</b></span>
      </div>
      <div className="kpis k4">
        <Kpi label="Spend" value={money(c.spend)} spark={daily.map((d) => +d.spend)} foot={`${daily.length} days with delivery`} />
        <Kpi label="ROAS" value={ratio(c.purchase_value, c.spend)} foot={`${compact(c.purchase_value)} purchase value`} spark={daily.map((d) => +d.purchase_value / (+d.spend || 1))} />
        <Kpi label="CPA" value={money(+c.spend / (buys || 1))} foot={`${num(buys)} purchases`} />
        <Kpi label="Hook / hold rate" value={`${pct(v3, imp)} / ${pct(thru, v3)}`} foot="3s views ÷ impr. · ThruPlays ÷ 3s" />
      </div>
      <div className="grid g-main">
        <Card title="Daily spend and purchase value" sub="Published days only">
          {dates.length > 1 ? <LineChart dates={dates} height={240} series={[
            { name: 'Spend', color: 'var(--series-1)', values: daily.map((d) => +d.spend) },
            { name: 'Purchase value', color: 'var(--series-2)', values: daily.map((d) => +d.purchase_value) },
          ]} /> : <Empty icon="info">Not enough days yet.</Empty>}
        </Card>
        <Card title="Funnel" sub="Totals on published days">
          <div className="funnel">{funnel.map(([l, n], i) => (
            <div key={l}><span>{l}</span><span className="ft"><span style={{ width: `${Math.max(1.5, (100 * Math.log10(n + 1)) / Math.log10(imp + 1))}%` }} /></span>
              <em>{num(n)}{i ? ` · ${pct(n, funnel[i - 1][1])}` : ''}</em></div>))}
          </div>
          <p className="note" style={{ marginTop: 12 }}>Bar length is on a log scale so purchases stay visible next to impressions. The percentage is the step from the row above.</p>
        </Card>
      </div>
    </>
  );
}
