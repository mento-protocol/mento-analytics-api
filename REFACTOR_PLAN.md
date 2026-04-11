# V2 Reserve Refactor Plan

## Context

The v2 reserve endpoint currently has collateral and positions computed independently, leading to
inconsistent totals and missing data. This refactor makes positions the single source of truth
and derives collateral from them. It also adds stability pool deposits and per-trove CDP reading.

The second stage adds multicall batching and a tiered caching strategy to keep RPC load manageable.

---

## Stage 1: Unified Positions Model

### Goal

Rewrite `GET /api/v2/reserve` so that `positions` is the raw data and `collateral` + `reserve_held`
are derived views. Add stability pool deposits and per-trove CDP reading.

### New Response Shape

```typescript
interface V2ReserveResponseDto {
  // Derived summaries
  collateral: {
    total_usd: number;
    assets: { symbol, chain, balance, usd_value, percentage }[];
  };
  reserve_held_supply: {
    total_usd: number;
    by_token: { symbol, amount, usd_value }[];
  };

  // Raw positions (single source of truth)
  positions: {
    wallet_balances: WalletBalancePosition[];
    aave_deposits: AavePosition[];
    univ3_positions: UniV3Position[];
    fpmm_positions: FpmmPosition[];       // already exists
    cdp_troves: CdpTrovePosition[];       // refactored: per-trove, reserve-only
    stability_pool_deposits: StabilityPoolPosition[];  // NEW
  };
}
```

### Position Types

```typescript
interface WalletBalancePosition {
  address: string;
  label: string;
  chain: Chain;
  token: string;
  token_address: string | null;
  balance: string;
  usd_value: number;
  is_mento_stable: boolean;  // determines collateral vs reserve-held
}

interface AavePosition {
  address: string;
  label: string;
  chain: Chain;
  token: string;
  a_token_address: string;
  balance: string;
  usd_value: number;
  is_mento_stable: boolean;
}

// FpmmPosition — already exists in fpmm-positions.service.ts, keep as-is

interface CdpTrovePosition {
  trove_id: string;
  owner: string;
  owner_label: string;
  chain: Chain;
  status: 'active' | 'zombie' | 'closedByOwner' | 'closedByLiquidation';
  collateral_token: string;
  collateral_amount: string;
  collateral_usd: number;
  debt_token: string;
  debt_amount: string;
  debt_usd: number;
  ratio: number;
  annual_interest_rate: number;
  contract_address: string;
}

interface StabilityPoolPosition {
  pool_address: string;
  pool_label: string;           // "StabilityPool (GBPm)"
  chain: Chain;
  depositor: string;
  depositor_label: string;
  // What was deposited (stablecoin → reserve-held)
  deposit_token: string;
  deposit_amount: string;
  deposit_usd: number;
  // Collateral gained from liquidations (→ reserve collateral)
  collateral_gained_token: string;
  collateral_gained: string;
  collateral_gained_usd: number;
}
```

### Derivation Logic

```
collateral_assets =
  wallet_balances.filter(!is_mento_stable)        → group by symbol
  + aave_deposits.filter(!is_mento_stable)        → group by symbol
  + fpmm_positions[].collateral_token             → group by symbol
  + stability_pool[].collateral_gained            → group by symbol
  (univ3 positions contribute to collateral too, both sides unless one is a mento stable)
  (cdp_troves[].collateral is USDm which IS a mento stable, so it's reserve-held not collateral)

reserve_held =
  wallet_balances.filter(is_mento_stable)         → group by symbol
  + aave_deposits.filter(is_mento_stable)         → group by symbol
  + fpmm_positions[].debt_token                   → group by symbol
  + stability_pool[].deposit                      → group by symbol
  + cdp_troves[].collateral (USDm locked in CDPs) → group by symbol
```

### Files to Create/Modify

**New files:**
- `src/api/v2/services/positions/wallet-balance.reader.ts` — reads ERC20 balances at reserve addresses, tags is_mento_stable
- `src/api/v2/services/positions/aave.reader.ts` — reads aToken balances, tags is_mento_stable
- `src/api/v2/services/positions/cdp-trove.reader.ts` — enumerates troves, filters by reserve NFT ownership
- `src/api/v2/services/positions/stability-pool.reader.ts` — reads deposits + collateral gained per reserve address
- `src/api/v2/services/positions/multicall-batch.service.ts` — batches readContract calls via viem multicall
- `src/api/v2/services/v2-positions.service.ts` — orchestrates all readers, derives collateral + reserve-held

**Modified files:**
- `src/api/v2/dto/v2-reserve.dto.ts` — new response shape
- `src/api/v2/services/v2-reserve.service.ts` — delegates to v2-positions.service instead of computing independently
- `src/api/v2/v2.module.ts` — register new services
- `src/api/v2/services/v2-stablecoins.service.ts` — use positions service for reserve-held data
- `src/api/v2/services/v2-overview.service.ts` — use positions service for collateral + reserve-held totals

