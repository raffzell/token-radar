// The radar's scoring model: one sealed snapshot in, one ranked board out.
//
// What the board ranks: every protocol on the snapshot's watchlist (the floor), plus the
// strongest pre-token protocols below that floor, which the radar exists to surface early.
// A protocol counts as pre-token only when its snapshot record carries no market cap, no
// CoinGecko id and no symbol. Protocols whose token already trades are never ranked; they
// are listed apart, with the market's own market cap, so the two sets are never mixed.
//
// The implied value is the entry's own claim, computed from the snapshot's figures alone:
//
//   growth   = clamp(change_7d, -80, 200)          (null change_7d counts as 0)
//   growthF  = 1 + (growth / 100) * 0.60
//   age      = days from listed_at to the snapshot date (see unknown-age rule below)
//   maturity = 0.55 + 0.45 * sqrt(min(max(age, 0), 1460) / 1460)
//   breadth  = 1 + 0.02 * min(chains.length, 8)
//   implied  = max(1, round(tvl_usd * 0.30 * growthF * maturity * breadth))
//
// Why these shapes: growth is clamped because a single week's spike (the snapshot's
// largest is over +4000%) would otherwise swamp every other signal; maturity rises with
// the square root of age, so the first year of running with no token matters more than
// the fourth; breadth rewards protocols present on several chains, capped, because a
// multi-chain footprint is harder to fake than a single-chain one. Age is the time the
// protocol has run while its record shows no token: the longer that run, the more the
// market has had to price in a launch that has not happened yet.
//
// Unknown age: when listed_at is null, the model uses the median age of the snapshot's
// protocols that do carry a listing date, computed from the snapshot itself at run time.
// No protocol name is ever special-cased: one function scores every row, and the
// dashboard's "How it works" panel states the same formula with the same constants.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard and used by both the board and the page. */
export interface ModelParams {
  base_rate: number;
  growth_weight: number;
  growth_min: number;
  growth_max: number;
  maturity_base: number;
  maturity_span: number;
  maturity_cap_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const PARAMS: ModelParams = {
  base_rate: 0.3,
  growth_weight: 0.6,
  growth_min: -80,
  growth_max: 200,
  maturity_base: 0.55,
  maturity_span: 0.45,
  maturity_cap_days: 1460,
  breadth_per_chain: 0.02,
  breadth_max_chains: 8,
};

/** The model's version label, shown in the dashboard header. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the board carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the separate live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action to take, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The per-row breakdown of the implied value, so the dashboard can show its own working. */
export interface ValueBreakdown {
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  age_days_used: number;
  age_known: boolean;
}

/** One row of board.json. Extra keys beyond the gate's five are allowed and carry the working. */
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
  value_breakdown: ValueBreakdown;
  farm_steps: string[];
}

/** One board row as the dashboard reads it: the plan stays structured for rendering. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_breakdown: ValueBreakdown;
  on_watchlist: boolean;
  farm_steps: FarmStep[];
}

/** A protocol whose token already trades: shown apart, at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  symbol: string | null;
}

/** Everything the dashboard renders, written to data.js beside the page. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** Clamp `n` into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to four decimals for display-stable breakdown figures. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The median of a non-empty list of numbers; 0 when the list is empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** The median age of the snapshot's protocols that carry a listing date. */
export function medianAge(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    const a = ageDays(snapshot.as_of, p.listed_at);
    if (a !== null) ages.push(a);
  }
  return median(ages);
}

