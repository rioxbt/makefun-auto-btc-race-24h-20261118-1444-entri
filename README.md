# makefun-auto-btc-race-24h-20261118-1444-entri

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/rioxbt/makefun-auto-btc-race-24h-20261118-1444-entri/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/rioxbt/makefun-auto-btc-race-24h-20261118-1444-entri/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A long-only cbBTC/USDC bot for make.fun's [“Race a BTC trading bot live for 24 hours”](https://make.fun/bounty/btc-race-24h-20261118-1444) bounty. It speaks `agent-fun/bars-replay/v1`, sits in cash by default, and buys a half-book position only when cbBTC is in a real drawdown from its own six-hour high.

## The idea

The venue charges about 26–32 bps on a full-size round trip: a 4 bps fee plus 2 bps of slippage on each fill, plus the order's own constant-product price impact against the bar's pool depth. Measured against the published dev window, that cost is larger than any timing signal the one-minute bars carry — a 24-bar return predicts the next 24 bars at about −0.3 correlation, but the implied move (~15–25 bps) never covers the fee. Nearly every timing rule therefore loses money on a falling window, and the kit's own baselines do: buy-and-hold −31.63 USDC, momentum −23.87, rsi-bollinger −39.92, adx-momentum −75.57, ema-cross −148.17 on the dev window.

So this bot optimizes the one thing it can control: the cost of being wrong.

- **Anchor.** The highest close of the last 360 bars (six hours).
- **Entry.** Buy when the close has fallen 1.5% below that anchor — a dislocation, not noise — at most twice per window, 30 bars apart, sized at 50% of equity.
- **Exit.** Sell on a 1.0% take-profit above the average cost, on a 2.0% stop, when the close climbs back to within 0.3% of the anchor, or after 480 bars.
- **Fallback.** A bot that never dips has made no trade, and the race's guardrail needs at least one: from bar 1200 it buys the same half-book ticket and holds.

Half the book rather than all of it, and at most two round trips rather than a rebalancing loop, because each round trip is a certain cost paid against an uncertain edge.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` with the repository read-only at `/bot`; batches arrive as newline-delimited JSON on stdin and one reply goes back per batch on stdout. `vendor/makefun-bars.ts` is a byte-identical copy of the kit's Node SDK shim (`bars/sdk/makefun-bars.ts`, sha256 `9677370b…aec5c8`) and owns the wire; `main.ts` is the strategy.

There is no clock, no randomness and no environment read anywhere in the bot — the sliding maximum, the position and the round-trip count are the only state — so two executions of the same bars give byte-identical action logs, which is what the determinism check requires.

## Result on the published dev window

Graded with the kit's own harness on the frozen dev window (1,440 one-minute bars), two executions matched byte for byte:

```
status    finished
net PnL   6.839315 USDC   (return 0.006839315)
trading   4 trades over 1 symbol, win rate 1.000000, max drawdown 0.002984, exposure 0.106787
fees      0.804446 USDC; at 2x fees net PnL 6.033337 USDC
guardrails met (trades ok, symbols ok, drawdown ok)
```

The dev grade clears the `dev_profitable` gate (> 0 USDC), so this entry races the 24 hours that start 15 minutes after the deadline.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