**Reused as-is:**
- `src/api/v2/services/fpmm-positions.service.ts` — already works well, integrate into positions orchestrator
- `src/api/v2/config/cdp.config.ts` — contract addresses

### Key Contract Addresses (Celo)

| Contract | Address | Used For |
|---|---|---|
| TroveManager | 0xb38aEf2bF4e34B997330D626EBCd7629De3885C9 | Enumerate troves, read debt/coll |
| TroveNFT | 0x46273A5792013973b64a42E760E6F81d0472C6b6 | Check trove ownership |
| StabilityPool (USDm coll) | 0x2d5d7E2767c5493610caE84E0AB7F9D2CCE8C1A5 | Read deposits + USDm coll gains |
| StabilityPool (GBPm) | 0x06346c0fAB682dBde9f245D2D84677592E8aaa15 | Read deposits + coll gains |

### Stability Pool ABI (key functions)

```
getCompoundedBoldDeposit(address) → uint256  // depositor's current deposit in pool token
getDepositorCollGain(address) → uint256      // collateral gained from liquidations
getTotalBoldDeposits() → uint256             // total deposits in pool
getCollBalance() → uint256                   // total collateral in pool
```

### CDP Trove Reading

Currently we use `getEntireBranchDebt/Coll` (system-wide aggregates including external troves).
Refactor to per-trove reading, filtered by reserve ownership:

```
1. getTroveIdsCount() → N
2. For i in 0..N: getTroveFromTroveIdsArray(i) → troveId
3. For each troveId: TroveNFT.ownerOf(troveId) → owner
4. Filter: keep only troves where owner is in RESERVE_ADDRESSES
5. For kept troves: getLatestTroveData(troveId) → { entireDebt, entireColl, annualInterestRate, ... }
6. getTroveStatus(troveId) → status enum (1=active, 4=zombie, etc.)
```

Known reserve troves (as of 2026-04-10):
- Trove #0: owner=Custody MS (0x8764...), coll=173K USDm, debt=61K GBPm, ratio=2.86
- Trove #3: owner=Ops MS (0xD3D2...), coll=423K USDm, debt=193K GBPm, ratio=2.19

### Multicall Batching

Use viem's `multicall()` to batch RPC calls. Create a `MulticallBatchService`:

```typescript
class MulticallBatchService {
  // Collect calls, flush as multicall when batch is full or flush() is called
  addCall(chain, { address, abi, functionName, args }): Promise<result>
  flush(chain): Promise<void>

  // Or simpler: batch helper that takes array of call configs
  async batchRead<T>(chain: Chain, calls: ReadContractCall[]): Promise<T[]>
}
```

Each position reader uses `batchRead` instead of individual `executeRateLimited` calls.
Wallet balance reader: 1 multicall per chain instead of N individual calls.
CDP trove reader: 1 multicall for all trove data instead of 3×N calls.

### is_mento_stable Classification

Auto-detect by checking token address against Mento SDK's `getStableTokens()`:
```typescript
const stableAddresses = new Set(mentoTokens.map(t => t.address.toLowerCase()));
const isMentoStable = stableAddresses.has(tokenAddress.toLowerCase());
```

Cache the stablecoin address set — it changes very rarely (only when new stablecoins are launched).

### Reserve Address List (single source of truth)

Currently duplicated across RESERVE_ADDRESS_CONFIGS, LP_HOLDER_ADDRESSES, RESERVE_STABLECOIN_HOLDERS,
AAVE_STABLECOIN_HOLDERS, and CDP_TROVE_OWNERS. Consolidate into one list:

```typescript
// src/api/v2/config/reserve-addresses.config.ts
const RESERVE_ADDRESSES = [
  { address: '0x9380...', chain: Chain.CELO, label: 'Mento Pools Liquidity Reserve' },
  { address: '0x8764...', chain: Chain.CELO, label: 'Custody Multisig' },
  { address: '0xD3D2...', chain: Chain.CELO, label: 'Ops Multisig' },
  { address: '0xd069...', chain: Chain.ETHEREUM, label: 'ETH Custody Multisig' },
  { address: '0xD3D2...', chain: Chain.ETHEREUM, label: 'Ops Multisig' },
  { address: '0x6196...', chain: Chain.CELO, label: 'Falcon Finance' },
  { address: '0xaa82...', chain: Chain.CELO, label: 'Rebalancer Bot' },
  { address: '0xaa82...', chain: Chain.ETHEREUM, label: 'Rebalancer Bot' },
  { address: '0x4255...', chain: Chain.MONAD, label: 'ReserveV2' },
];
```

All position readers use this single list. v1 configs remain untouched for backward compatibility.

---

## Stage 2: Caching & Performance

### Goal

Add multicall batching, primitive-level caching, and tiered cache warming to keep RPC load
manageable while serving fresh data.

### Multicall Batching Service

**File:** `src/api/v2/services/multicall-batch.service.ts`

