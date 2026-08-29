/*
 * The product repos in the org, and where their badge snapshots live.
 *
 * Single source of truth for all three generators. It exists because
 * wickra-copilot, wickra-radar and wickra-shazam once had badge directories
 * that nobody wired into fetch-badges.mjs, so their badges sat frozen for two
 * months without anything noticing. fetch-badges.mjs now checks its own config
 * against this list and fails loudly if the two drift apart.
 *
 * Excluded on purpose: the -site marketing sites, the -go module mirrors (their
 * README is copied from the parent's bindings/go/), the -live demos, wickra-docs,
 * webpage, the r-universe registry and this repo.
 */
export const REPO_NAMES = [
  'wickra',
  'wickra-backtest',
  'wickra-benchmark',
  'wickra-compile',
  'wickra-copilot',
  'wickra-darwin',
  'wickra-embed',
  'wickra-exchange',
  'wickra-feature-store',
  'wickra-genome',
  'wickra-gym',
  'wickra-impact',
  'wickra-pico',
  'wickra-playground',
  'wickra-proof',
  'wickra-radar',
  'wickra-screener',
  'wickra-shazam',
  'wickra-strategy-ci',
  'wickra-synth',
  'wickra-terminal',
  'wickra-timemachine',
  'wickra-verify',
  'wickra-xray',
  'wickra-zk',
]

export const targets = REPO_NAMES.map((name) => ({
  repo: `wickra-lib/${name}`,
  dir: `profile/badges/${name}`,
}))

// ---------------------------------------------------------------------------
// One entry per repo. Everything that follows the org naming convention is
// derived; only the parts that genuinely differ are spelled out.
//
//   crate      published crate name          default: the repo name
//   nuget      NuGet package id              no default -- the casing is not
//                                            derivable (Wickra.Backtest vs
//                                            WickraExchange vs Wickra.StrategyCi)
//   docs       docs host                     default: wickra.org
//   go         repo the go tag is read from  default: <repo>-go
//   runiv      r-universe package            default: the repo name, unhyphenated
//   verified   languages the corpus covers   default: 10
//   set        which badges apply            default: FULL
//   overrides  per-slug URL, for one-offs
//
// `set` exists because the repos are not uniform: wickra-embed ships only a C
// binding, wickra-pico publishes nothing to a package registry, and
// wickra-playground is a site with no release at all. Giving those the full row
// would point badges at packages that will never exist.
// ---------------------------------------------------------------------------
export const FULL = ['ci', 'codeql', 'codecov', 'release', 'crates', 'pypi', 'npm', 'nuget', 'maven', 'go', 'r-universe', 'license', 'scorecard', 'best-practices', 'provenance', 'docs', 'verified']
export const RUST_ONLY = ['ci', 'codeql', 'release', 'crates', 'license', 'scorecard', 'best-practices', 'provenance', 'docs']
export const NO_REGISTRY = ['ci', 'codeql', 'release', 'license', 'scorecard', 'best-practices', 'provenance', 'docs']
export const SITE_ONLY = ['ci', 'codeql', 'license', 'scorecard', 'docs']

export const BEST_PRACTICES_PENDING = 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey'

export const REPOS = [
  { repo: 'wickra', nuget: 'Wickra', docs: 'docs.wickra.org',
    overrides: { 'best-practices': 'https://www.bestpractices.dev/projects/13094/badge' } },
  { repo: 'wickra-backtest', nuget: 'Wickra.Backtest', docs: 'backtest.wickra.org' },
  { repo: 'wickra-benchmark', crate: 'wickra-benchmark-cli', nuget: 'Wickra.Benchmark' },
  { repo: 'wickra-compile', nuget: 'Wickra.Compile' },
  { repo: 'wickra-copilot', nuget: 'Wickra.Copilot', docs: 'copilot.wickra.org' },
  { repo: 'wickra-darwin', nuget: 'Wickra.Darwin' },
  // Ships a C binding only, and publishes the core crate under its own name.
  { repo: 'wickra-embed', crate: 'embed-core', set: RUST_ONLY },
  { repo: 'wickra-exchange', nuget: 'WickraExchange', verified: 9 },
  { repo: 'wickra-feature-store', nuget: 'Wickra.FeatureStore' },
  { repo: 'wickra-genome', nuget: 'Wickra.Genome' },
  { repo: 'wickra-gym', nuget: 'Wickra.Gym' },
  { repo: 'wickra-impact', nuget: 'Wickra.Impact' },
  // Firmware: its release workflow attaches artefacts and publishes no package.
  { repo: 'wickra-pico', set: NO_REGISTRY },
  // A deployed site, not a released package.
  { repo: 'wickra-playground', set: SITE_ONLY },
  { repo: 'wickra-proof', crate: 'wickra-proof-cli', nuget: 'Wickra.Proof' },
  { repo: 'wickra-radar', nuget: 'Wickra.Radar', docs: 'radar.wickra.org' },
  { repo: 'wickra-screener', nuget: 'Wickra.Screener' },
  { repo: 'wickra-shazam', nuget: 'Wickra.Shazam', docs: 'shazam.wickra.org' },
  { repo: 'wickra-strategy-ci', crate: 'wickra-strategy-ci-cli', nuget: 'Wickra.StrategyCi' },
  { repo: 'wickra-synth', nuget: 'Wickra.Synth' },
  { repo: 'wickra-terminal', nuget: 'WickraTerminal', docs: 'terminal.wickra.org' },
  { repo: 'wickra-timemachine', nuget: 'Wickra.TimeMachine' },
  { repo: 'wickra-verify', crate: 'wickra-verify-cli', nuget: 'Wickra.Verify' },
  { repo: 'wickra-xray', nuget: 'Wickra.Xray' },
  // Publishes the CLI crate under the repo name; no language bindings.
  { repo: 'wickra-zk', set: RUST_ONLY },
]