/** A protocol's implied value and its breakdown under the model. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  fallbackAge: number,
  params: ModelParams = PARAMS,
): { implied: number; breakdown: ValueBreakdown } {
  const knownAge = ageDays(asOf, p.listed_at);
  const ageUsed = knownAge ?? fallbackAge;
  const growthPct = clamp(typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0, params.growth_min, params.growth_max);
  const growthFactor = 1 + (growthPct / 100) * params.growth_weight;
  const ageFrac = clamp(ageUsed, 0, params.maturity_cap_days) / params.maturity_cap_days;
  const maturityFactor = params.maturity_base + params.maturity_span * Math.sqrt(ageFrac);
  const breadthFactor = 1 + params.breadth_per_chain * Math.min(p.chains.length, params.breadth_max_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * params.base_rate * growthFactor * maturityFactor * breadthFactor));
  return {
    implied,
    breakdown: {
      growth_pct: round4(growthPct),
      growth_factor: round4(growthFactor),
      maturity_factor: round4(maturityFactor),
      breadth_factor: round4(breadthFactor),
      age_days_used: ageUsed,
      age_known: knownAge !== null,
    },
  };
}

/** Whether the snapshot record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker (V2, v3, 2.0): a versioned pool, not a standalone protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether a below-floor protocol may join the early radar: pre-token, not an exchange
 * listing, and not a versioned pool. Watchlist rows are never filtered: the gate's
 * coverage row covers every watchlist slug whatever its record says.
 */
export function isEarlyEligible(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSION_SUFFIX.test(p.name);
}

/** Deterministic order for equal scores: slug ascending, code-unit order. */
function bySlugAsc(a: SnapshotProtocol, b: SnapshotProtocol): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** The ranked board: every watchlist slug plus the strongest early protocols below the floor. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = PARAMS): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const fallbackAge = medianAge(snapshot);
  const picked = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isEarlyEligible(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, EARLY_ROWS);
  for (const p of early) picked.set(p.slug, p);

  const scored = [...picked.values()].map((p) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, fallbackAge, params);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || bySlugAsc(a.p, b.p));
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
    token_status: 'pre-token' as const,
    age_days: ageDays(snapshot.as_of, s.p.listed_at),
    implied_value_usd: s.implied,
    value_breakdown: s.breakdown,
    farm_steps: farmPlan(s.p, ageDays(snapshot.as_of, s.p.listed_at)).map(stepToString),
  }));
}

/** One farm step as a single string: action, cost and time, within the gate's 20..600 characters. */
export function stepToString(step: FarmStep): string {
  const joined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  const trimmed = joined.trim();
  if (trimmed.length > 600) return `${trimmed.slice(0, 597).trimEnd()}...`;
  return trimmed;
}

/** The protocol's first listed chain, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** How much capital one farm position needs, tiered by the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 10_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold the position, from the protocol's age: younger runs need longer windows. */
function holdDays(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 45;
}

/** Gas for one action on the protocol's first chain, in whole dollars, from chain cost tiers. */
function gasDollars(chain: string): number {
  const cheap = ['solana', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'mode', 'linea', 'scroll', 'zksync', 'mantle', 'sei', 'sui', 'aptos'];
  return cheap.includes(chain.toLowerCase()) ? 1 : 6;
}

/**
 * The category's core farming action, in words a reader can follow. Matching is on the
 * snapshot's category string alone; no protocol name is ever consulted here.
 */
