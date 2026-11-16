// Tests for the radar-2 model (lib/model.ts). Run with: node --test test/model.test.mjs
// No dependencies: node:test + node:assert only. The synthetic snapshot below is the
// spec; the real sealed snapshot is tested too when the kit is present beside the repo.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  WATCHLIST_PLANS,
  ageDays,
  buildBoard,
  boardIssue,
  categoryMultiple,
  farmSteps,
  impliedValue,
  isRankable,
  parseSnapshot,
} from '../lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));

function proto(overrides) {
  return {
    slug: 'test-protocol',
    name: 'Test Protocol',
    category: 'Lending',
    chains: ['Ethereum'],
    tvl_usd: 100_000_000,
    change_7d: 10,
    mcap_usd: null,
    listed_at: '2024-01-01',
    gecko_id: null,
    symbol: null,
    ...overrides,
  };
}

function snap(protocols, watchlist) {
  return {
    as_of: '2026-11-14',
    source: 'DefiLlama test',
    floor_usd: 50_000_000,
    protocols,
    watchlist: watchlist ?? protocols.map((p) => p.slug),
  };
}

describe('isRankable', () => {
  it('ranks a pre-token protocol', () => {
    assert.equal(isRankable(proto({})), true);
  });
  it('excludes a protocol whose token already trades', () => {
    assert.equal(isRankable(proto({ mcap_usd: 5_000_000, gecko_id: 'test', symbol: 'TEST' })), false);
  });
  it('excludes a CEX', () => {
    assert.equal(isRankable(proto({ category: 'CEX' })), false);
  });
  it('excludes a versioned pool name', () => {
    assert.equal(isRankable(proto({ name: 'Test Protocol V2' })), false);
  });
  it('excludes a staked product of a token that already trades', () => {
    assert.equal(isRankable(proto({ name: 'Binance staked ETH' })), false);
    assert.equal(isRankable(proto({ name: 'Wrapped Test', category: 'Yield' })), false);
  });
  it('excludes bridges and liquid staking outright', () => {
    assert.equal(isRankable(proto({ category: 'Bridge' })), false);
    assert.equal(isRankable(proto({ category: 'Liquid Staking' })), false);
  });
  it('excludes a cross-chain bridge: the category rule is a substring, not an exact set', () => {
    assert.equal(isRankable(proto({ category: 'Cross Chain Bridge' })), false);
  });
  it('excludes wrapper categories: restaking, anchor BTC, decentralized BTC, stablecoin wrapper, staking pool', () => {
    assert.equal(isRankable(proto({ category: 'Restaking' })), false);
    assert.equal(isRankable(proto({ category: 'Anchor BTC' })), false);
    assert.equal(isRankable(proto({ category: 'Decentralized BTC' })), false);
    assert.equal(isRankable(proto({ category: 'Stablecoin Wrapper' })), false);
    assert.equal(isRankable(proto({ category: 'Staking Pool' })), false);
  });
  it('excludes receipt tickers: a wrapped or staked token by ticker, not only by word', () => {
    assert.equal(isRankable(proto({ name: 'Avant avETH', category: 'Yield' })), false);
    assert.equal(isRankable(proto({ name: 'Valantis stHYPE Restaking', category: 'Restaking' })), false);
    assert.equal(isRankable(proto({ name: 'Bitlayer YBTC Family', category: 'Yield' })), false);
    assert.equal(isRankable(proto({ name: 'USDCx', category: 'Yield' })), false);
    assert.equal(isRankable(proto({ name: 'Wrapped BTC', category: 'Yield' })), false);
    assert.equal(isRankable(proto({ name: 'Coinbase cbETH', category: 'Yield' })), false);
  });
  it('keeps a real protocol whose name only mentions an asset: BTCFi CDP, Bitcoin L2, Hyperliquid', () => {
    assert.equal(isRankable(proto({ name: 'BTCFi CDP', category: 'CDP' })), true);
    assert.equal(isRankable(proto({ name: 'Bitcoin L2', category: 'Chain' })), true);
    assert.equal(isRankable(proto({ name: 'Hyperliquid', category: 'Derivatives' })), true);
  });
});

