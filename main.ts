// main.ts - drawdown-reversion bot for the cbBTC/USDC 24-hour race (agent-fun/bars-replay/v1).
//
// It trades one asset long-only, a fraction of the capital at a time, and only when the price is in a
// real drawdown from its own recent high. The idea is deliberately plain:
//
//   anchor = the highest close of the last ANCHOR_BARS bars (a 6-hour high)
//   buy    when the close has fallen ENTRY_DRAW below that anchor (a dislocation, not noise)
//   sell   on a take-profit above the average cost, on a stop, when the close has climbed back to
//          within ANCHOR_RECOVER of the anchor, or after MAX_HOLD bars
//
// A full round trip pays about 26-32 bps in fee, slippage and price impact, so a trade has to catch a
// move larger than that to pay for itself: the bot therefore sits in cash by default, waits for a
// dislocation, and caps itself at MAX_ROUND_TRIPS round trips per window. The position is sized at
// SIZE_BPS of equity, never the whole book, because the drawdown edge is small next to the cost of
// the round trip and a smaller ticket loses less when the market simply keeps falling.
//
// A fallback entry near the end of the window guarantees the guardrail's "at least 1 trade" is met
// on a window that never dips enough to trigger the drawdown rule. Everything is a pure function of
// the batch stream: no clock, no randomness, no environment, so two executions match byte for byte.

import { runBars, type Batch, type BuyInput, type SellInput, type BarsState } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

/** The drawdown anchor: the highest close of this many bars (6 hours of 1-minute bars). */
const ANCHOR_BARS = 360;
/** Buy when the close is this far below the anchor (basis points). */
const ENTRY_DRAW_BPS = 150n;
/** Take profit this far above the average cost (basis points). */
const TAKE_PROFIT_BPS = 100n;
/** Stop out this far below the average cost (basis points). */
const STOP_LOSS_BPS = 200n;
/** Sell when the close has come back to within this of the anchor (basis points). */
const ANCHOR_RECOVER_BPS = 30n;
/** Give up on a position held this many bars and go back to cash. */
const MAX_HOLD_BARS = 480;
/** Wait this many bars after an exit before the next entry. */
const COOLDOWN_BARS = 30;
/** At most this many round trips in the window: the cost of each one is real. */
const MAX_ROUND_TRIPS = 2;
/** Ticket size, in basis points of equity. Half the book, never all of it. */
const SIZE_BPS = 5_000n;
/** The bar at which a bot that never triggered buys anyway, to meet the guardrail. */
const FALLBACK_BAR = 1_200;
/** Leave slippage wide open: a dislocation entry is worth taking when it is there. */
const MAX_SLIPPAGE_BPS = 10_000;

const closes: bigint[] = [];
const deque: number[] = [];
let heldBars = 0;
let prevHolding = false;
let lastExitBar = -1_000_000;
let roundTrips = 0;
let entrySent = false;

/** Append this bar's close and keep the deque a sliding maximum over ANCHOR_BARS. */
function pushClose(close: bigint, index: number): void {
  closes.push(close);
  while (deque.length > 0 && closes[deque[deque.length - 1]!]! <= close) deque.pop();
  deque.push(index);
  while (deque[0]! <= index - ANCHOR_BARS) deque.shift();
}

/** The anchor, or null until there is a full window of closes. */
function anchor(): bigint | null {
  return closes.length < ANCHOR_BARS ? null : closes[deque[0]!]!;
}

/** A quantity/price as a bigint out of the account's decimal strings. */
function heldQty(state: BarsState): bigint {
  const p = state.positions.get(SYMBOL);
  return p === undefined ? 0n : p.qty;
}

/** What the position cost, in quote units (fees included), or 0 when flat. */
function heldCost(state: BarsState): bigint {
  const p = state.positions.get(SYMBOL);
  return p === undefined ? 0n : p.cost;
}

/** The orders for one batch: at most one order, so the reply is always one line. */
function orders(state: BarsState, batch: Batch): (BuyInput | SellInput)[] {
  const index = batch.seq;
  const close = state.close(SYMBOL);
  if (close === null) return [];
  pushClose(close, index);

  const qty = heldQty(state);
  const holding = qty > 0n;

  // Notice a completed round trip the batch after its sell filled.
  if (prevHolding && !holding) {
    roundTrips += 1;
    lastExitBar = index;
    heldBars = 0;
  }
  prevHolding = holding;

  if (holding) {
    heldBars += 1;
    const cost = heldCost(state);
    const mark = state.value(SYMBOL, qty);
    const takeProfit = (cost * (BPS + TAKE_PROFIT_BPS)) / BPS;
    const stopLoss = (cost * (BPS - STOP_LOSS_BPS)) / BPS;
    const back = anchor();
    const recovered = back === null ? null : (back * (BPS - ANCHOR_RECOVER_BPS)) / BPS;
    const exit =
      mark >= takeProfit ||
      mark <= stopLoss ||
      (recovered !== null && close >= recovered) ||
      heldBars >= MAX_HOLD_BARS;
    if (exit) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  const back = anchor();
  const dislocated = back !== null && close * BPS <= back * (BPS - ENTRY_DRAW_BPS);
  const cooled = index - lastExitBar >= COOLDOWN_BARS;
  const fallback = !entrySent && index >= FALLBACK_BAR;
  if (!fallback && !(dislocated && cooled && roundTrips < MAX_ROUND_TRIPS)) return [];

  const notional = (state.equity * SIZE_BPS) / BPS;
  const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
  if (notional < minNotional) return [];
  entrySent = true;
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state, batch) {
    return orders(state, batch);
  },
});
