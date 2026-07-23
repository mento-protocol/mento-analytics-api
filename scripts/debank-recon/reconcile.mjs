// Reconcile the Mento Analytics API reserve holdings against DeBank.
//
// Produces a TRIAGED report so the "missing collateral" number is trustworthy
// without hand-analysis. Three checks:
//
//   1. CHAIN COVERAGE  - per reserve address, does DeBank see (non-own-stable)
//      value on a chain the API doesn't track at all?
//   2. WALLET-TOKEN GAPS - on each (address, chain) the API tracks, DeBank wallet
//      tokens whose contract the API doesn't count, excluding Mento own-stables
//      and priced-at-zero spam. THIS is the actionable "missing asset" list.
//   3. PROTOCOL POSITIONS (advisory) - DeBank DeFi positions, flagged as likely
//      already-counted (Uniswap V3 / Aave / vault underlyings) vs. worth a look.
//
// Why wallet-only for the headline: every DeBank protocol position in this reserve
// either duplicates an API calculator (Uniswap V3, Aave) or reports the *underlying*
// of a vault token the API already holds (Sky USDS <- sUSDS, Lido ETH <- stETH).
// Counting them would double-count. Genuine gaps show up as un-held wallet tokens.
//
// Usage:
//   DEBANK_ACCESS_KEY=$(sol pass show debank/access_key) node scripts/debank-recon/reconcile.mjs
//     [--min 250]        USD threshold for flagging (default 250)
//     [--json out.json]  also write a machine-readable report

import fs from 'node:fs';
import {
  debank,
  mentoApi,
  getApiHoldings,
  getMentoStableAddresses,
  isMentoStableSym,
  canonId,
  DEBANK_TO_API_CHAIN,
  API_CHAIN_TO_DEBANK,
  normSym,
  lc,
  usd,
  DEBANK_KEY,
} from './lib.mjs';

const args = process.argv.slice(2);
const MIN_FLAG = Number(args[args.indexOf('--min') + 1]) || 250;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!DEBANK_KEY) {
  console.error('Missing DEBANK_ACCESS_KEY. Run: DEBANK_ACCESS_KEY=$(sol pass show debank/access_key) node ...');
  process.exit(1);
}

const H = (s) => `\n${'='.repeat(80)}\n${s}\n${'='.repeat(80)}`;
const report = {
  generatedAt: new Date().toISOString(),
  minFlagUsd: MIN_FLAG,
  chainCoverage: [],
  walletGaps: [],
  apiOverstatements: [],
  protocols: [],
  totals: {},
};

// Protocols whose positions the API already accounts for (or that report a vault
// underlying held as a wrapper token) -> advisory "likely already counted".
const ALREADY_COUNTED_PROTO = /uniswap|aave|curve|lido|sky|spark|maker|ubeswap/i;

console.log('Fetching live API holdings + Mento stablecoin set ...');
const [{ byPair, byAddr }, stableAddrs] = await Promise.all([getApiHoldings(), getMentoStableAddresses()]);

const tokenValue = (t) => (t.amount || 0) * (t.price || 0);
const isSpam = (t) => t.is_suspicious || !((t.price || 0) > 0);
const isOwnStable = (t) => stableAddrs.has(lc(t.id)) || isMentoStableSym(t.optimized_symbol || t.symbol);

// ---------------------------------------------------------------------------
// CHECK 1 - chain coverage
// ---------------------------------------------------------------------------
console.log(H('CHECK 1 - CHAIN COVERAGE (value on chains the API does not track for an address)'));
let coverageGap = 0;
for (const [addr, apiChains] of byAddr) {
  const trackedDb = new Set([...apiChains].map((c) => API_CHAIN_TO_DEBANK[c]));
  let tb;
  try {
    tb = await debank(`/v1/user/total_balance?id=${addr}`);
  } catch (e) {
    console.log(`  ! ${addr} total_balance failed: ${e.message}`);
    continue;
  }
  const chains = (tb.chain_list || []).filter((c) => (c.usd_value || 0) > 1).sort((a, b) => b.usd_value - a.usd_value);
  console.log(`\n  ${addr}  [API: ${[...apiChains].join(',')}]  DeBank net worth ${usd(tb.total_usd_value)}`);
  for (const c of chains) {
    const tracked = trackedDb.has(c.id);
    console.log(
      `      ${tracked ? 'tracked    ' : '>> UNTRACKED'} ${(DEBANK_TO_API_CHAIN[c.id] || c.id).padEnd(9)} ${usd(c.usd_value)}`,
    );
    if (!tracked && c.usd_value >= MIN_FLAG) {
      // Break the untracked chain into non-own-stable value.
      let real = 0,
        own = 0;
      try {
        const toks = await debank(`/v1/user/token_list?id=${addr}&chain_id=${c.id}&is_all=true`);
        for (const t of toks) {
          const v = tokenValue(t);
          if (v < 1 || isSpam(t)) continue;
          if (isOwnStable(t)) own += v;
          else real += v;
        }
      } catch {
        /* ignore */
      }
      coverageGap += real;
      report.chainCoverage.push({
        address: addr,
        chain: c.id,
        totalUsd: c.usd_value,
        realCollateralUsd: real,
        ownStableUsd: own,
      });
      console.log(`                     -> real collateral ${usd(real)} | own-stables ${usd(own)}`);
    }
  }
}
report.totals.coverageRealCollateralUsd = coverageGap;

// ---------------------------------------------------------------------------
// CHECK 2 + 3 - per (address, chain): wallet-token gaps + protocol advisory
// ---------------------------------------------------------------------------
console.log(H('CHECK 2 - WALLET-TOKEN GAPS (real tokens DeBank sees that the API does not count)'));
let missingTotal = 0,
  overTotal = 0;