```typescript
@Injectable()
class MulticallBatchService {
  constructor(private chainClientService: ChainClientService) {}

  /**
   * Execute multiple readContract calls in a single multicall RPC request.
   * Viem's multicall() handles encoding/decoding.
   * Falls back to individual calls if multicall fails.
   */
  async batchRead(chain: Chain, calls: {
    address: string;
    abi: any;
    functionName: string;
    args?: any[];
  }[]): Promise<any[]> {
    const client = this.chainClientService.getClient(chain);
    const results = await client.multicall({ contracts: calls });
    return results.map(r => r.status === 'success' ? r.result : null);
  }
}
```

### Primitive Cache Layer

**File:** `src/api/v2/services/primitive-cache.service.ts`

Caches individual data points with short TTLs. All position readers write to this cache.
Composed endpoints read from it.

```typescript
@Injectable()
class PrimitiveCacheService {
  // Balance cache: 5 min TTL
  async getBalance(chain, token, holder): Promise<bigint | null>
  async setBalance(chain, token, holder, value): Promise<void>

  // Price cache: 15 min TTL (already exists in CMC/DeFiLlama services)

  // Pool state cache: 5 min TTL
  async getPoolReserves(chain, pool): Promise<[bigint, bigint] | null>
  async setPoolReserves(chain, pool, reserves): Promise<void>

  // Structural cache: 30 min TTL
  async getFpmmPools(chain): Promise<string[] | null>
  async setFpmmPools(chain, pools): Promise<void>

  // Stablecoin list cache: 1 hr TTL
  async getStablecoinAddresses(): Promise<Set<string> | null>
  async setStablecoinAddresses(addrs: Set<string>): Promise<void>
}
```

### Tiered Cache Warmer

**File:** `src/api/v2/services/v2-cache-warmer.service.ts`

```
Tier 1 — every ~5 min (or N Celo blocks):
  - All balance reads (wallet, aave, stability pool)
  - Trove data
  - Pool reserves
  - Prices
  → ~100 calls, batched into ~3 multicalls

Tier 2 — every ~30 min:
  - FPMM pool discovery (factory.deployedFPMMAddresses)
  - UniV3 position enumeration
  - Trove count + ownership check
  → ~20 calls

Tier 3 — on startup only:
  - Stablecoin address list from SDK
  - Reserve address config
  → 1 SDK call
```

### Stale-While-Revalidate Pattern

```typescript
async getV2Reserve(): Promise<V2ReserveResponseDto> {
  const cached = await this.cacheService.get(V2_CACHE_KEYS.RESERVE);
  if (cached) {
    // Return cached immediately, refresh in background if stale
    if (this.isStale(cached)) {
      this.refreshInBackground(); // non-blocking
    }
    return cached.data;
  }
  // Cold cache: compute synchronously (1-3s with multicall)
  return this.computeAndCache();
}
```

### Files to Create

- `src/api/v2/services/multicall-batch.service.ts`
- `src/api/v2/services/primitive-cache.service.ts`
- `src/api/v2/services/v2-cache-warmer.service.ts`

### Files to Modify

- `src/api/v2/v2.module.ts` — register new services
- `src/api/v2/services/positions/*.reader.ts` — use MulticallBatchService + PrimitiveCacheService
- `src/api/v2/controllers/*.controller.ts` — use stale-while-revalidate pattern

### RPC Call Budget After Optimization

| Operation | Before (individual calls) | After (multicall) |
|---|---|---|
| Wallet balances (all chains) | ~55 calls | 3 multicalls (1/chain) |
| AAVE positions | ~30 calls | 1 multicall |
| FPMM discovery + balances | ~75 calls | 2 multicalls |
| CDP trove enumeration | ~20 calls | 1 multicall |
| Stability pool reads | ~24 calls | 1 multicall |
| Stablecoin supply + lockbox | ~5 calls | 1 multicall |
| **Total** | **~235 calls** | **~9 multicalls** |

Response time: 5-15s → **1-3s** for cold cache.

---

## Implementation Dependencies

```
Stage 1 tasks (can be parallelized internally):
  1a. Create reserve-addresses.config.ts (single address list)
  1b. Create multicall-batch.service.ts
  1c. Create position readers (wallet, aave, cdp-trove, stability-pool)
  1d. Create v2-positions.service.ts (orchestrator + derivation)
  1e. Update DTOs
  1f. Wire into v2-reserve.service, v2-overview.service, v2-stablecoins.service
  1g. Test all endpoints return correct data

Stage 2 tasks (depends on Stage 1 interfaces):
  2a. Create primitive-cache.service.ts
  2b. Create v2-cache-warmer.service.ts with tiered refresh
  2c. Add stale-while-revalidate to controllers
  2d. Update position readers to check primitive cache before RPC
  2e. Test cache hit/miss behavior and refresh timing
```

Stage 2 can start on 2a-2b while Stage 1 is in progress (the cache service interfaces
don't depend on the exact position types). Integration (2c-2d) happens after Stage 1 lands.
