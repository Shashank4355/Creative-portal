# creative-ops

A first working version of a creative performance portal for a DTC brand, plus the
two pieces that usually come next: a guarded ad launcher and a hook-swap video pipeline.

Everything runs locally against mocks of the Meta Marketing API, Google Sheets and the
Shopify Admin API. The brand (Fernlow, sleep and bedding) and all of its data are
made up: 30 days, 115 ads, about $283k of Meta spend and about $1.05M of Shopify net sales.
No real account, token or customer was used.

## What it does

**Portal (Next.js, Postgres with Supabase-style RLS).** Pulls Meta insights at ad level and
account level, joins each ad to the creative tracker sheet by the code in the ad name, and
shows how each strategist and editor performs: spend, purchase value, ROAS, CPA, hook rate,
hold rate, winners and hit rate.

**Data checks before anyone sees a number.**
- Ad-level spend, purchases and purchase value must equal Meta's own account total for the
  day, or the day is held off the leaderboard. All 30 days match to the cent.
- Meta returns `purchase`, `omni_purchase` and `offsite_conversion.fb_pixel_purchase` for the
  same conversions. Only one is counted.
- Archived and deleted ads drop out of an ad-level pull unless you filter on
  `ad.effective_status`. The sync asks for them.
- Sheet problems are listed with the spend they affect: codes typed in lower case or with
  spaces (fixed), legacy ad names (matched on the Ad ID column), ads nobody logged, and a
  code pasted twice with two different strategists (not credited to anyone until fixed).
- Shopify net sales leave out tax, shipping, refunds and test orders. Meta vs Shopify is shown
  for context with the reason they differ, not as a pass/fail.

What a rushed first version reports on the same data: ROAS **7.28** (purchases counted three
times, archived ads missing, 0 of 30 days matching the account). The real number is **2.37**.

**Access.** Every query runs as the logged-in user under Postgres row-level security.
A strategist sees only their own creatives, an editor only the ones they cut, managers see
everything, account totals and Shopify revenue are manager-only, anonymous gets nothing.
The read token (`ads_read`) and the write token (`ads_management`) are separate, and only the
launcher reads the write token. Secrets live in `.env`, which is gitignored.

**Money.** Strategists request a test, a manager other than the requester approves it
(enforced in RLS, not just the UI). The launcher creates the ad set and ad in Meta, always
`PAUSED`, refuses more than $500/day per test or $3,000/day of new test budget, retries Meta
throttling (#80004) without creating duplicates, has a kill switch and dry-runs by default.
Reviewers can't change the budget while approving.

**Video.** `video/hookswap.js` takes one body clip and three hook clips and renders each
variant in 9:16 and 4:5 with captions and loudness normalised to -14 LUFS, names them in the
tracker's convention, and checks size, duration and audio on every output. The first run let a
caption run off the frame and the 4:5 crop cut the top 285px; captions now wrap, have a
width check, and sit inside the area both crops keep. The source clips are generated test
footage, not real ads.

## Run it

```
npm install && (cd web && npm install)
cp .env.example .env
node scripts/generate.js          # synthetic brand data
node mock/server.js               # mock Meta / Sheets / Shopify on :4010 (leave running)
BACKOFF_UNIT_MS=50 node sync/run.js
node scripts/seed_launches.js     # a launch queue, through the guarded path
node --test tests/all.test.js     # 19 tests
node db/server.js                 # data API on :4020 (stands in for Supabase's API)
cd web && npm run dev             # portal on :3210
node video/hookswap.js            # needs Windows Arial; change FONT elsewhere
```

## Tests (19, all passing)

Data: purchase counted once; ad-level = account total on all 30 days; missing archived ads
are caught; messy sheet join; Shopify net sales; throttling retried.
Access: strategist and editor scoping; manager-only revenue; anonymous denied; editors
can't request launches; no tokens in source.
Money: no self-approval; reviewers can't raise budgets; caps in code and in the database;
double-submit makes one request; publish creates everything PAUSED, holds back over the
daily cap, survives #80004, and a rerun creates nothing new; kill switch; read token can't write.

## Not done yet

- Runs against mocks. Pointing it at a real ad account, sheet and store is a config change
  plus a first reconciliation against Ads Manager and Shopify reports by hand.
- Supabase Auth login (the demo picks a user from a dropdown; queries still go through RLS).
- Re-pulling the trailing 7 days each night so late-attributed conversions update. The upsert
  is there; the schedule isn't.
- Activating ads is left to a person in Ads Manager on purpose.
