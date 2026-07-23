// Independently measure how much Mento own-stablecoin the reserve holds across ALL
// reserve-controlled addresses/chains (wallet + Aave + LP legs + stability pools),
// then compare to what /api/v2/reserve reports as `reserve_held_supply`.
//
// Purpose: locate reserve-held stables that v2 does NOT subtract from circulating
// supply (which would inflate `debt_usd` and depress the USD-pegged ratio).
//
//   DEBANK_ACCESS_KEY=$(sol pass show debank/access_key) node scripts/debank-recon/held-stables.mjs

import { debank, mentoApi, getMentoStableAddresses, isMentoStableSym, lc, usd, DEBANK_KEY } from './lib.mjs';

if (!DEBANK_KEY) { console.error('Missing DEBANK_ACCESS_KEY'); process.exit(1); }

// Every reserve-controlled (address, debank-chain) pair we know of, including the two
// the v1/v2 configs don't fully track (0x4255 on celo, rebalancer 0xaa82 on monad).
const TARGETS = [
  ['0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9', ['celo', 'eth']],
  ['0x87647780180b8f55980c7d3ffefe08a9b29e9ae1', ['celo']],
  ['0xd0697f70E79476195B742d5aFAb14BE50f98CC1E', ['eth']],
  ['0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1', ['celo', 'eth', 'matic']],
  ['0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976', ['celo', 'eth', 'monad']],
  ['0x4255Cf38e51516766180b33122029A88Cb853806', ['monad', 'celo']],
];

const stableAddrs = await getMentoStableAddresses();
const isOwnStable = (sym, id) => stableAddrs.has(lc(id)) || isMentoStableSym(sym);
const val = (t) => (t.amount || 0) * (t.price || 0);

let grand = 0;
const rows = [];
for (const [addr, chains] of TARGETS) {
  for (const ch of chains) {
    let tokens = [], protos = [];
    try {
      [tokens, protos] = await Promise.all([
        debank(`/v1/user/token_list?id=${addr}&chain_id=${ch}&is_all=true`),
        debank(`/v1/user/complex_protocol_list?id=${addr}&chain_id=${ch}`),
      ]);
    } catch (e) { console.log(`  ! ${addr}/${ch}: ${e.message}`); continue; }

    // wallet own-stables (is_wallet true, incl. aTokens which report is_wallet null -> caught below)
    for (const t of tokens) {
      const v = val(t);
      if (v < 1) continue;
      const sym = t.optimized_symbol || t.symbol;
      if (!isOwnStable(sym, t.id)) continue;
      const src = t.is_wallet === true ? 'wallet' : t.protocol_id ? `wrap:${t.protocol_id}` : 'wallet?';
      rows.push({ addr, ch, sym, src, usd: v });
      grand += v;
    }
    // protocol own-stable legs NOT already surfaced as wallet tokens (LP supply tokens etc.)
    for (const p of protos) {
      const pid = p.id || p.name;
      for (const it of p.portfolio_item_list || []) {
        for (const st of it.detail?.supply_token_list || []) {
          const v = val(st);
          if (v < 1) continue;
          const sym = st.optimized_symbol || st.symbol;
          if (!isOwnStable(sym, st.id)) continue;
          // Skip if this token id already counted as a wallet aToken above
          if (tokens.some((w) => lc(w.id) === lc(st.id) && val(w) >= 1)) continue;
          rows.push({ addr, ch, sym, src: `lp:${pid}`, usd: v });
          grand += v;
        }
      }
    }
  }
}

rows.sort((a, b) => b.usd - a.usd);
console.log('\nReserve-held Mento stables measured independently (DeBank, all reserve addresses):\n');
console.log(`  ${'ADDRESS'.padEnd(12)} ${'CHAIN'.padEnd(6)} ${'TOKEN'.padEnd(10)} ${'SOURCE'.padEnd(18)} ${'USD'.padStart(12)}`);
for (const r of rows)
  console.log(`  ${(r.addr.slice(0, 10)).padEnd(12)} ${r.ch.padEnd(6)} ${String(r.sym).slice(0, 10).padEnd(10)} ${r.src.padEnd(18)} ${usd(r.usd).padStart(12)}`);

// group by chain
const byChain = {};
for (const r of rows) byChain[r.ch] = (byChain[r.ch] || 0) + r.usd;
console.log('\n  By chain:');
for (const [c, v] of Object.entries(byChain).sort((a, b) => b[1] - a[1])) console.log(`    ${c.padEnd(6)} ${usd(v)}`);

const v2 = await mentoApi('/api/v2/reserve');
const rhs = v2.reserve_held_supply?.total_usd || 0;
console.log(`\n  MEASURED total reserve-held stables: ${usd(grand)}`);
console.log(`  v2 reserve_held_supply.total_usd:    ${usd(rhs)}`);
console.log(`  DIFFERENCE (measured - v2):           ${usd(grand - rhs)}`);
console.log('\n  (Difference ~= reserve-held stables v2 does not subtract from circulating debt.)');