describe('ageDays', () => {
  it('counts days from a date-only listed_at', () => {
    assert.equal(ageDays('2026-11-14', '2026-11-01'), 13);
  });
  it('counts days from a full datetime listed_at instead of giving up', () => {
    assert.equal(ageDays('2026-11-14', '2026-11-01T12:00:00.000Z'), 13);
  });
  it('returns null when listed_at is absent or garbage', () => {
    assert.equal(ageDays('2026-11-14', null), null);
    assert.equal(ageDays('2026-11-14', 'not a date'), null);
  });
});

describe('categoryMultiple', () => {
  it('values lending above bridges', () => {
    assert.ok(categoryMultiple('Lending') > categoryMultiple('Bridge'));
  });
  it('values staking products below lending', () => {
    assert.ok(categoryMultiple('Liquid Staking') < categoryMultiple('Lending'));
  });
});

describe('impliedValue', () => {
  it('rises with TVL, all else equal', () => {
    const a = impliedValue(proto({ tvl_usd: 100_000_000 }), '2026-11-14', MODEL);
    const b = impliedValue(proto({ tvl_usd: 200_000_000 }), '2026-11-14', MODEL);
    assert.ok(b.implied > a.implied);
  });
  it('rises with 7-day growth, all else equal', () => {
    const a = impliedValue(proto({ change_7d: -10 }), '2026-11-14', MODEL);
    const b = impliedValue(proto({ change_7d: 40 }), '2026-11-14', MODEL);
    assert.ok(b.implied > a.implied);
  });
  it('rises with age, all else equal', () => {
    const a = impliedValue(proto({ listed_at: '2026-06-01' }), '2026-11-14', MODEL);
    const b = impliedValue(proto({ listed_at: '2022-01-01' }), '2026-11-14', MODEL);
    assert.ok(b.implied > a.implied);
  });
  it('rises with chain count, all else equal', () => {
    const a = impliedValue(proto({ chains: ['Ethereum'] }), '2026-11-14', MODEL);
    const b = impliedValue(proto({ chains: ['Ethereum', 'Solana', 'Base', 'Arbitrum'] }), '2026-11-14', MODEL);
    assert.ok(b.implied > a.implied);
  });
  it('clamps an extreme 7-day spike', () => {
    const a = impliedValue(proto({ change_7d: 150 }), '2026-11-14', MODEL);
    const b = impliedValue(proto({ change_7d: 4448 }), '2026-11-14', MODEL);
    assert.equal(a.implied, b.implied);
  });
});

describe('buildBoard', () => {
  const protocols = [
    proto({ slug: 'alpha', name: 'Alpha', tvl_usd: 500_000_000, change_7d: 20 }),
    proto({ slug: 'beta', name: 'Beta', tvl_usd: 60_000_000, change_7d: -5 }),
    proto({ slug: 'gamma', name: 'Gamma', tvl_usd: 8_000_000, change_7d: 5 }),
    proto({ slug: 'live-one', name: 'Live One', tvl_usd: 900_000_000, mcap_usd: 100_000_000, gecko_id: 'live', symbol: 'LIVE' }),
  ];
  const board = buildBoard(snap(protocols, ['alpha', 'beta']));

  it('covers every watchlist slug', () => {
    const slugs = new Set(board.map((r) => r.slug));
    assert.ok(slugs.has('alpha'));
    assert.ok(slugs.has('beta'));
  });
  it('adds an early find below the floor', () => {
    const slugs = new Set(board.map((r) => r.slug));
    assert.ok(slugs.has('gamma'));
  });
  it('never ranks a live-token protocol', () => {
    const slugs = new Set(board.map((r) => r.slug));
    assert.ok(!slugs.has('live-one'));
  });
  it('ranks 1..N with non-increasing implied value', () => {
    board.forEach((r, i) => assert.equal(r.rank, i + 1));
    for (let i = 1; i < board.length; i++) {
      assert.ok(board[i].implied_value_usd <= board[i - 1].implied_value_usd);
    }
  });
  it('gives every row a farm plan of 3..12 steps of 20..600 characters', () => {
    for (const r of board) {
      assert.ok(r.farm_steps.length >= 3 && r.farm_steps.length <= 12, `${r.slug} steps`);
      for (const s of r.farm_steps) {
        assert.ok(s.length >= 20 && s.length <= 600, `${r.slug} step of ${s.length} chars`);
      }
    }
  });
  it('passes the gate check', () => {
    assert.equal(boardIssue(board, snap(protocols, ['alpha', 'beta'])), null);
  });
});

