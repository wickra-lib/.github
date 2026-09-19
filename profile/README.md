<p align="center">
  <a href="https://wickra.org"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/wickra-banner.webp?v=514-6" alt="Wickra — the streaming-first trading stack: one indicator core, twenty-three products, ten languages" width="100%"></a>
</p>

[![License: MIT OR Apache-2.0](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra/license.svg)](https://github.com/wickra-lib/wickra#license)
[![OpenSSF Best Practices](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra/best-practices.svg)](https://www.bestpractices.dev/projects/13094)
[![OpenSSF Scorecard](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra/scorecard.svg)](https://scorecard.dev/viewer/?uri=github.com/wickra-lib/wickra)
[![Build provenance](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra/provenance.svg)](https://github.com/wickra-lib/wickra/attestations)
[![Verified across 10 languages](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra/verified.svg)](https://docs.wickra.org/FAQ#do-all-the-language-bindings-compute-the-same-values)
[![Live demo](https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-lib/live-demo.svg)](https://live.wickra.org)

---

**Wickra is a family of 24 open-source trading libraries: a streaming-first
indicator core and twenty-three data-driven products built on it.** Every one of
them is a Rust core with a CLI and the same ten-language binding surface — native
Python, Node.js and WASM, plus a C ABI for C, C++, C#, Go, Java and R — released
to crates.io, PyPI, npm, NuGet, Maven Central, the Go module proxy and R-universe
from one pipeline, and checked byte-for-byte across all ten languages by a golden
corpus in every repository.

> **▶ Live demos:** all 514 indicators over real Binance market data, in your
> browser — **[live.wickra.org](https://live.wickra.org)**; a backtest whose
> equity curve builds bar by bar — **[backtest-live.wickra.org](https://backtest-live.wickra.org)**;
> one strategy spec running side by side in Python, Rust, JS and Go —
> **[playground.wickra.org](https://playground.wickra.org)**. Zero backend, all of them.

**Site:** [wickra.org](https://wickra.org) · **Docs:** [docs.wickra.org](https://docs.wickra.org), and one site per product (table below)

The core in three lines, in Python:

```python
import wickra as ta

rsi = ta.RSI(14)
for price in live_feed:
    value = rsi.update(price)   # O(1) — no recomputation over history
    if value is not None and value > 70:
        print("overbought")
```

## The family

Six layers, twenty-four repositories. The release badge is each repository's
latest published version; the docs column is its own documentation site.

### Core — the indicator engine everything else is built on

<table>
  <thead>
    <tr>
      <th width="18%" align="left">Repository</th>
      <th width="56%" align="left">What it does</th>
      <th width="12%" align="left">Release</th>
      <th width="14%" align="left">Docs</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra"><strong>wickra</strong></a></td>
      <td>main library (Rust core + Python / Node.js / WASM bindings + a C ABI for C / C++ / C# / Go / Java / R)</td>
      <td><a href="https://github.com/wickra-lib/wickra/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra/release.svg" alt="release"></a></td>
      <td><a href="https://docs.wickra.org">docs.wickra.org</a></td>
    </tr>
  </tbody>
</table>

### Data — market data in, market data replayed, market data synthesised

<table>
  <thead>
    <tr>
      <th width="18%" align="left">Repository</th>
      <th width="56%" align="left">What it does</th>
      <th width="12%" align="left">Release</th>
      <th width="14%" align="left">Docs</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-exchange"><strong>wickra-exchange</strong></a></td>
      <td>unified market-data + execution across ten crypto exchanges</td>
      <td><a href="https://github.com/wickra-lib/wickra-exchange/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-exchange/release.svg" alt="release"></a></td>
      <td><a href="https://exchange.wickra.org">exchange.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-synth"><strong>wickra-synth</strong></a></td>
      <td>deterministic synthetic market microstructure: OHLCV, order book, trades and funding from a single seed</td>
      <td><a href="https://github.com/wickra-lib/wickra-synth/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-synth/release.svg" alt="release"></a></td>
      <td><a href="https://synth.wickra.org">synth.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-timemachine"><strong>wickra-timemachine</strong></a></td>
      <td>scrub the whole market like a video — every symbol, full order book, rewound to any moment via deterministic re-fold</td>
      <td><a href="https://github.com/wickra-lib/wickra-timemachine/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-timemachine/release.svg" alt="release"></a></td>
      <td><a href="https://timemachine.wickra.org">timemachine.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-genome"><strong>wickra-genome</strong></a></td>
      <td>a vector database of the whole market: every asset a 514-dim live vector, for similarity search, clustering and anomaly detection</td>
      <td><a href="https://github.com/wickra-lib/wickra-genome/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-genome/release.svg" alt="release"></a></td>
      <td><a href="https://genome.wickra.org">genome.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-feature-store"><strong>wickra-feature-store</strong></a></td>
      <td>OHLCV and microstructure streams into ML-ready feature matrices over 514 O(1) streaming indicators</td>
      <td><a href="https://github.com/wickra-lib/wickra-feature-store/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-feature-store/release.svg" alt="release"></a></td>
      <td><a href="https://feature-store.wickra.org">feature-store.wickra.org</a></td>
    </tr>
  </tbody>
</table>

### Research — backtest, screen, search, train

<table>
  <thead>
    <tr>
      <th width="18%" align="left">Repository</th>
      <th width="56%" align="left">What it does</th>
      <th width="12%" align="left">Release</th>
      <th width="14%" align="left">Docs</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-backtest"><strong>wickra-backtest</strong></a></td>
      <td>event-driven backtester over the Wickra core</td>
      <td><a href="https://github.com/wickra-lib/wickra-backtest/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-backtest/release.svg" alt="release"></a></td>
      <td><a href="https://backtest.wickra.org">backtest.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-screener"><strong>wickra-screener</strong></a></td>
      <td>parallel multi-symbol screening over 514 streaming indicators</td>
      <td><a href="https://github.com/wickra-lib/wickra-screener/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-screener/release.svg" alt="release"></a></td>
      <td><a href="https://screener.wickra.org">screener.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-darwin"><strong>wickra-darwin</strong></a></td>
      <td>evolutionary strategy search at millions of backtests per second, mutating and crossing JSON specs across the 514-indicator space</td>
      <td><a href="https://github.com/wickra-lib/wickra-darwin/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-darwin/release.svg" alt="release"></a></td>
      <td><a href="https://darwin.wickra.org">darwin.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-gym"><strong>wickra-gym</strong></a></td>
      <td>a Gymnasium-compatible, microstructure-aware backtest environment with O(1) steps for deterministic RL rollouts</td>
      <td><a href="https://github.com/wickra-lib/wickra-gym/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-gym/release.svg" alt="release"></a></td>
      <td><a href="https://gym.wickra.org">gym.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-impact"><strong>wickra-impact</strong></a></td>
      <td>the backtester that knows you would have moved the market: agent-based fills on the real historical L2 order book</td>
      <td><a href="https://github.com/wickra-lib/wickra-impact/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-impact/release.svg" alt="release"></a></td>
      <td><a href="https://impact.wickra.org">impact.wickra.org</a></td>
    </tr>
  </tbody>
</table>

### Trust — prove, verify, benchmark and gate what a backtest claims

<table>
  <thead>
    <tr>
      <th width="18%" align="left">Repository</th>
      <th width="56%" align="left">What it does</th>
      <th width="12%" align="left">Release</th>
      <th width="14%" align="left">Docs</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-verify"><strong>wickra-verify</strong></a></td>
      <td>confirm or refute a claimed backtest report against its strategy and data, in ten languages</td>
      <td><a href="https://github.com/wickra-lib/wickra-verify/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-verify/release.svg" alt="release"></a></td>
      <td><a href="https://verify.wickra.org">verify.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-proof"><strong>wickra-proof</strong></a></td>
      <td>Proof-of-Backtest: deterministic (spec, data) → report + blake3 hash, recomputable byte-for-byte in ten languages</td>
      <td><a href="https://github.com/wickra-lib/wickra-proof/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-proof/release.svg" alt="release"></a></td>
      <td><a href="https://proof.wickra.org">proof.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-zk"><strong>wickra-zk</strong></a></td>
      <td>prove a backtest zero-knowledge — on-chain-verifiable performance without revealing the data or the strategy</td>
      <td><a href="https://github.com/wickra-lib/wickra-zk/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-zk/release.svg" alt="release"></a></td>
      <td><a href="https://zk.wickra.org">zk.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-strategy-ci"><strong>wickra-strategy-ci</strong></a></td>
      <td>Jest for trading strategies: golden-pin the report, catch regressions in CI, property-test against fuzzed data</td>
      <td><a href="https://github.com/wickra-lib/wickra-strategy-ci/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-strategy-ci/release.svg" alt="release"></a></td>
      <td><a href="https://strategy-ci.wickra.org">strategy-ci.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-benchmark"><strong>wickra-benchmark</strong></a></td>
      <td>reproducible, golden-verified benchmark suite — recompute any (strategy, dataset, report) in ten languages and confirm it byte-for-byte</td>
      <td><a href="https://github.com/wickra-lib/wickra-benchmark/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-benchmark/release.svg" alt="release"></a></td>
      <td><a href="https://benchmark.wickra.org">benchmark.wickra.org</a></td>
    </tr>
  </tbody>
</table>

### Surface — what a trader looks at and talks to

<table>
  <thead>
    <tr>
      <th width="18%" align="left">Repository</th>
      <th width="56%" align="left">What it does</th>
      <th width="12%" align="left">Release</th>
      <th width="14%" align="left">Docs</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-terminal"><strong>wickra-terminal</strong></a></td>
      <td>the trading terminal: a TUI and a browser renderer over the stack</td>
      <td><a href="https://github.com/wickra-lib/wickra-terminal/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-terminal/release.svg" alt="release"></a></td>
      <td><a href="https://terminal.wickra.org">terminal.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-xray"><strong>wickra-xray</strong></a></td>
      <td>market-microstructure explorer: footprint, order-book heatmap, liquidation map, funding/OI divergence</td>
      <td><a href="https://github.com/wickra-lib/wickra-xray/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-xray/release.svg" alt="release"></a></td>
      <td><a href="https://xray.wickra.org">xray.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-radar"><strong>wickra-radar</strong></a></td>
      <td>perp-universe alert radar: OI delta, funding flip, book imbalance, liquidation clusters, OI/price divergence</td>
      <td><a href="https://github.com/wickra-lib/wickra-radar/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-radar/release.svg" alt="release"></a></td>
      <td><a href="https://radar.wickra.org">radar.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-copilot"><strong>wickra-copilot</strong></a></td>
      <td>local market copilot grounded in real order-book, liquidation and funding microstructure</td>
      <td><a href="https://github.com/wickra-lib/wickra-copilot/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-copilot/release.svg" alt="release"></a></td>
      <td><a href="https://copilot.wickra.org">copilot.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-shazam"><strong>wickra-shazam</strong></a></td>
      <td>match an asset's current microstructure fingerprint against its entire history</td>
      <td><a href="https://github.com/wickra-lib/wickra-shazam/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-shazam/release.svg" alt="release"></a></td>
      <td><a href="https://shazam.wickra.org">shazam.wickra.org</a></td>
    </tr>
  </tbody>
</table>

### Edge — the core compiled for the browser, the binary, the chip

<table>
  <thead>
    <tr>
      <th width="18%" align="left">Repository</th>
      <th width="56%" align="left">What it does</th>
      <th width="12%" align="left">Release</th>
      <th width="14%" align="left">Docs</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-compile"><strong>wickra-compile</strong></a></td>
      <td>compile a strategy spec into a standalone deployable: a WASM module, a self-contained binary, or a <code>no_std</code> artifact</td>
      <td><a href="https://github.com/wickra-lib/wickra-compile/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-compile/release.svg" alt="release"></a></td>
      <td><a href="https://compile.wickra.org">compile.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-embed"><strong>wickra-embed</strong></a></td>
      <td>allocation-free, <code>no_std</code> streaming indicators for bare-metal and HFT, byte-for-byte identical to the core</td>
      <td><a href="https://github.com/wickra-lib/wickra-embed/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-embed/release.svg" alt="release"></a></td>
      <td><a href="https://embed.wickra.org">embed.wickra.org</a></td>
    </tr>
    <tr>
      <td><a href="https://github.com/wickra-lib/wickra-pico"><strong>wickra-pico</strong></a></td>
      <td>the O(1) indicator core running bare-metal on a $5 Raspberry Pi Pico — the LED blinks on the EMA cross</td>
      <td><a href="https://github.com/wickra-lib/wickra-pico/releases/latest"><img src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-pico/release.svg" alt="release"></a></td>
      <td><a href="https://pico.wickra.org">pico.wickra.org</a></td>
    </tr>
  </tbody>
</table>

## Install

The core, in every language:

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

Every product installs the same way with its own name: `pip install
wickra-<name>`, `npm install wickra-<name>` (and `wickra-<name>-wasm` for the
browser), `cargo install wickra-<name>` for the CLI, `dotnet add package
Wickra.<Name>`, `org.wickra:wickra-<name>` on Maven Central,
`go get github.com/wickra-lib/wickra-<name>-go`, and the R package with the
hyphen dropped (`wickracopilot`, `wickrafeaturestore`, …) from r-universe. The
exact identifiers are the badges on each repository's README.

No C compiler, no headers, no Rust toolchain required to install the native
packages — pre-built on every supported platform. The C ABIs ship the same way:
a ready-to-link header + shared/static library per platform on every release.

**Supported versions, family-wide:** Rust 1.86 · Python 3.9 · Node.js 22 · WASM
(any modern engine) · C99 · C++17 · .NET 8 · Go 1.23 · Java 22 · R ≥ 4.1 — the
[Requirements page](https://docs.wickra.org/Requirements) has the per-language
detail, and each product's README its own.

## What the family shares

- **One core, 514 indicators** across twenty-four families, every one a state
  machine that updates in O(1) per new data point — the same code for the
  backtest and the live tick, and the same numbers in every product above.
- **Data, not code.** A strategy, a scan, a fingerprint, a proof — each is a
  JSON spec the Rust core executes, so the same spec runs unchanged from any of
  the ten languages and produces the same bytes.
- **Identical across all 10 languages — proven, not promised.** Every
  repository carries a golden corpus that CI replays through Rust, Python,
  Node.js, WASM, C, C++, C#, Go, Java and R and compares byte-for-byte.
- **Zero third-party dependencies in every language**, `unsafe`-forbidden Rust
  cores, hash-locked CI, SHA-pinned actions, signed commits and build
  provenance on every release — the same supply chain in all twenty-four repos.
- **One release pipeline.** A tag publishes to every registry at once; the org
  keeps a [version snapshot](https://github.com/wickra-lib/.github/tree/main/versions)
  of what each registry actually holds.

## Sites and demos

- [**wickra-docs**](https://github.com/wickra-lib/wickra-docs) — the core's documentation, live at [**docs.wickra.org**](https://docs.wickra.org): per-indicator deep-dives, quickstarts for every language, the cookbook and the TA-Lib migration guide
- [**webpage**](https://github.com/wickra-lib/webpage) — the marketing site, live at [**wickra.org**](https://wickra.org): landing page, live in-browser WASM demo, benchmarks
- [**wickra-live**](https://github.com/wickra-lib/wickra-live) — [**live.wickra.org**](https://live.wickra.org), every indicator over a real Binance feed in the browser
- [**wickra-backtest-live**](https://github.com/wickra-lib/wickra-backtest-live) — [**backtest-live.wickra.org**](https://backtest-live.wickra.org), the backtester compiled to WebAssembly
- [**wickra-playground**](https://github.com/wickra-lib/wickra-playground) — [**playground.wickra.org**](https://playground.wickra.org), one StrategySpec side by side in Python, Rust, JS and Go
- **`wickra-<name>-site`** — one VitePress site per product, deployed at `<name>.wickra.org`; **`wickra-<name>-go`** — the published Go module of each product, mirrored from `bindings/go/` on every release

## Security

Please do not open a public issue for a security vulnerability in any repository
of the family. Report it privately through that repository's *Security* tab
(*"Report a vulnerability"*) or by email to **support@wickra.org** with a
subject line starting `[wickra security]`; every repository's `SECURITY.md`
carries the same policy.

## License

Every repository is dual-licensed under [MIT](https://github.com/wickra-lib/wickra/blob/main/LICENSE-MIT) or [Apache-2.0](https://github.com/wickra-lib/wickra/blob/main/LICENSE-APACHE) — OSI-approved, permissive open source, at your option.

---

<p align="center">
  <a href="https://github.com/orgs/wickra-lib/repositories">
    <img alt="Total stars across every Wickra repository" src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-lib/stars.svg">
  </a>
</p>

<p align="center">
  If Wickra saved you time, the cheapest way to say thanks is to ⭐ a repo.
</p>

<p align="center">
  <img alt="Star history across every Wickra repository" width="640"
       src="https://raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/wickra-lib/star-history.svg">
</p>
