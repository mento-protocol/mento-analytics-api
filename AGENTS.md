# Mento Analytics API Instructions

For any protocol-level question that crosses beyond this API repo, first read
the private `mento-master-context` router when the checkout is available:

```text
../mento-master-context/.agents/mento-context/README.md
```

This applies before broad repo searches for contracts, deployments, addresses,
ABIs, live on-chain state, stable supply, reserve data, monitoring/data
semantics, docs, the whitepaper, business model, or legal/risk framing. Load
only the relevant master-context card(s), then return to this repo for API
implementation details.

This repo is source of truth for API code and cache behavior, not direct proof
of current on-chain state. Verify current API output against the live endpoint
when needed, and verify current chain values with RPC at an explicit block.
When answering, mention which master-context card you used or state that the
checkout was unavailable.
