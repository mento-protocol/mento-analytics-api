# DeBank ⇄ Analytics-API reserve reconciliation

Standalone scripts (Node ≥ 22, zero deps) that cross-check the live Analytics API's
reserve holdings against [DeBank Cloud](https://docs.cloud.debank.com/en) to find
reserve collateral the API isn't counting.

## Run

```bash
# key lives in `pass` under debank/access_key
DEBANK_ACCESS_KEY=$(sol pass show debank/access_key) \
  node scripts/debank-recon/reconcile.mjs --min 250 --json out.json
```

Flags: `--min <usd>` flag threshold (default 250); `--json <path>` writes a machine
report. `MENTO_API_BASE` env overrides the API host (default is the prod Cloud Run URL
`https://mento-analytics-api-12390052758.us-central1.run.app`).

## What it checks

1. **Chain coverage** — `total_balance` per reserve address, flagging value on chains
   the API doesn't track for that address (splitting real collateral vs. Mento own-stables).
2. **Wallet-token gaps** — on each tracked `(address, chain)`, DeBank `token_list`
   holdings (`is_wallet===true`) whose contract the API doesn't count. Excludes Mento
   own-stables (incl. Aave aTokens / LP legs via symbol heuristic) and priced-at-zero spam.
   **This is the actionable "missing asset" list.**
3. **Protocol positions (advisory)** — DeBank `complex_protocol_list`, tagged
   `likely-counted` when they duplicate an API calculator (Uniswap V3, Aave) or a vault
   wrapper the API already holds (Sky `sUSDS`, Lido `stETH`).

### Triage rules baked in (so the total is trustworthy)

- **Own stablecoins excluded** — the reserve holding cUSD/EURm/etc. is a liability, not
  collateral. Matched by contract address (`/stablecoins`) **and** symbol (catches
  `aCelcUSD`, `FPMM-USDm/EURm`).
- **DeBank double-counts removed** — native + ERC-20 twins (CELO shows as both `celo`
  and `0x471e…`) are deduped by canonical address; `is_wallet=false` vault/aToken/LP
  tokens are handled only in the protocol section, never counted as wallet gaps.
- **API over-statements surfaced** — where the API's hourly cache is _higher_ than
  on-chain (stale balance on the actively-trading rebalancer bot), shown as `API HIGH`.

## Snapshot findings (2026-07-23)

API reported **0.834** collateralization ($12.32M reserve / $14.77M stables) — apparently
under-collateralized. Reconciliation shows this is a **data/config gap, not a real shortfall**:

| Missing collateral | Chain    | Address                   | ~USD      | Cause                                       |
| ------------------ | -------- | ------------------------- | --------- | ------------------------------------------- |
| **AUSD**           | ethereum | `0xD3D2…37E1` Operational | **4.40M** | AUSD not configured on any ETH address      |
| **USDT**           | ethereum | `0xd069…cC1E` Custody     | **1.22M** | USDT missing from this address's asset list |
| USDT/USDC/axlUSDC  | celo     | `0x4255…3806` ReserveV2   | 0.26M     | address only tracked on Monad, not Celo     |
| EURC               | ethereum | `0xaa82…1976` Rebalancer  | 0.05M     | EURC missing from asset list                |
| AUSD               | ethereum | `0xd069…cC1E` Custody     | 0.01M     | —                                           |
| USDT0/AUSD         | monad    | `0xaa82…1976` Rebalancer  | ~0.02M    | rebalancer not tracked on Monad             |

**Adjusted reserve ≈ $18.1M → collateralization ≈ 1.23×** (over-collateralized).

Verified independently by direct on-chain `balanceOf` for the two large items (AUSD and
USDT) — neither is a DeBank artifact.

Not a factor: **CELO is priced correctly** (~$0.071; CoinGecko, the API and DeBank all
agree). The reserve holds ~49.8M CELO ≈ $3.5M — its low price drags the ratio, but that's
real, not a bug. The earlier "CELO looks 2× low" signal was DeBank listing native + ERC-20
CELO twice.

### Suggested config fixes (`src/api/reserve/config/`)

- `addresses.config.ts`: add `AUSD` to the two ETH multisigs (`0xD3D2…`, `0xd069…`),
  `USDT` to `0xd069…`, `EURC` to the ETH rebalancer `0xaa82…`; add a Celo entry for
  `0x4255…` and a Monad entry for the rebalancer `0xaa82…` (after confirming ownership).
- `assets.config.ts`: add `AUSD` to `ASSETS_CONFIGS[Chain.ETHEREUM]`
  (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`, 6 decimals).
