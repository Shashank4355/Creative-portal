'use client';
import { useEffect, useRef, useState } from 'react';

const FMT = {
  money: (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? '$' + Math.round(v / 1e3) + 'K'
    : v >= 1e3 ? '$' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : '$' + Math.round(v)),
  moneyFull: (v) => '$' + Math.round(v).toLocaleString('en-US'),
  ratio: (v) => Number(v).toFixed(2),
};
const niceMax = (m) => {
  if (!(m > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(m)), f = m / p;
  return [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => f <= s) * p;
};
const label = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// One y-axis, 2px lines, area wash on the first series, crosshair + tooltip on hover.
// series: [{ name, color: 'var(--series-1)', values: number[] }]
export default function LineChart({ dates, series, fmt = 'money', height = 260, refLine, area = true }) {
  const box = useRef(null);
  const [w, setW] = useState(720);
  const [hi, setHi] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const pad = { l: 48, r: 14, t: 10, b: 26 };
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), refLine?.value || 0));
  const x = (i) => pad.l + (dates.length < 2 ? 0 : (i * iw) / (dates.length - 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(dates.length / Math.max(2, Math.floor(iw / 70)));
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const f = FMT[fmt], ft = FMT[fmt === 'money' ? 'moneyFull' : fmt];

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (dates.length - 1));
    setHi(Math.max(0, Math.min(dates.length - 1, i)));
  };

  return (
    <div className="lc" ref={box}>
      {series.length > 1 && (
        <div className="lc-legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
      )}
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHi(null)} role="img"
        aria-label={series.map((s) => s.name).join(', ') + ' by day'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="lc-grid" />
            <text x={pad.l - 8} y={y(t)} className="lc-tick" textAnchor="end" dominantBaseline="middle">{f(t)}</text>
          </g>
        ))}
        {dates.map((d, i) => ((i % every === 0 && dates.length - 1 - i >= every * 0.6) || i === dates.length - 1) && (
          <text key={d} x={x(i)} y={height - 6} className="lc-tick" textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}>{label(d)}</text>
        ))}
        {refLine && (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={y(refLine.value)} y2={y(refLine.value)} className="lc-ref" />
            <text x={w - pad.r} y={y(refLine.value) - 5} textAnchor="end" className="lc-tick">{refLine.label}</text>
          </g>
        )}
        {area && series[0] && (
          <path d={`${path(series[0].values)} L${x(dates.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={series[0].color} opacity="0.08" />
        )}
        {series.map((s) => <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {series.map((s) => (
          <circle key={s.name} cx={x(dates.length - 1)} cy={y(s.values.at(-1))} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
        ))}
        {hi != null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={pad.t + ih} className="lc-cross" />
            {series.map((s) => <circle key={s.name} cx={x(hi)} cy={y(s.values[hi])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hi != null && (
        <div className="lc-tip" style={{ left: Math.min(x(hi) + 12, w - 190), top: 28 }}>
          <b>{label(dates[hi])}</b>
          {series.map((s) => <div key={s.name}><i style={{ background: s.color }} />{s.name}<span>{ft(s.values[hi])}</span></div>)}
        </div>
      )}
    </div>
  );
}
