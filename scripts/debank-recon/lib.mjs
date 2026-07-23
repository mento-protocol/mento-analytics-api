// Shared helpers for the DeBank <> Analytics-API reserve reconciliation scripts.
// Zero-dependency, Node >= 22 (global fetch). ESM.

export const API_BASE = process.env.MENTO_API_BASE || 'https://mento-analytics-api-12390052758.us-central1.run.app';
export const DEBANK_BASE = 'https://pro-openapi.debank.com';
export const DEBANK_KEY = process.env.DEBANK_ACCESS_KEY || '';

// Map the API's chain names to DeBank chain_id strings.
export const API_CHAIN_TO_DEBANK = {
  celo: 'celo',
  ethereum: 'eth',
  monad: 'monad',
  bitcoin: 'btc',
};
export const DEBANK_TO_API_CHAIN = Object.fromEntries(Object.entries(API_CHAIN_TO_DEBANK).map(([a, d]) => [d, a]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, headers = {}, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429) {
        await sleep(1500 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

export const debank = (path) => getJson(`${DEBANK_BASE}${path}`, { AccessKey: DEBANK_KEY });
export const mentoApi = (path) => getJson(`${API_BASE}${path}`);

// Normalise a token symbol so DeBank's cosmetic variants line up with ours.
// e.g. "USD₮" -> "USDT", "USDC.e" -> "USDCE".
export function normSym(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/₮/g, 'T')
    .replace(/[^A-Z0-9]/g, '');
}

export const lc = (s) => String(s || '').toLowerCase();
export const usd = (n) => `$${(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Normalised symbols of every Mento stablecoin (legacy c-prefixed + new m-suffixed +
// specials). Used to catch own-stable wrappers whose *contract* differs from the base
// token — Aave aTokens (aCelcUSD), LP legs (FPMM-USDm/EURm), etc.
export const MENTO_STABLE_SYMS = new Set(
  [
    'cUSD',
    'cEUR',
    'cREAL',
    'cKES',
    'cCOP',
    'cGHS',
    'cGBP',
    'cZAR',
    'cCAD',
    'cAUD',
    'cCHF',
    'cNGN',
    'cJPY',
    'PUSO',
    'eXOF',
    'USDm',
    'EURm',
    'BRLm',
    'XOFm',
    'KESm',
    'PHPm',
    'COPm',
    'GHSm',
    'GBPm',
    'ZARm',
    'CADm',
    'AUDm',
    'CHFm',
    'NGNm',
    'JPYm',
  ].map(normSym),
);

// True if a DeBank token symbol denotes (or wraps) a Mento stablecoin.
export function isMentoStableSym(symbol) {
  const k = normSym(symbol);
  for (const s of MENTO_STABLE_SYMS) if (k === s || k.endsWith(s)) return true;
  return false;
}

// Canonicalise a DeBank token id so native tokens line up with their ERC-20 twin.
// Celo lists native CELO (id "celo") *and* ERC-20 CELO (0x471e…) — same coins, do not
// double count. Returns a lowercased address, or a "native:<chain>" tag.
const NATIVE_CANON = {
  celo: '0x471ece3750da237f93b8e339c536989b8978a438', // native CELO == ERC20 CELO
  eth: 'native:eth',
  monad: 'native:monad',
};
export function canonId(id) {
  const l = lc(id);
  if (l.startsWith('0x')) return l;
  return NATIVE_CANON[l] || `native:${l}`;
}

// Fetch the set of Mento stablecoin token addresses (the reserve holding its own
// stables is a liability, not collateral, so these are excluded from the diff).
export async function getMentoStableAddresses() {
  const data = await mentoApi('/api/v1/stablecoins');
  const list = Array.isArray(data) ? data : data.stablecoins || [];
  const addrs = new Set();
  for (const s of list) {
    if (s.address) addrs.add(lc(s.address));
    for (const a of s.addresses || []) if (a?.address) addrs.add(lc(a.address));
  }
  // Mento stables minted natively on Monad (not returned by /stablecoins, which is Celo-centric).
  for (const a of [
    '0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115', // USDm
    '0x4D502d735B4C574B487Ed641ae87cEaE884731C7', // EURm
    '0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1', // GBPm
    '0x22f6A6752800eAB67b84748FeFc3cC658384aF72', // JPYm
    '0xF64e91fFEf7ef43aA314F0Bc2AC39f770797990C', // CHFm
  ])
    addrs.add(lc(a));
  return addrs;
}

// Pull live reserve holdings and reshape into:
//   byPair: Map "<chain>|<addr>" -> { chain, address, apiChain, dbChain, total, bySym: Map<normSym,{usd,balance,symbol,assetAddress}> }
//   byAddr: Map addr -> Set<apiChain>
export async function getApiHoldings() {
  const data = await mentoApi('/api/v1/reserve/holdings');
  const byPair = new Map();
  const byAddr = new Map();
  for (const a of data.assets) {
    const addr = lc(a.reserveAddress);
    const key = `${a.chain}|${addr}`;
    if (!byPair.has(key))
      byPair.set(key, {
        chain: a.chain,
        address: addr,
        dbChain: API_CHAIN_TO_DEBANK[a.chain],
        total: 0,
        bySym: new Map(),
        assetAddrs: new Set(), // canonical contract addresses the API already counts here
        syms: new Set(),
      });
    const p = byPair.get(key);
    p.total += a.usdValue;
    const k = normSym(a.symbol);
    const cur = p.bySym.get(k) || { usd: 0, balance: 0, symbol: a.symbol, assetAddress: lc(a.assetAddress) };
    cur.usd += a.usdValue;
    cur.balance += Number(a.balance);
    p.bySym.set(k, cur);
    p.syms.add(k);
    if (a.assetAddress) p.assetAddrs.add(canonId(a.assetAddress));
    // ETH has no assetAddress in config; tag its native canon so DeBank native ETH matches.
    if (normSym(a.symbol) === 'ETH') p.assetAddrs.add('native:eth');
    if (!byAddr.has(addr)) byAddr.set(addr, new Set());
    byAddr.get(addr).add(a.chain);
  }
  return { raw: data, byPair, byAddr };
}

// Aggregate an address's DeBank exposure on one chain into normSym -> { usd, sources }.
// Combines wallet tokens + protocol supply positions; excludes spam and Mento stables.
export function aggregateDebank({ tokens, protocols, stableAddrs, minUsd = 1 }) {
  const bySym = new Map();
  const excludedStable = []; // Mento stables we deliberately dropped (for transparency)
  const spamDropped = [];

  const add = (symbol, tokenAddr, amount, price, source, isSuspicious) => {
    const value = (amount || 0) * (price || 0);
    const addrLc = lc(tokenAddr);
    if (stableAddrs.has(addrLc)) {
      if (value >= minUsd) excludedStable.push({ symbol, value, source });
      return;
    }
    // Spam heuristic: no price, or flagged suspicious, or sub-threshold junk.
    if (isSuspicious || !(price > 0) || value < minUsd) {
      if (value >= 50 || isSuspicious) spamDropped.push({ symbol, tokenAddr, value, price, isSuspicious });
      return;
    }
    const k = normSym(symbol);
    const cur = bySym.get(k) || { usd: 0, amount: 0, symbol, tokenAddr: addrLc, sources: new Set() };
    cur.usd += value;
    cur.amount += amount || 0;
    cur.sources.add(source);
    bySym.set(k, cur);
  };

  for (const t of tokens || []) {
    add(t.optimized_symbol || t.symbol, t.id, t.amount, t.price, 'wallet', t.is_suspicious);
  }
  for (const p of protocols || []) {
    const pname = p.name || p.id;
    for (const item of p.portfolio_item_list || []) {
      const d = item.detail || {};
      for (const st of d.supply_token_list || []) {
        add(st.optimized_symbol || st.symbol, st.id, st.amount, st.price, `protocol:${pname}`, st.is_suspicious);
      }
      // Debt tokens reduce net value -> record as negative exposure so they surface.
      for (const bt of d.borrow_token_list || []) {
        add(bt.optimized_symbol || bt.symbol, bt.id, -(bt.amount || 0), bt.price, `debt:${pname}`, false);
      }
    }
  }
  return { bySym, excludedStable, spamDropped };
}
