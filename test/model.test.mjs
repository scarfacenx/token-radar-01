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
  it('scores the real snapshot: 40 watchlist slugs covered, 198 rows, gate clean', { skip: !present }, () => {
    const snapshot = parseSnapshot(readFileSync(kitSnapshot, 'utf8'));
    const board = buildBoard(snapshot);
    assert.equal(snapshot.watchlist.length, 40);
    assert.equal(board.length, 198);
    assert.equal(boardIssue(board, snapshot), null);
    const slugs = new Set(board.map((r) => r.slug));
    for (const s of snapshot.watchlist) assert.ok(slugs.has(s), `missing ${s}`);
  });
});
