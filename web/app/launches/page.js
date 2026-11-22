import { q, money } from '../../lib/db';

export default async function Page() {
  const [me] = await q('select * from app_users where id = auth.uid()');
  const rows = await q(`select l.*, a.person requester, r.person reviewer from launch_requests l
    left join app_users a on a.id = l.requested_by left join app_users r on r.id = l.reviewed_by order by l.id desc`);
  return (
    <>
      <h1>Launch queue</h1>
      <p className="note">Strategists request a test. A manager other than the requester approves it. The launcher then creates the ad set and ad in Meta, always PAUSED, and refuses anything over $500/day per test or $3,000/day of new test budget in total. Turning an ad on is a manual step in Ads Manager. {me.role === 'editor' && 'Editors cannot request launches.'}</p>
      <div className="scroll"><table><thead><tr><th>#</th><th className="l">Ad name</th><th className="l">Requested by</th><th>Daily budget</th><th className="l">Status</th><th className="l">Reviewed by</th><th className="l">Meta ad (PAUSED)</th><th className="l">Note</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.id}</td><td className="l">{r.ad_name}</td><td className="l">{r.requester}</td><td>{money(r.daily_budget_cents / 100)}</td>
          <td className="l"><span className={`tag ${r.status === 'created' ? 'pass' : r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'info' : 'fail'}`}>{r.status}</span></td>
          <td className="l">{r.reviewer || '–'}</td><td className="l">{r.meta_ad_id || '–'}</td><td className="l">{r.error || ''}</td></tr>)}
        </tbody></table></div>
      {rows.length === 0 && <p className="note">Nothing visible to you here.</p>}
    </>
  );
}
