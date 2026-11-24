import { q, me as getMe, iso, verdict, WIN, money } from '../../lib/db';
import { PageHead, Empty } from '../ui';
import CreativesTable from './table';

export default async function Page() {
  const me = await getMe();
  if (!me) return <Empty>No signed-in user.</Empty>;
  const rows = (await q('select * from creative_perf')).map((r) => {
    const spend = +r.spend, value = +r.purchase_value;
    return {
      ad_id: r.ad_id, ad_name: r.ad_name, code: r.code, concept: r.concept, format: r.format, hookName: r.hook,
      strategist: r.strategist, editor: r.editor, launch: iso(r.launch_date), spend, value,
      roas: spend ? value / spend : 0, cpa: spend / (+r.purchases || 1),
      hook: +r.video_3s / (+r.impressions || 1), hold: +r.thruplays / (+r.video_3s || 1), verdict: verdict(r).key,
    };
  });
  return (
    <>
      <PageHead title="Creatives"
        sub={me.role === 'manager' ? 'Every ad the tracker sheet can place, on published days' : `Only creatives where you are the ${me.role}. The database decides this, not the page.`} />
      <CreativesTable rows={rows} />
      <p className="note">Winner = at least {money(WIN.minSpend)} spent at ROAS ≥ {WIN.roas}. Loser = at least {money(WIN.tested)} spent at ROAS below {WIN.loser}. Under {money(WIN.tested)} is too early to judge.</p>
    </>
  );
}