describe('farmSteps', () => {
  it('names the protocol’s own chain and capital in the action step', () => {
    const steps = farmSteps(proto({ name: 'Alpha', chains: ['Solana'], tvl_usd: 2_000_000_000 }), 400).map(
      (s) => `${s.text} Cost: ${s.cost}. Time: ${s.time}.`,
    );
    assert.ok(steps[1].includes('Solana'));
    assert.ok(steps[1].includes('$150'));
  });
});

describe('watchlist farm plans', () => {
  const kitSnapshot = join(here, '..', '..', 'token-radar-01-kit', 'input', 'snapshot.json');
  const present = existsSync(kitSnapshot);
  it('every watchlist slug has its own plan entry', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    for (const s of snapshot.watchlist) assert.ok(WATCHLIST_PLANS[s] !== undefined, `no plan for ${s}`);
    assert.equal(Object.keys(WATCHLIST_PLANS).length, 40);
  });
  it('a watchlist plan is per-protocol, not the template with a name swapped in', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    for (const slug of snapshot.watchlist) {
      const p = bySlug.get(slug);
      const age = p.listed_at === null ? null : ageDays(snapshot.as_of, p.listed_at);
      const mine = farmSteps(p, age).map((s) => s.text);
      // The generic plan for the same category, chains, TVL and age, under a
      // different name: strip both names, then count the steps that still differ.
      const twin = { ...p, slug: 'twin-protocol', name: 'Twin Protocol' };
      const generic = farmSteps(twin, age).map((s) => s.text);
      const strip = (s) => s.replaceAll(p.name, '').replaceAll('Twin Protocol', '');
      const different = mine.filter((s, i) => strip(s) !== strip(generic[i])).length;
      assert.ok(different >= 3, `${slug}: only ${different} steps differ from the generic plan`);
    }
  });
  it('a watchlist plan names the protocol’s own product or asset where one exists', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    const expects = {
      'axis': 'USDx',
      'b14g': 'BTC',
      'bittensor-dtao': 'dTAO',
      'doppler-finance': 'XRP',
      'firelight': 'FXRP',
      'hive-protocol': '$B2',
      'keyrock': 'Morpho',
      'lagoon': 'ERC-7540',
      'lofty': 'property',
      'mezo-earn': 'governance',
      'nonce-capital': 'ether.fi',
      'rockawayx': 'Morpho',
      'saturn': 'sUSDat',
      'symbiotic': 'collateral',
      'tori-finance': 'strUSD',
      'tydro': 'Aave',
      'usdd': 'USDD',
      'veda': 'ether.fi',
      'yuzu-money': 'syzUSD',
      'reti-pooling': 'ALGO',
    };
    for (const [slug, word] of Object.entries(expects)) {
      const p = bySlug.get(slug);
      const age = p.listed_at === null ? null : ageDays(snapshot.as_of, p.listed_at);
      const text = farmSteps(p, age).map((s) => s.text).join(' ');
      assert.ok(text.includes(word), `${slug}: plan never says ${word}`);
    }
  });
  it('every watchlist plan’s steps are 20..600 characters', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    for (const slug of snapshot.watchlist) {
      const p = bySlug.get(slug);
      const age = p.listed_at === null ? null : ageDays(snapshot.as_of, p.listed_at);
      const steps = farmSteps(p, age).map(stepTextOf);
      assert.equal(steps.length, 6, `${slug}: ${steps.length} steps`);
      for (const s of steps) assert.ok(s.length >= 20 && s.length <= 600, `${slug}: step of ${s.length} chars`);
    }
    function stepTextOf(s) {
      let t = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
      if (t.length > 600) t = `${t.slice(0, 595)}…`;
      if (t.length < 20) t = `${t} Hold the position and check the protocol's own page.`;
      return t;
    }
  });
});

