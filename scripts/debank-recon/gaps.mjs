// Systematic gap hunt: find every reserve (address, chain) that DeBank sees value on
// but the v2 config does NOT cover, plus any wallet collateral token on a COVERED chain
// that v2 isn't counting. Generalises the confirmed Monad-rebalancer bug.
//
//   DEBANK_ACCESS_KEY=$(sol pass show debank/access_key) node scripts/debank-recon/gaps.mjs [--min 250]

import { debank, mentoApi, getMentoStableAddresses, isMentoStableSym, normSym, lc, usd, DEBANK_KEY } from './lib.mjs';

if (!DEBANK_KEY) {
  console.error('Missing DEBANK_ACCESS_KEY');
  process.exit(1);
}
const MIN = Number(process.argv[process.argv.indexOf('--min') + 1] || 250);

// v2 RESERVE_ADDRESSES coverage (src/api/v2/config/reserve-addresses.config.ts), as DeBank chain ids.
const CHAIN = { celo: 'celo', eth: 'ethereum', monad: 'monad' }; // codebase-supported chains
const V2 = {
  '0x9380fa34fd9e4fd14c06305fd7b6199089ed4eb9': { label: 'V2 Liquidity Reserve', chains: ['celo', 'eth'] },
  '0x4255cf38e51516766180b33122029a88cb853806': { label: 'V3 Liquidity Reserve', chains: ['celo', 'monad'] },
  '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1': { label: 'Reserve Safe', chains: ['celo', 'monad'] },
  '0xd0697f70e79476195b742d5afab14be50f98cc1e': { label: 'Reserve Safe', chains: ['eth'] },
  '0xd3d2e5c5af667da817b2d752d86c8f40c22137e1': { label: 'Ops Safe', chains: ['celo', 'eth'] },
  '0x13a9803d547332c81ebc6060f739821264dbcf1e': { label: 'Ops Account', chains: ['celo', 'monad'] },
  '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976': { label: 'Rebalancer Bot', chains: ['celo', 'eth'] },
};
const CODEBASE_CHAINS = new Set(['celo', 'eth', 'monad']); // chains the codebase can even read

const stableAddrs = await getMentoStableAddresses();
const val = (t) => (t.amount || 0) * (t.price || 0);
const isSpam = (t) => t.is_suspicious || !((t.price || 0) > 0);
const isOwn = (t) => stableAddrs.has(lc(t.id)) || isMentoStableSym(t.optimized_symbol || t.symbol);

// What v2 actually counts as collateral, per (address, chain) -> Set(symbol).
const v2r = await mentoApi('/api/v2/reserve');
const counted = new Map();
for (const a of v2r.collateral?.assets || [])
  for (const s of a.sources || []) {
    const k = `${lc(s.identifier)}|${a.chain}`;
    if (!counted.has(k)) counted.set(k, new Set());
    counted.get(k).add(normSym(a.symbol)); // normalise so DeBank "USD₮" matches v2 "USDT"
  }

let chainGapCollateral = 0,
  chainGapOwn = 0,
  assetGap = 0,
  unsupportedChainVal = 0;
const findings = [];

console.log(
  `\nGap hunt across 7 reserve addresses (min $${MIN}). "uncovered" = chain has value but v2 config omits it.\n`,
);
for (const [addr, meta] of Object.entries(V2)) {
  let tb;
  try {
    tb = await debank(`/v1/user/total_balance?id=${addr}`);
  } catch (e) {
    console.log(`! ${addr}: ${e.message}`);
    continue;
  }
  const chains = (tb.chain_list || [])
    .filter((c) => (c.usd_value || 0) >= MIN)
    .sort((a, b) => b.usd_value - a.usd_value);
  console.log(`${addr}  ${meta.label}  [v2: ${meta.chains.join(',')}]`);
  for (const c of chains) {
    const covered = meta.chains.includes(c.id);
    const supported = CODEBASE_CHAINS.has(c.id);
    if (covered) {
      console.log(`   covered    ${c.id.padEnd(8)} ${usd(c.usd_value)}`);
      continue;
    }
    // uncovered chain with value -> gap. Break down.
    let coll = 0,
      own = 0,
      lp = 0;
    let toks = [],
      protos = [];
    try {
      [toks, protos] = await Promise.all([
        debank(`/v1/user/token_list?id=${addr}&chain_id=${c.id}&is_all=true`),
        debank(`/v1/user/complex_protocol_list?id=${addr}&chain_id=${c.id}`),
      ]);
    } catch {
      /* some chains unsupported by protocol endpoint */
    }
    const detail = [];
    for (const t of toks) {
      const v = val(t);
      if (v < 1 || isSpam(t)) continue;
      if (isOwn(t)) {
        own += v;
      } else {
        coll += v;
      }
      if (v >= MIN) detail.push(`${t.optimized_symbol || t.symbol} ${usd(v)}${isOwn(t) ? '*' : ''}`);
    }
    for (const p of protos) for (const it of p.portfolio_item_list || []) lp += it.stats?.net_usd_value || 0;
    console.log(
      `   >> UNCOVERED ${c.id.padEnd(8)} ${usd(c.usd_value)}  ${supported ? '' : '(chain unsupported by codebase) '}collateral ${usd(coll)} | own-stable ${usd(own)} | lp-net ${usd(lp)}`,
    );
    if (detail.length) console.log(`        ${detail.join(', ')}   (*=Mento own-stable)`);
    chainGapCollateral += coll;
    chainGapOwn += own;
    if (!supported) unsupportedChainVal += c.usd_value;
    findings.push({
      addr,
      label: meta.label,
      chain: c.id,
      covered: false,
      supported,
      collateralUsd: coll,
      ownStableUsd: own,
      lpNetUsd: lp,
    });
  }
  // covered-chain asset check: wallet collateral tokens v2 isn't counting
  for (const dbch of meta.chains) {
    if (!CODEBASE_CHAINS.has(dbch)) continue;
    const apiChain = CHAIN[dbch];
    const countedSyms = counted.get(`${addr}|${apiChain}`) || new Set();
    let toks = [];
    try {
      toks = await debank(`/v1/user/token_list?id=${addr}&chain_id=${dbch}&is_all=true`);
    } catch {
      continue;
    }
    for (const t of toks) {
      const v = val(t);
      if (v < MIN || isSpam(t) || isOwn(t) || t.is_wallet !== true) continue;
      const sym = normSym(t.optimized_symbol || t.symbol);
      if (!countedSyms.has(sym)) {
        console.log(
          `   ~~ ASSET GAP ${dbch.padEnd(8)} ${sym} ${usd(v)} held but not in v2 collateral for this address`,
        );
        assetGap += v;
        findings.push({ addr, label: meta.label, chain: dbch, assetGap: sym, usd: v });
      }
    }
  }
}

console.log(`\n${'='.repeat(70)}\nSUMMARY OF GAPS (assets v2 does not currently account for)\n${'='.repeat(70)}`);
console.log(`  Uncovered-chain COLLATERAL (adds to reserve):        ${usd(chainGapCollateral)}`);
console.log(`  Uncovered-chain OWN-STABLES (reduces debt):          ${usd(chainGapOwn)}`);
console.log(`  Covered-chain assets v2 misses (adds to reserve):    ${usd(assetGap)}`);
console.log(`  (of which on chains the codebase can't read at all:  ${usd(unsupportedChainVal)})`);
console.log(`\n  Total unaccounted value surfaced: ${usd(chainGapCollateral + chainGapOwn + assetGap)}`);
