# Wickra

**Streaming-first technical indicators.** Rust core with bindings for
Python, Node.js, and WebAssembly. Every indicator is a state machine
that updates in O(1) per new data point — same code for backtest and
live tick.

```python
import wickra as ta

rsi = ta.RSI(14)
for price in live_feed:
    value = rsi.update(price)   # O(1) — no recomputation over history
    if value is not None and value > 70:
        print("overbought")
```

## Install

| Language | Install |
|---|---|
| Python | `pip install wickra` |
| Rust | `cargo add wickra` |
| Node.js | `npm install wickra` |
| Browser / WASM | `npm install wickra-wasm` |

No C compiler, no headers, no Rust toolchain required on the install
side — pre-built native packages on every supported platform.

## Highlights

- **214 indicators** across sixteen families (moving averages, momentum
  oscillators, trend & directional, price oscillators, volatility & bands,
  bands & channels, trailing stops, volume, price statistics, Ehlers / cycle
  DSP, pivots & S/R, DeMark, Ichimoku, candlestick patterns, market profile,
  risk & performance)
- **`batch == streaming` equivalence** — every indicator passes a
  bit-for-bit test that streaming results match batch results
- **Rust core forbids `unsafe`** — every binding inherits a memory-safe
  implementation
- **Verified against reference values** from TA-Lib and Wilder's
  original tables

## Repositories

- [**wickra**](https://github.com/wickra-lib/wickra) — main library (Rust core + Python / Node / WASM bindings)
- [**wickra-docs**](https://github.com/wickra-lib/wickra-docs) — documentation site: per-indicator deep-dives (formulas, parameters, warmup), quickstarts and migration guides

## License

[PolyForm Noncommercial 1.0.0](https://github.com/wickra-lib/wickra/blob/main/LICENSE) — personal projects, research, hobby trading bots, education, non-profits and government use are all permitted. For commercial use, [open an issue](https://github.com/wickra-lib/wickra/issues).