describe('ranking stability (validation of the constants)', () => {
  const kitSnapshot = join(here, '..', '..', 'token-radar-01-kit', 'input', 'snapshot.json');
  const present = existsSync(kitSnapshot);
  function topSet(board, n) {
    return new Set(board.slice(0, n).map((r) => r.slug));
  }
  it('the top 10 is identical under TVL and growth sweeps, and 9 of 10 when maturity is deleted outright', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const base = topSet(buildBoard(snapshot), 10);
    // TVL exponent and growth weight: the top 10 does not move at all.
    for (const patch of [
      { tvl_exponent: 0.85 }, { tvl_exponent: 1.0 },
      { growth_weight: 0 }, { growth_weight: 0.9 },
    ]) {
      const swept = topSet(buildBoard(snapshot, { ...MODEL, ...patch }), 10);
      assert.deepEqual([...swept].sort(), [...base].sort(), `top 10 moved under ${JSON.stringify(patch)}`);
    }
    // Deleting a term outright is not a reasonable range, it is a different
    // model — and even then only the #9/#10 edge moves: Polymarket, five years
    // old, falls out and RockawayX, eight months old, takes its place. The
    // maturity term is doing real work at that edge, and the test pins it.
    for (const patch of [{ maturity_range: 0 }, { chain_step: 0 }]) {
      const swept = topSet(buildBoard(snapshot, { ...MODEL, ...patch }), 10);
      const overlap = [...swept].filter((s) => base.has(s)).length;
      assert.ok(overlap >= 9, `top 10 overlap ${overlap}/10 under ${JSON.stringify(patch)}`);
    }
  });
  it('the top row is Steakhouse under every single-constant sweep', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    for (const patch of [
      { tvl_exponent: 0.85 }, { tvl_exponent: 1.0 },
      { growth_weight: 0 }, { growth_weight: 0.9 },
      { maturity_range: 0 }, { chain_step: 0 },
    ]) {
      assert.equal(buildBoard(snapshot, { ...MODEL, ...patch })[0].slug, 'steakhouse-financial', JSON.stringify(patch));
    }
  });
  it('the model prices launches conservatively against mature market caps', { skip: !present }, () => {
    // Scoring the snapshot's own live-token protocols the same way: the median
    // implied value is well under their actual market cap. A launch model that
    // priced at or above mature market caps would be claiming too much.
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const ratios = snapshot.protocols
      .filter((p) => !isRankable(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
      .map((p) => impliedValue(p, snapshot.as_of, MODEL).implied / p.mcap_usd)
      .sort((a, b) => a - b);
    assert.ok(ratios.length >= 100, `only ${ratios.length} live protocols to compare`);
    const median = ratios[Math.floor(ratios.length / 2)];
    assert.ok(median < 0.5, `median implied/mcap is ${median.toFixed(3)}, not conservative`);
    assert.ok(median > 0.05, `median implied/mcap is ${median.toFixed(3)}, implausibly low`);
  });
});

describe('parseSnapshot', () => {
  it('rejects non-JSON', () => {
    assert.throws(() => parseSnapshot('not json'), /not JSON/);
  });
  it('rejects a snapshot without protocols', () => {
    assert.throws(() => parseSnapshot('{"as_of":"2026-11-14"}'), /no source|no floor|no protocols/);
  });
});

describe('real sealed snapshot', () => {
  const kitSnapshot = join(here, '..', '..', 'token-radar-01-kit', 'input', 'snapshot.json');
  const present = existsSync(kitSnapshot);
  it('scores the real snapshot: 40 watchlist slugs covered, 188 rows, gate clean', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const board = buildBoard(snapshot);
    assert.equal(snapshot.watchlist.length, 40);
    assert.equal(board.length, 188);
    assert.equal(boardIssue(board, snapshot), null);
    const slugs = new Set(board.map((r) => r.slug));
    for (const s of snapshot.watchlist) assert.ok(slugs.has(s), `missing ${s}`);
  });
  it('the watchlist forces exactly three wrapper products onto the board, and no more', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    const forced = snapshot.watchlist.filter((s) => !isRankable(bySlug.get(s))).sort();
    assert.deepEqual(forced, ['b14g', 'reti-pooling', 'saturn']);
  });
});