const protoAdvisory = [];
for (const [key, p] of byPair) {
  if (!p.dbChain) continue;
  let tokens = [],
    protocols = [];
  try {
    [tokens, protocols] = await Promise.all([
      debank(`/v1/user/token_list?id=${p.address}&chain_id=${p.dbChain}&is_all=true`),
      debank(`/v1/user/complex_protocol_list?id=${p.address}&chain_id=${p.dbChain}`),
    ]);
  } catch (e) {
    console.log(`  ! ${key} DeBank fetch failed: ${e.message}`);
    continue;
  }

  const gaps = [],
    over = [];
  const seen = new Set();
  for (const t of tokens) {
    const v = tokenValue(t);
    if (v < 1 || isSpam(t) || isOwnStable(t)) continue;
    // Only genuine wallet balances (is_wallet===true). Aave aTokens, LP tokens and vault
    // deposits report is_wallet false/null and are either already counted by an API
    // calculator (Uniswap V3 / Aave) or a vault wrapper (sUSDS, stETH) -> see Check 3.
    // protocol_id alone is NOT a filter: it merely names a token's issuer (tether, agorafi).
    if (t.is_wallet !== true) continue;
    const canon = canonId(t.id);
    if (seen.has(canon)) continue; // dedupe DeBank's native vs ERC-20 twin (e.g. CELO)
    seen.add(canon);
    const k = normSym(t.optimized_symbol || t.symbol);
    const matched = p.assetAddrs.has(canon) || p.syms.has(k);
    if (!matched) {
      if (v >= MIN_FLAG) gaps.push({ sym: t.optimized_symbol || t.symbol, id: canon, usd: v });
    } else {
      // matched: compare to API value; flag material over/under statement
      const apiUsd = p.bySym.get(k)?.usd || 0;
      const diff = apiUsd - v; // + => API higher (possible stale/over-count)
      if (diff >= MIN_FLAG) over.push({ sym: t.optimized_symbol || t.symbol, apiUsd, dbUsd: v, diff });
    }
  }
  for (const pr of protocols) {
    const pname = pr.name || pr.id;
    let net = 0;
    for (const it of pr.portfolio_item_list || []) net += it.stats?.net_usd_value || 0;
    if (Math.abs(net) >= MIN_FLAG)
      protoAdvisory.push({
        chain: p.chain,
        address: p.address,
        protocol: pname,
        netUsd: net,
        likelyCounted: ALREADY_COUNTED_PROTO.test(pname),
      });
  }

  if (gaps.length || over.length) {
    console.log(`\n  ${p.chain} / ${p.address}   (API total here ${usd(p.total)})`);
    for (const g of gaps.sort((a, b) => b.usd - a.usd)) {
      console.log(`     >> MISSING  ${g.sym.padEnd(12)} ${usd(g.usd).padStart(14)}   (${g.id})`);
      missingTotal += g.usd;
      report.walletGaps.push({ chain: p.chain, address: p.address, ...g });
    }
    for (const o of over.sort((a, b) => b.diff - a.diff)) {
      console.log(
        `     ~~ API HIGH ${o.sym.padEnd(12)} API ${usd(o.apiUsd)} vs DeBank ${usd(o.dbUsd)}  (API +${usd(o.diff)}, likely stale)`,
      );
      overTotal += o.diff;
      report.apiOverstatements.push({ chain: p.chain, address: p.address, ...o });
    }
  }
}
report.totals.walletGapUsd = missingTotal;
report.totals.apiOverstatementUsd = overTotal;
report.protocols = protoAdvisory;

console.log(
  H('CHECK 3 - PROTOCOL POSITIONS (advisory; "likely counted" = duplicates an API calculator or vault wrapper)'),
);
for (const a of protoAdvisory.sort((x, y) => y.netUsd - x.netUsd))
  console.log(
    `  ${a.likelyCounted ? 'likely-counted' : 'REVIEW        '}  ${a.chain}/${a.address.slice(0, 8)}  ${a.protocol.padEnd(14)} net ${usd(a.netUsd)}`,
  );

// ---------------------------------------------------------------------------
console.log(H('SUMMARY'));
const apiStats = await mentoApi('/api/v1/reserve/stats');
const realMissing = missingTotal + coverageGap;
const adjReserve = apiStats.total_reserve_value_usd - overTotal + realMissing;
console.log(`  API-reported reserve value:            ${usd(apiStats.total_reserve_value_usd)}`);
console.log(`  Outstanding stables:                   ${usd(apiStats.total_outstanding_stables_usd)}`);
console.log(`  API-reported collateralization:        ${apiStats.collateralization_ratio.toFixed(4)}`);
console.log(`  ---`);
console.log(`  Missing wallet tokens (tracked chains):${usd(missingTotal).padStart(14)}`);
console.log(`  Missing on untracked chains (real):    ${usd(coverageGap).padStart(14)}`);
console.log(`  API over-statement (stale cache):      ${('-' + usd(overTotal)).padStart(14)}`);
console.log(`  ---`);
console.log(`  Adjusted reserve value:                ${usd(adjReserve)}`);
console.log(
  `  Adjusted collateralization:            ${(adjReserve / apiStats.total_outstanding_stables_usd).toFixed(4)}`,
);
report.totals.apiReserveUsd = apiStats.total_reserve_value_usd;
report.totals.outstandingStablesUsd = apiStats.total_outstanding_stables_usd;
report.totals.apiRatio = apiStats.collateralization_ratio;
report.totals.adjustedReserveUsd = adjReserve;
report.totals.adjustedRatio = adjReserve / apiStats.total_outstanding_stables_usd;

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\n  Wrote ${jsonOut}`);
}
