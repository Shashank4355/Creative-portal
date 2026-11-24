import { me as getMe } from '../../lib/db';
import { visibleVariants, report } from '../../lib/video';
import { PageHead, Card, Tag, Icon, Empty } from '../ui';

const kb = (b) => Math.round(b / 1024) + ' KB';

export default async function Page() {
  const me = await getMe();
  if (!me) return <Empty>No signed-in user.</Empty>;
  const variants = visibleVariants(me);
  const allOk = variants.every((v) => v.captionFits && v.outputs.every((o) => o.ok));
  return (
    <>
      <PageHead title="Hook-swap variants" sub="One body clip + three hooks → three ads, each in 9:16 and 4:5, captioned, loudness normalised to −14 LUFS, named in the tracker’s convention">
        {variants.length > 0 && <Tag tone={allOk ? 'pass' : 'fail'}>{allOk ? `${variants.length * 2} of ${variants.length * 2} outputs passed QA` : 'QA failures'}</Tag>}
      </PageHead>

      {report().length === 0 ? (
        <Empty icon="video">No variants rendered yet. Run <code>node video/hookswap.js</code> from the repo root.</Empty>
      ) : variants.length === 0 ? (
        <Empty>None of the rendered variants are yours, {me.person}. Variants are shown to managers and to the strategist and editor named in the file name.</Empty>
      ) : (
        <>
          <div className="vgrid">{variants.map((v) => {
            const [f916, f45] = v.outputs;
            const code = v.name.match(/_(C\d+)$/)[1], hook = v.name.split('_')[4];
            return (
              <div className="vcard" key={v.name}>
                <div className="players">
                  <div><video src={`/api/media/${f916.file}`} poster={`/api/media/${v.name}_thumb.jpg`} controls muted playsInline preload="metadata" /><small>9:16 · {f916.w}×{f916.h}</small></div>
                  <div><video src={`/api/media/${f45.file}`} controls muted playsInline preload="metadata" /><small>4:5 · {f45.w}×{f45.h}</small></div>
                </div>
                <div className="vb">
                  <div className="row" style={{ justifyContent: 'space-between' }}><b>{code} · {hook} hook</b><Tag tone="pass">ready to queue</Tag></div>
                  <div className="cap-text">“{v.captionLines.join(' ')}”</div>
                  <div className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{v.name}</div>
                  <div className="checks-mini">
                    <Tag tone={v.captionFits ? 'pass' : 'fail'}>caption fits ({v.captionLines.length} lines)</Tag>
                    {v.outputs.map((o) => <Tag key={o.file} tone={o.ok ? 'pass' : 'fail'}>{o.w}×{o.h} · {o.duration}s · {o.audio ? 'audio' : 'no audio'} · {kb(o.bytes)}</Tag>)}
                  </div>
                </div>
              </div>
            );
          })}</div>

          <div className="grid g2">
            <Card title="Contact sheet" sub="One frame from each hook, the check that caught what automated QA missed">
              <img className="shot" src="/api/media/hooks_contact_sheet.jpg" alt="First frames of the three hook variants side by side" />
            </Card>
            <Card title="Same frame, both crops" sub="Captions sit in the area both the 9:16 and the 4:5 crop keep">
              <img className="shot" src="/api/media/pov_9x16_vs_4x5.jpg" alt="The POV variant in 9:16 next to its 4:5 crop" />
            </Card>
          </div>

          <Card title="What the first run got wrong">
            <ul className="fixlist">
              <li><Icon name="alert" /><span><b>A caption ran off the frame</b> and the size/duration/audio QA still passed it. Captions now wrap at 22 characters, and a width check refuses any line wider than the 960px safe zone.</span></li>
              <li><Icon name="alert" /><span><b>The 4:5 crop cut the top 285px</b> of every video, captions included. Captions now start at y ≥ 380, inside the area both crops keep.</span></li>
              <li><Icon name="check" /><span><b>Every output is checked</b> for dimensions, duration and an audio stream before it can be queued as a launch request.</span></li>
            </ul>
          </Card>
        </>
      )}
      <p className="note">Stand-in footage generated for the demo, not real ads.</p>
    </>
  );
}
