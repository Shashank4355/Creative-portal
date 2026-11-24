'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const money = (x) => '$' + Math.round(x).toLocaleString('en-US');
const VERDICTS = [['all', 'All'], ['winner', 'Winners'], ['middle', 'Middle'], ['loser', 'Losers'], ['early', 'Under $300']];
const TONE = { winner: 'pass', middle: 'warn', loser: 'fail', early: 'info' };
const LABEL = { winner: 'Winner', middle: 'Middle', loser: 'Loser', early: 'Too little spend' };
const COLS = [
  ['code', 'Code', 'l'], ['concept', 'Concept · format · hook', 'l'], ['strategist', 'Strategist', 'l'], ['editor', 'Editor', 'l'],
  ['launch', 'Launched', ''], ['spend', 'Spend', ''], ['roas', 'ROAS', ''], ['cpa', 'CPA', ''], ['hook', 'Hook', ''], ['hold', 'Hold', ''], ['verdict', 'Verdict', 'l'],
];

export default function CreativesTable({ rows }) {
  const router = useRouter();
  const [qText, setQ] = useState('');
  const [v, setV] = useState('all');
  const [st, setSt] = useState('');
  const [ed, setEd] = useState('');
  const [fmt, setFmt] = useState('');
  const [sort, setSort] = useState(['spend', -1]);
  const opts = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))].sort();

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();
    const out = rows.filter((r) => (v === 'all' || r.verdict === v) && (!st || r.strategist === st) && (!ed || r.editor === ed) && (!fmt || r.format === fmt)
      && (!t || `${r.code} ${r.ad_name} ${r.concept} ${r.hook}`.toLowerCase().includes(t)));
    const [k, dir] = sort;
    return out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
  }, [rows, qText, v, st, ed, fmt, sort]);

  const counts = Object.fromEntries(VERDICTS.map(([k]) => [k, k === 'all' ? rows.length : rows.filter((r) => r.verdict === k).length]));
  const tot = filtered.reduce((s, r) => ({ spend: s.spend + r.spend, value: s.value + r.value }), { spend: 0, value: 0 });

  const csv = () => {
    const head = ['code', 'ad_name', 'concept', 'format', 'hook', 'strategist', 'editor', 'launch_date', 'spend', 'purchase_value', 'roas', 'cpa', 'hook_rate', 'hold_rate', 'verdict'];
    const lines = filtered.map((r) => [r.code, r.ad_name, r.concept, r.format, r.hook, r.strategist, r.editor, r.launch, r.spend.toFixed(2), r.value.toFixed(2), r.roas.toFixed(2), r.cpa.toFixed(2), r.hook.toFixed(4), r.hold.toFixed(4), r.verdict]
      .map((x) => `"${String(x ?? '').replaceAll('"', '""')}"`).join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'creatives.csv' });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="vchips">{VERDICTS.map(([k, l]) => (
          <button key={k} className={`vchip ${v === k ? 'on' : ''}`} onClick={() => setV(k)}>
            {k !== 'all' && <span className={`sw ${TONE[k]}`} />}{l}<b>{counts[k]}</b></button>))}
        </div>
        <div className="filters">
          <input type="search" placeholder="Search code, concept, hook…" value={qText} onChange={(e) => setQ(e.target.value)} />
          <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">All strategists</option>{opts('strategist').map((o) => <option key={o}>{o}</option>)}</select>
          <select value={ed} onChange={(e) => setEd(e.target.value)}><option value="">All editors</option>{opts('editor').map((o) => <option key={o}>{o}</option>)}</select>
          <select value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="">All formats</option>{opts('format').map((o) => <option key={o}>{o}</option>)}</select>
          <button className="btn" onClick={csv} title="Download the filtered rows as CSV">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>CSV</button>
        </div>
      </div>
      <p className="note">{filtered.length} creatives · {money(tot.spend)} spend · ROAS {tot.spend ? (tot.value / tot.spend).toFixed(2) : '–'} · click a row for its daily numbers</p>
      <div className="scroll card" style={{ padding: 0 }}><table style={{ border: 0 }}>
        <thead><tr>{COLS.map(([k, l, a]) => (
          <th key={k} className={`sort ${a} ${sort[0] === k ? 'on' : ''}`} onClick={() => setSort([k, sort[0] === k ? -sort[1] : (a === 'l' ? 1 : -1)])}>
            {l}{sort[0] === k ? (sort[1] > 0 ? ' ↑' : ' ↓') : ''}</th>))}</tr></thead>
        <tbody>{filtered.map((r) => (
          <tr key={r.ad_id} className="click" onClick={() => router.push(`/creatives/${r.ad_id}`)}>
            <td><b>{r.code}</b></td>
            <td className="l">{r.concept} · {r.format} · {r.hookName}</td>
            <td className="l">{r.strategist}</td><td className="l">{r.editor}</td><td>{r.launch}</td>
            <td>{money(r.spend)}</td>
            <td className={r.roas >= 2.5 ? 'good-n' : r.roas < 1.6 ? 'bad-n' : ''}>{r.roas.toFixed(2)}</td>
            <td>{money(r.cpa)}</td><td>{(r.hook * 100).toFixed(1)}%</td><td>{(r.hold * 100).toFixed(1)}%</td>
            <td className="l"><span className={`tag ${TONE[r.verdict]}`}>{LABEL[r.verdict]}</span></td>
          </tr>))}
        </tbody>
      </table></div>
      {filtered.length === 0 && <div className="empty">Nothing matches these filters.</div>}
    </>
  );
}