function coreAction(p: SnapshotProtocol, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${stake} of USDC into ${n} on ${chain}, then borrow a small amount against it so both sides of the position are active.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Add $${stake} of liquidity to ${n}'s highest-volume pool on ${chain} and leave the position in range.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${stake} of USDC into ${chain} through ${n}, then use the bridged funds once inside the destination app.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${stake} through ${n} on ${chain} and keep the liquid receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${stake} of USDC as margin on ${n} and open one small hedged position, then close it the same week.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${stake} into ${n}'s basis strategy on ${chain} and hold the receipt for the full window.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${stake} of ${n}'s tokenised asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return `Deposit $${stake} into ${n}'s highest-TVL vault on ${chain} and let the yield compound untouched.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) {
    return `Allocate $${stake} to a ${n} vault on ${chain} and keep the vault shares for the full window.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${stake} on ${n} and take one small position in an active market, then hold it to settlement.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${stake} of cover from ${n} on ${chain} and keep the policy active for the full window.`;
  }
  if (c.includes('stable') || c.includes('algo')) {
    return `Mint or hold $${stake} of the stable asset through ${n} on ${chain} and keep it in the farming wallet.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${stake} in ${n}'s launch pool on ${chain} and join one sale allocation while the position is open.`;
  }
  if (c.includes('synthetic')) {
    return `Mint $${stake} of ${n}'s synthetic asset on ${chain} and hold it for the full window.`;
  }
  return `Deposit $${stake} of USDC into ${n} on ${chain} and keep the position open for the full window.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. Every
 * number in the plan comes from the protocol's own snapshot record (category, chains,
 * TVL, age); the wording is templated, never hand-written per protocol.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const stake = stakeSize(p);
  const hold = holdDays(age);
  const gas = gasDollars(chain);
  const chainsNote = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(' and ')}; repeat the position on one more chain only after the first is set.` : '';
  return [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline, never in a screenshot or a note on the same machine.`,
      cost: `about $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: coreAction(p, stake, chain) + chainsNote,
      cost: `$${stake} of capital plus about $${gas * 2} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Return once a week and make one real action: a deposit, a withdrawal and re-deposit, a swap, or a governance vote where the protocol offers one.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity spans several weekly snapshots instead of a single one.`,
      cost: `the $${stake} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before touching any claim, open the protocol's own points or rewards page from its official channel and check the wallet's standing; never pay anyone to claim for you.`,
      cost: 'free to check, and a claim that asks for payment is a scam',
      time: '10 minutes',
    },
    {
      text: `Log the wallet address, the dates, the amounts and every transaction hash in a farm journal, and plan the unwind in the reverse order of the entry steps.`,
      cost: 'nothing but the journal',
      time: '5 minutes to write, 15 minutes to unwind',
    },
  ];
}

/** The live-token set, by market cap, for the dashboard's separate live view. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
    }));
}

/** A board row's compact form for data.js, keeping the plan structured for the page. */
export function toRadarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  const protocol: SnapshotProtocol = {
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    gecko_id: row.gecko_id,
    symbol: row.symbol,
  };
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_breakdown: row.value_breakdown,
    on_watchlist: watchlist.has(row.slug),
    farm_steps: farmPlan(protocol, row.age_days),
  };
}

/** Everything the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = PARAMS): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, params);
  const live = liveSet(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: params,
    model_version: MODEL_VERSION,
    median_age_days: medianAge(snapshot),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    rows: board.map((row) => toRadarRow(row, watch)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json carries no as_of date');
  }
  if (typeof doc.source !== 'string' || doc.source.length === 0) {
    throw new SnapshotError('snapshot.json carries no source');
  }
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json carries no positive whole floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json carries no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json carries no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`protocol ${i} in snapshot.json is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== 'string' || e.slug.length === 0 || typeof e.name !== 'string' || e.name.length === 0) {
      throw new SnapshotError(`protocol ${i} in snapshot.json lacks a slug or a name`);
    }
    if (typeof e.tvl_usd !== 'number' || !Number.isFinite(e.tvl_usd) || e.tvl_usd < 0) {
      throw new SnapshotError(`protocol ${i} in snapshot.json lacks a usable tvl_usd`);
    }
    const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: e.slug,
      name: e.name,
      category: strOrNull(e.category),
      chains: Array.isArray(e.chains) ? e.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: e.tvl_usd,
      change_7d: numOrNull(e.change_7d),
      mcap_usd: numOrNull(e.mcap_usd),
      listed_at: strOrNull(e.listed_at),
      gecko_id: strOrNull(e.gecko_id),
      symbol: strOrNull(e.symbol),
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: [...(doc.watchlist as string[])],
  };
}

/**
 * Why a board is not one the gate will take, or null. Mirrors the gate's own rows:
 * watchlist coverage, ranks exactly 1..N, implied value never rising with rank, more
 * than one distinct value, and farm steps 3..12 of 20..600 characters each.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const seen = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug(s), first: ${missing.slice(0, 3).join(', ')}`;
  if (board.length < 100) return `board holds ${board.length} rows, fewer than the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..N: position ${i + 1} holds rank ${ranks[i]}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `rank ${byRank[i]!.rank} outvalues rank ${byRank[i - 1]!.rank}`;
    }
  }
  const distinct = new Set(board.map((r) => r.implied_value_usd));
  if (board.length >= 2 && distinct.size === 1) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} carries implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} carries ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} carries a farm step of ${len} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network, deterministic bytes. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
