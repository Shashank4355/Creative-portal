import { q, money, ratio, pct, WIN } from '../../lib/db';

export default async function Page() {
  const rows = await q(`select * from creative_perf order by spend desc`);
  const verdict = (r) => {
    const roas = Number(r.purchase_value) / Number(r.spend);
    if (Number(r.spend) >= WIN.minSpend && roas >= WIN.roas) return ['Winner', 'pass'];
    if (Number(r.spend) < 300) return ['Too little spend', 'info'];
    return roas < 1.6 ? ['Loser', 'fail'] : ['Middle', 'warn'];
  };
  return (
    <>
      <h1>Creatives ({rows.length})</h1>
      <div className="scroll"><table>
        <thead><tr><th>Code</th><th className="l">Concept / format / hook</th><th className="l">Strategist</th><th className="l">Editor</th><th>Launched</th><th>Spend</th><th>ROAS</th><th>CPA</th><th>Hook</th><th>Hold</th><th className="l">Verdict</th></tr></thead>
        <tbody>{rows.map((r) => { const [v, c] = verdict(r); return (
          <tr key={r.ad_id}><td>{r.code}</td><td className="l">{r.concept} · {r.format} · {r.hook}</td><td className="l">{r.strategist}</td><td className="l">{r.editor}</td>
            <td>{r.launch_date?.toISOString?.().slice(0, 10)}</td><td>{money(r.spend)}</td><td>{ratio(r.purchase_value, r.spend)}</td>
            <td>{money(Number(r.spend) / Number(r.purchases || 1))}</td><td>{pct(r.video_3s, r.impressions)}</td><td>{pct(r.thruplays, r.video_3s)}</td>
            <td className="l"><span className={`tag ${c}`}>{v}</span></td></tr>); })}
        </tbody></table></div>
    </>
  );
}
