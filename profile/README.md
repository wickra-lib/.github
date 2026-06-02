<p align="center">
  <a href="https://wickra.org"><img src="./wickra-banner.webp" alt="Wickra — streaming-first technical indicators" width="100%"></a>
</p>

[![CI](https://github.com/wickra-lib/wickra/actions/workflows/ci.yml/badge.svg)](https://github.com/wickra-lib/wickra/actions/workflows/ci.yml)
[![CodeQL](https://github.com/wickra-lib/wickra/actions/workflows/codeql.yml/badge.svg)](https://github.com/wickra-lib/wickra/actions/workflows/codeql.yml)
[![codecov](https://codecov.io/gh/wickra-lib/wickra/branch/main/graph/badge.svg)](https://codecov.io/gh/wickra-lib/wickra)
[![GitHub release](https://img.shields.io/github/v/release/wickra-lib/wickra?logo=github&color=green)](https://github.com/wickra-lib/wickra/releases/latest)
[![crates.io](https://img.shields.io/crates/v/wickra.svg?logo=rust&color=orange)](https://crates.io/crates/wickra)
[![PyPI](https://img.shields.io/pypi/v/wickra.svg?logo=pypi&color=blue)](https://pypi.org/project/wickra/)
[![npm](https://img.shields.io/npm/v/wickra.svg?logo=npm&color=red)](https://www.npmjs.com/package/wickra)
[![License: PolyForm-NC](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-purple)](https://github.com/wickra-lib/wickra/blob/main/LICENSE)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra/badge)](https://scorecard.dev/viewer/?uri=github.com/wickra-lib/wickra)
[![Build provenance](https://img.shields.io/badge/provenance-attested-brightgreen?logo=github)](https://github.com/wickra-lib/wickra/attestations)

**Streaming-first technical indicators.** Rust core with bindings for
Python, Node.js, and WebAssembly. Every indicator is a state machine
that updates in O(1) per new data point — same code for backtest and
live tick.

**Site:** [wickra.org](https://wickra.org) · **Docs:** [docs.wickra.org](https://docs.wickra.org)

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

- **292 indicators** across sixteen families (moving averages, momentum
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
- [**wickra-docs**](https://github.com/wickra-lib/wickra-docs) — documentation site, live at [**docs.wickra.org**](https://docs.wickra.org): per-indicator deep-dives (formulas, parameters, warmup), quickstarts and migration guides
- [**webpage**](https://github.com/wickra-lib/webpage) — marketing site, live at [**wickra.org**](https://wickra.org): landing page, live in-browser WASM demo, benchmarks, and per-language API overviews

## License

[PolyForm Noncommercial 1.0.0](https://github.com/wickra-lib/wickra/blob/main/LICENSE) — personal projects, research, hobby trading bots, education, non-profits and government use are all permitted. For commercial use, [open an issue](https://github.com/wickra-lib/wickra/issues).
