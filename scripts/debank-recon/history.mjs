// Historical reconstruction of the Mento reserve collateralization.
//
// For a monthly grid of dates it reconstructs, purely from archival on-chain state
// (QuickNode) + DeFiLlama historical prices/blocks:
//   - CELO held by the reserve (qty, price, USD)  -> the "accumulating CELO" story
//   - USD-pegged collateral (stables + ETH/stETH/sUSDS/AUSD across Celo + Ethereum)
//   - Mento stablecoin supply = reserve-backed debt (totalSupply x price)
//   - reserve-held stables in reserve WALLETS (lower bound; excludes LP/Aave/CDP legs)
//   - collateralization WITH and WITHOUT CELO over time
//
// Env: reads CELO_RPC_URL / ETH_RPC_URL from .env (QuickNode archival).
//   node scripts/debank-recon/history.mjs [--from 2024-01] [--to 2026-07] [--json out.json]

import fs from 'node:fs';

// ---- config -------------------------------------------------------------
const ENV = Object.fromEntries(
  fs
    .readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const RPC = { celo: ENV.CELO_RPC_URL, ethereum: ENV.ETH_RPC_URL };

const CELO_RES = [
  '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
  '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
  '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
  '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976',
  '0x4255Cf38e51516766180b33122029A88Cb853806',
  '0x13a9803d547332c81ebc6060f739821264dbcf1e',
];
const ETH_RES = [
  '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
  '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E',
  '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
  '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976',
  '0x13a9803d547332c81ebc6060f739821264dbcf1e',
];
const CELO_TOKEN = '0x471EcE3750Da237f93B8E339c536989b8978a438';

// symbol -> [address, decimals] ; USD-pegged collateral
const CELO_PEGGED = {
  USDC: ['0xcebA9300f2b948710d2653dD7B07f33A8B32118C', 6],
  USDT: ['0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', 6],
  axlUSDC: ['0xEB466342C4d449BC9f53A865D5Cb90586f405215', 6],
  axlEUROC: ['0x061cc5a2C863E0C1Cb404006D559dB18A34C762d', 6],
};
const ETH_PEGGED = {
  USDC: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6],
  USDT: ['0xdAC17F958D2ee523a2206206994597C13D831ec7', 6],
  EURC: ['0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', 6],
  sUSDS: ['0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD', 18],
  AUSD: ['0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', 6],
  WBTC: ['0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8],
  stETH: ['0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 18],
};
// Mento stablecoins on Celo (reserve-backed debt), all 18 decimals
const STABLES = {
  cUSD: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  cEUR: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73',
  cREAL: '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787',
  eXOF: '0x73F93dcc49cB8A239e2032663e9475dd5ef29A08',
  cKES: '0x456a3D042C0DbD3db53D5489e98dFb038553B0d0',
  PUSO: '0x105d4A9306D2E55a71d2Eb95B81553AE1dC20d7B',
  cCOP: '0x8A567e2aE79CA692Bd748aB832081C45de4041eA',
  cGHS: '0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313',
  cGBP: '0xCCF663b1fF11028f0b19058d0f7B674004a40746',
  cZAR: '0x4c35853A3B4e647fD266f4de678dCc8fEC410BF6',
  cCAD: '0xff4Ab19391af240c311c54200a492233052B6325',
  cAUD: '0x7175504C455076F15c04A2F90a8e352281F492F9',
  cCHF: '0xb55a79F398E759E43C95b979163f30eC87Ee131D',
  cNGN: '0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71',
  cJPY: '0xc45eCF20f3CD864B32D9794d6f76814aE8892e20',
};

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const FROM = arg('--from', '2024-01'),
  TO = arg('--to', '2026-07');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

// ---- helpers ------------------------------------------------------------
const lc = (s) => s.toLowerCase();
const pad = (a) => '000000000000000000000000' + lc(a).replace('0x', '');
const balOf = (holder) => '0x70a08231' + pad(holder);
const TOTALSUPPLY = '0x18160ddd';
const toNum = (hex, dec) => (hex && hex !== '0x' ? Number(BigInt(hex)) / 10 ** dec : 0);

async function rpcOnce(url, calls) {
  const body = calls.map((c) =>
    c.getBalance
      ? { jsonrpc: '2.0', id: c.id, method: 'eth_getBalance', params: [c.getBalance, c.block] }
      : { jsonrpc: '2.0', id: c.id, method: 'eth_call', params: [{ to: c.to, data: c.data }, c.block] },
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const out = {};
  for (const r of j) out[r.id] = r.error ? null : r.result;
  return out;
}
async function rpcBatch(url, calls) {
  // calls: [{to,data} or {getBalance:addr}] ; returns array of hex results aligned.
  // Retries individual null/failed results (QuickNode occasionally drops calls in a big batch).
  const indexed = calls.map((c, i) => ({ ...c, id: i }));
  const out = new Array(calls.length);
  let pending = indexed;
  for (let attempt = 0; attempt < 4 && pending.length; attempt++) {
    let res;
    try {
      res = await rpcOnce(url, pending);
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    const stillPending = [];
    for (const c of pending) {
      const v = res[c.id];
      if (v == null || v === '0x') {
        if (attempt < 3) stillPending.push(c);
        else out[c.id] = v;
      } else out[c.id] = v;
    }
    pending = stillPending;
    if (pending.length) await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}
async function llamaBlock(chain, ts) {
  const j = await (await fetch(`https://coins.llama.fi/block/${chain}/${ts}`)).json();
  return j.height;
}
async function llamaPrices(ts, coins) {
  const j = await (await fetch(`https://coins.llama.fi/prices/historical/${ts}/${coins.join(',')}`)).json();
  return j.coins || {};
}

function monthGrid(from, to) {
  const [fy, fm] = from.split('-').map(Number),
    [ty, tm] = to.split('-').map(Number);
  const out = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m++) {
    if (m > 12) {
      m = 1;
      y++;
    }
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
  }
  return out;
}
function weekGrid(from, to) {
  // from/to are YYYY-MM (or YYYY-MM-DD); step 7 days. Uses fixed epoch math (no Date.now).
  const parse = (s) => Math.floor(Date.parse((s.length === 7 ? s + '-01' : s) + 'T00:00:00Z') / 1000);
  const out = [];
  for (let t = parse(from); t <= parse(to); t += 7 * 86400) out.push(new Date(t * 1000).toISOString().slice(0, 10));
  return out;
}
const tsOf = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

// price coin keys
const priceKey = { celoNative: `celo:${CELO_TOKEN}` };
const allCoins = [
  `celo:${CELO_TOKEN}`,
  ...Object.values(CELO_PEGGED).map(([a]) => `celo:${a}`),
  ...Object.values(ETH_PEGGED).map(([a]) => `ethereum:${a}`),
  ...Object.values(STABLES).map((a) => `celo:${a}`),
  'coingecko:ethereum',
];
const px = (coins, key) => coins[key]?.price ?? null;

// ---- main ---------------------------------------------------------------
const dates = args.includes('--weekly') ? weekGrid(FROM, TO) : monthGrid(FROM, TO);
console.log(
  `Reconstructing ${dates.length} ${args.includes('--weekly') ? 'weekly' : 'monthly'} snapshots ${FROM}..${TO}\n`,
);

// Current prices as a fallback when DeFiLlama lacks a historical point for a coin
// at a given timestamp (mainly the long-tail stablecoins). Pegged assets barely move,
// so current is a fine stand-in; CELO/ETH always use the historical point.
let CUR = {};
try {
  CUR = (await (await fetch(`https://coins.llama.fi/prices/current/${allCoins.join(',')}`)).json()).coins || {};
} catch {
  /* ignore */
}
const pxf = (hist, key, dflt = null) => px(hist, key) ?? px(CUR, key) ?? dflt;
const rows = [];
for (const d of dates) {
  const ts = tsOf(d);
  let cblk, eblk, coins;
  try {
    [cblk, eblk, coins] = await Promise.all([
      llamaBlock('celo', ts),
      llamaBlock('ethereum', ts),
      llamaPrices(ts, allCoins),
    ]);
  } catch (e) {
    console.log(`${d}  block/price fetch failed: ${e.message}`);
    continue;
  }
  const cbh = '0x' + cblk.toString(16),
    ebh = '0x' + eblk.toString(16);

  // ---- Celo batch ----
  const cCalls = [];
  for (const a of CELO_RES) cCalls.push({ to: CELO_TOKEN, data: balOf(a), block: cbh }); // CELO qty
  for (const [sym, [addr]] of Object.entries(CELO_PEGGED))
    for (const a of CELO_RES) cCalls.push({ to: addr, data: balOf(a), block: cbh }); // pegged
  for (const [sym, addr] of Object.entries(STABLES)) cCalls.push({ to: addr, data: TOTALSUPPLY, block: cbh }); // debt supply
  for (const [sym, addr] of Object.entries(STABLES))
    for (const a of CELO_RES) cCalls.push({ to: addr, data: balOf(a), block: cbh }); // reserve-held
  let cRes;
  try {
    cRes = await rpcBatch(RPC.celo, cCalls);
  } catch (e) {
    console.log(`${d} celo rpc failed: ${e.message}`);
    continue;
  }

  // ---- Eth batch ----
  const eCalls = [];
  for (const [sym, [addr]] of Object.entries(ETH_PEGGED))
    for (const a of ETH_RES) eCalls.push({ to: addr, data: balOf(a), block: ebh });
  for (const a of ETH_RES) eCalls.push({ getBalance: a, block: ebh }); // native ETH
  let eRes;
  try {
    eRes = await rpcBatch(RPC.ethereum, eCalls);
  } catch (e) {
    console.log(`${d} eth rpc failed: ${e.message}`);
    continue;
  }

  // ---- parse ----
  let i = 0;
  const celoPrice = pxf(coins, `celo:${CELO_TOKEN}`, 0);
  let celoQty = 0;
  for (const a of CELO_RES) celoQty += toNum(cRes[i++], 18);
  const celoUsd = celoQty * celoPrice;

  let peggedUsd = 0;
  for (const [sym, [addr]] of Object.entries(CELO_PEGGED)) {
    const p = pxf(coins, `celo:${addr}`, sym.includes('EUR') ? 1.08 : 1);
    for (const a of CELO_RES) peggedUsd += toNum(cRes[i++], CELO_PEGGED[sym][1]) * p;
  }

  const debtBySym = {};
  let debtUsd = 0,
    debtCovered = 0,
    debtTotalTokens = 0;
  for (const [sym, addr] of Object.entries(STABLES)) {
    const supply = toNum(cRes[i++], 18);
    const p = pxf(coins, `celo:${addr}`);
    if (p != null) {
      debtBySym[sym] = supply * p;
      debtUsd += supply * p;
      debtCovered++;
    }
    debtTotalTokens++;
  }

  let heldUsd = 0;
  for (const [sym, addr] of Object.entries(STABLES)) {
    const p = pxf(coins, `celo:${addr}`, 0);
    for (const a of CELO_RES) heldUsd += toNum(cRes[i++], 18) * p;
  }

  // eth
  let j = 0;
  for (const [sym, [addr, dec]] of Object.entries(ETH_PEGGED)) {
    const key = `ethereum:${addr}`;
    let p = pxf(coins, key, sym === 'WBTC' ? 60000 : sym.includes('ETH') ? 3000 : sym === 'EURC' ? 1.08 : 1);
    for (const a of ETH_RES) peggedUsd += toNum(eRes[j++], dec) * p;
  }
  const ethPrice = pxf(coins, 'coingecko:ethereum', 3000);
  for (const a of ETH_RES) peggedUsd += toNum(eRes[j++], 18) * ethPrice;

  const collateral = celoUsd + peggedUsd;
  const backedDebt = debtUsd - heldUsd;
  const row = {
    date: d,
    celoBlock: cblk,
    ethBlock: eblk,
    celoPrice,
    celoQty,
    celoUsd,
    peggedUsd,
    collateral,
    debtUsd,
    heldUsd,
    backedDebt,
    ratio: collateral / backedDebt,
    ratioExCelo: peggedUsd / backedDebt,
    celoShare: celoUsd / collateral,
    debtCoverage: `${debtCovered}/${debtTotalTokens}`,
  };
  rows.push(row);
  console.log(
    `${d}  CELO ${(celoQty / 1e6).toFixed(1)}M @ $${celoPrice.toFixed(3)} = $${(celoUsd / 1e6).toFixed(2)}M | pegged $${(peggedUsd / 1e6).toFixed(2)}M | debt $${(debtUsd / 1e6).toFixed(2)}M held $${(heldUsd / 1e6).toFixed(2)}M | ratio ${row.ratio.toFixed(3)} exCELO ${row.ratioExCelo.toFixed(3)}`,
  );
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
  console.log(`\nWrote ${jsonOut} (${rows.length} rows)`);
}
