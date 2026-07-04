<p align="center">
  <a href="https://wickra.org"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/wickra-banner.webp?v=514" alt="Wickra — streaming-first technical indicators" width="100%"></a>
</p>

[![CI](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/ci.svg)](https://github.com/wickra-lib/wickra/actions/workflows/ci.yml)
[![CodeQL](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/codeql.svg)](https://github.com/wickra-lib/wickra/actions/workflows/codeql.yml)
[![codecov](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/codecov.svg)](https://codecov.io/gh/wickra-lib/wickra)
[![GitHub release](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/release.svg)](https://github.com/wickra-lib/wickra/releases/latest)
[![crates.io](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/crates.svg)](https://crates.io/crates/wickra)
[![PyPI](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/pypi.svg)](https://pypi.org/project/wickra/)
[![npm](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/npm.svg)](https://www.npmjs.com/package/wickra)
[![NuGet](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/nuget.svg)](https://www.nuget.org/packages/Wickra)
[![Maven Central](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/maven.svg)](https://central.sonatype.com/artifact/org.wickra/wickra)
[![Go module](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/go.svg)](https://pkg.go.dev/github.com/wickra-lib/wickra-go)
[![R-universe](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/r-universe.svg)](https://wickra-lib.r-universe.dev)
[![License: MIT OR Apache-2.0](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/license.svg)](https://github.com/wickra-lib/wickra#license)
[![OpenSSF Scorecard](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/scorecard.svg)](https://scorecard.dev/viewer/?uri=github.com/wickra-lib/wickra)
[![OpenSSF Best Practices](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/best-practices.svg)](https://www.bestpractices.dev/projects/13094)
[![Build provenance](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/provenance.svg)](https://github.com/wickra-lib/wickra/attestations)
[![Live demo](https://img.shields.io/badge/live%20demo-live.wickra.org-3b82f6)](https://live.wickra.org)
[![Verified across 10 languages](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/verified.svg)](https://docs.wickra.org/FAQ#do-all-the-language-bindings-compute-the-same-values)

---

**Streaming-first technical indicators.** Rust core with native Python,
Node.js and WASM bindings, plus a C ABI that brings the same indicators
to C, C++, C#, Go, Java and R. Every indicator is a state machine
that updates in O(1) per new data point — same code for backtest and
live tick.

> **▶ Live demo:** all 514 indicators over real Binance market data, in your
> browser — **[live.wickra.org](https://live.wickra.org)** · zero backend.

**Part of the [Wickra ecosystem](#repositories):** the same data-driven core and ten-language binding surface also power [wickra-exchange](https://github.com/wickra-lib/wickra-exchange), [wickra-backtest](https://github.com/wickra-lib/wickra-backtest), [wickra-terminal](https://github.com/wickra-lib/wickra-terminal), [wickra-screener](https://github.com/wickra-lib/wickra-screener), [wickra-xray](https://github.com/wickra-lib/wickra-xray), [wickra-radar](https://github.com/wickra-lib/wickra-radar), [wickra-copilot](https://github.com/wickra-lib/wickra-copilot) and [wickra-shazam](https://github.com/wickra-lib/wickra-shazam).

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
| C / C++ (C ABI) | pre-built header + library from [releases](https://github.com/wickra-lib/wickra/releases) |
| C# | `dotnet add package Wickra` |
| Go (cgo) | `go get github.com/wickra-lib/wickra-go` |
| Java (FFM) | `org.wickra:wickra` on Maven Central |
| R (`.Call`) | `install.packages("wickra", repos = "https://wickra-lib.r-universe.dev")` |

No C compiler, no headers, no Rust toolchain required to install the native
packages — pre-built on every supported platform. The C ABI ships the same
way: a ready-to-link `wickra.h` + shared/static library per platform.

**Supported versions:** Rust 1.86 · Python 3.9 · Node.js 20 · WASM (any modern
engine) · C99 · C++14 · .NET 8 · Go 1.23 · Java 22 · R ≥ 2.10 — see the
[Requirements page](https://docs.wickra.org/Requirements) for the per-language
detail.

## Highlights

- **514 indicators** across twenty-four families (moving averages, momentum
  oscillators, trend & directional, price oscillators, volatility & bands,
  bands & channels, trailing stops, volume, price statistics, Ehlers / cycle
  DSP, pivots & S/R, DeMark, Ichimoku & charts, alt-chart bars, candlestick
  patterns, chart patterns, harmonic patterns, Fibonacci, microstructure,
  derivatives, market profile, market breadth, risk / performance, seasonality
  & session)
- **Zero third-party dependencies, in every language** — `pip install wickra` / `npm install wickra` / … pull nothing else (not even NumPy), and a complete native data layer (CSV reader, tick aggregator, resampler, live Binance WebSocket feed, historical REST fetcher) ships in the box — no pandas, `ws`, `jackson` or `jsonlite`
- **`batch == streaming` equivalence** — every indicator passes a
  bit-for-bit test that streaming results match batch results
- **Identical across all 10 languages — proven, not promised** — every one of
  the 514 indicators is replayed through Rust, Python, Node.js, WASM, C, C++,
  C#, Go, Java and R and checked bit-for-bit against the Rust reference (golden
  fixtures, in CI)
- **Orders of magnitude faster in streaming** — O(1) per-tick updates run
  **11–56×** faster than the only other incremental peer and thousands of times
  faster than recompute-on-every-tick libraries
  ([benchmarks](https://wickra.org/benchmarks))
- **Rust core forbids `unsafe`** — every binding inherits a memory-safe
  implementation
- **Verified against reference values** from TA-Lib and Wilder's
  original tables

## Repositories

**Library & sites**

- [**wickra**](https://github.com/wickra-lib/wickra) — main library (Rust core + Python / Node.js / WASM bindings + a C ABI for C / C++ / C# / Go / Java / R)
- [**wickra-docs**](https://github.com/wickra-lib/wickra-docs) — documentation site, live at [**docs.wickra.org**](https://docs.wickra.org): per-indicator deep-dives (formulas, parameters, warmup), quickstarts and migration guides
- [**webpage**](https://github.com/wickra-lib/webpage) — marketing site, live at [**wickra.org**](https://wickra.org): landing page, live in-browser WASM demo, benchmarks, and per-language API overviews

**Products** — each one data-driven core with a CLI and the same ten-language binding surface (Rust, Python, Node.js, WASM + a C ABI for C, C++, C#, Go, Java, R):

- [**wickra-exchange**](https://github.com/wickra-lib/wickra-exchange) — unified market-data + execution across ten crypto exchanges
- [**wickra-backtest**](https://github.com/wickra-lib/wickra-backtest) — event-driven backtester over the Wickra core
- [**wickra-terminal**](https://github.com/wickra-lib/wickra-terminal) — the trading terminal: a TUI and a browser renderer over the stack
- [**wickra-screener**](https://github.com/wickra-lib/wickra-screener) — parallel multi-symbol screening over 514 streaming indicators
- [**wickra-xray**](https://github.com/wickra-lib/wickra-xray) — market-microstructure explorer: footprint, order-book heatmap, liquidation map, funding/OI divergence
- [**wickra-radar**](https://github.com/wickra-lib/wickra-radar) — perp-universe alert radar: OI delta, funding flip, book imbalance, liquidation clusters, OI/price divergence
- [**wickra-copilot**](https://github.com/wickra-lib/wickra-copilot) — local market copilot grounded in real order-book, liquidation and funding microstructure
- [**wickra-shazam**](https://github.com/wickra-lib/wickra-shazam) — match an asset's current microstructure fingerprint against its entire history

## License

Dual-licensed under [MIT](https://github.com/wickra-lib/wickra/blob/main/LICENSE-MIT) or [Apache-2.0](https://github.com/wickra-lib/wickra/blob/main/LICENSE-APACHE) — OSI-approved, permissive open source, free for any use including commercial.
