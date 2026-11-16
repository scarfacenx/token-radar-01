// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can score, strongest first.
// The watchlist is the floor, never the ceiling: all 40 of its slugs are on the board,
// plus every other rankable pre-token protocol below the floor. Live-token protocols
// are never mixed into the ranking; they are shown apart with the market's own values.
//
// Implied value follows only from the snapshot's own figures — TVL, seven-day growth,
// how long the protocol has run with no token, how many chains it runs on, and its
// category. The same function scores every row — no protocol's figures are
// adjusted by name. One exception, and it is in the open: the exclusion rule
// does not apply to the watchlist. The gate requires all 40 of its slugs on
// the board, so a watchlist slug the rule would catch (b14g, Reti Pooling,
// Saturn) is still ranked, and the dashboard says so.
//
//   base       = category_multiple x tvl_usd^0.92
//   growth     = clamp(change_7d, -60, 150) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.55 + min(age_days, 1460) / 1460 x 0.45   (age unknown: 365)
//   chainMult  = 1 + 0.03 x min(chains - 1, 5)
//   implied    = max(1, round(base x growthMult x maturity x chainMult))
//
// The 0.92 exponent on TVL says size has diminishing returns: a protocol ten times
// bigger is not automatically ten times more valuable. The category multiple says a
// dollar of TVL is worth more where a token has historically carried more of it:
// lending and exchange protocols above bridges and staking products. The constants
// are stated in the dashboard and changeable in its model sandbox.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  tvl_exponent: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_steps: number;
}

export const MODEL: ModelConstants = {
  tvl_exponent: 0.92,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_max_steps: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * What one dollar of TVL is worth as a future token, by the protocol's own category.
 * Lending, exchanges and yield venues have historically carried the most token value
 * per dollar locked. The board's filter never admits a bridge, staking product or
 * exchange, so their low multiples below are a safety net, not a ranking: the value
 * usually sits with the asset they wrap or stake, not with the venue itself.
 */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 0.35;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual')) return 0.35;
  if (c.includes('yield') || c.includes('leveraged farm')) return 0.32;
  if (c.includes('rwa') || c.includes('onchain capital') || c.includes('risk curator')) return 0.3;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked')) return 0.15;
  if (c.includes('bridge')) return 0.12;
  if (c.includes('cex')) return 0.1;
  return 0.25;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan board.json carries. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  // listed_at is a UTC day, but a record may carry a full timestamp: the day is
  // its first ten characters either way, and anything unparsable is still null.
  const day = listedAt.slice(0, 10);
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Math.max(protocol.chains.length, 1);
  const chainMult = 1 + model.chain_step * Math.min(chainCount - 1, model.chain_max_steps);
  const multiple = categoryMultiple(protocol.category);
  const base = multiple * Math.pow(Math.max(protocol.tvl_usd, 1), model.tvl_exponent);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking: a product of another token. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/**
 * A name token that is a receipt for an asset that already trades: a known asset
 * symbol with a short receipt prefix (st, cb, av, w, …) or an x suffix — stHYPE,
 * avETH, YBTC, wBTC, USDCx. A bare asset symbol alone is not a receipt, and a
 * brand that only mentions an asset (BTCFi, Hyperliquid) is not one either.
 */
const RECEIPT_TICKER = /^(?:([a-z]{1,4}))?(BTC|ETH|SOL|USDC|USDT|HYPE|USDE|DAI)(x)?$/i;

/** Whether one whitespace-separated token of a name is such a receipt ticker. */
function hasReceiptTicker(name: string): boolean {
  return name.split(/\s+/).some((token) => {
    const m = token.match(RECEIPT_TICKER);
    return m !== null && (m[1] !== undefined || m[3] !== undefined);
  });
}

/** A name beginning with an exchange's name: the exchange's own product. */
const EXCHANGE_NAMED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Categories that are a product of a token that already trades, not a protocol of
 * their own. Matched as substrings, not an exact set: the house's own list
 * (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX)
 * is in here, and so are the forms it misses — Cross Chain Bridge is a bridge,
 * and an Anchor BTC, a Decentralized BTC, a Stablecoin Wrapper, a Staking Pool
 * or a Restaking venue wraps an asset that already trades, so its value sits
 * with that asset, not with the venue.
 */
const PRODUCT_CATEGORY_WORDS = [
  'bridge',
  'liquid staking',
  'liquid restaking',
  'restaked',
  'restaking',
  'cex',
  'anchor btc',
  'decentralized btc',
  'stablecoin wrapper',
  'staking pool',
];

/** Whether a category names such a product. */
function isProductCategory(category: string | null): boolean {
  const c = (category ?? '').toLowerCase();
  return PRODUCT_CATEGORY_WORDS.some((w) => c.includes(w));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank. The watchlist's own exclusion rule,
 * applied to the whole board and extended to the forms the snapshot's ten fields can
 * still name: a wrapped, staked or bridged product of a token that already trades
 * is not a protocol still waiting on a launch of its own, so Binance staked ETH,
 * WBTC and their kin are never ranked, whatever their TVL — whether the name says
 * so in words (wrapped, staked), in a receipt ticker (stHYPE, avETH, YBTC), or in
 * a wrapper category (Anchor BTC, Stablecoin Wrapper, Cross Chain Bridge). The
 * snapshot does not carry DefiLlama's parentProtocol field, so that part of the
 * rule cannot be checked here; the fields it does carry are all applied. The
 * watchlist itself is the floor and is never filtered by this rule: the gate
 * requires every one of its 40 slugs on the board, so a watchlist slug the rule
 * would catch is still ranked, and the dashboard says so.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !isProductCategory(p.category) &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_OR_STAKED.test(p.name) &&
    !hasReceiptTicker(p.name) &&
    !EXCHANGE_NAMED.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries
  // (it cannot, but the board's coverage is the gate's row and is never gambled on a
  // missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. No cap:
  // the radar exists to find the early ones, and the gate allows up to 4,000 rows.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: s.v.multiple,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 595)}…`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as a lender, and borrow $20 against it once so the position counts as active.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the pair it lists first, and keep the position open.`;
  }
  if (c.includes('bridge') || c.includes('canonical bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the other side.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small hedged trade, and close it after a day.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one market position that settles after the next event it lists.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it for the full window.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full window.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondChain === null
        ? `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote on the protocol's app.`
        : `Repeat the same position once on ${secondChain} so the activity shows on a second chain, not only on ${chain}.`,
      cost: secondChain === null ? 'about $2 of gas a week' : `about $${capital >= 150 ? 8 : 4} of gas for the second position`,
      time: secondChain === null ? '10 minutes a week' : '15 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and check what you earned.`,
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and plan the exit: unstake, close the position and move the funds back in one session.`,
      cost: 'nothing but the log and about $3 of gas to exit',
      time: '5 minutes to log, 15 minutes to exit',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan board.json carries. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const watchlistSet = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlistSet)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
