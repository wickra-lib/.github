/*
 * The product repos in the org, and where their badge snapshots live.
 *
 * Single source of truth for all three generators. It exists because
 * wickra-copilot, wickra-radar and wickra-shazam once had badge directories
 * that nobody wired into fetch-badges.mjs, so their badges sat frozen for two
 * months without anything noticing. fetch-badges.mjs now checks its own config
 * against this list and fails loudly if the two drift apart.
 *
 * REPO_NAMES / REPOS are the product repos: the status badges (CI, versions,
 * scorecard, ...) exist for those alone. The static badges further down cover
 * every repository that carries one -- the -site marketing sites, the -live
 * demos, wickra-docs, webpage and the org profile included. Left out on
 * purpose: the -go module mirrors (their README is copied from the parent's
 * bindings/go/ and points at the parent's badges) and the r-universe registry.
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
  { repo: 'wickra-benchmark', crate: 'wickra-benchmark-cli', nuget: 'Wickra.Benchmark', docs: 'benchmark.wickra.org' },
  { repo: 'wickra-compile', nuget: 'Wickra.Compile', docs: 'compile.wickra.org' },
  { repo: 'wickra-copilot', nuget: 'Wickra.Copilot', docs: 'copilot.wickra.org' },
  { repo: 'wickra-darwin', nuget: 'Wickra.Darwin', docs: 'darwin.wickra.org' },
  // Ships a C binding only; the one published crate is the core, not a CLI.
  { repo: 'wickra-embed', crate: 'wickra-embed-core', docs: 'embed.wickra.org', set: RUST_ONLY },
  { repo: 'wickra-exchange', nuget: 'WickraExchange', docs: 'exchange.wickra.org', verified: 9 },
  { repo: 'wickra-feature-store', nuget: 'Wickra.FeatureStore', docs: 'feature-store.wickra.org' },
  { repo: 'wickra-genome', nuget: 'Wickra.Genome', docs: 'genome.wickra.org' },
  { repo: 'wickra-gym', nuget: 'Wickra.Gym', docs: 'gym.wickra.org' },
  { repo: 'wickra-impact', nuget: 'Wickra.Impact', docs: 'impact.wickra.org' },
  // Firmware: its release workflow attaches artefacts and publishes no package.
  { repo: 'wickra-pico', docs: 'pico.wickra.org', set: NO_REGISTRY },
  // A deployed site, not a released package.
  { repo: 'wickra-playground', docs: 'playground.wickra.org', set: SITE_ONLY },
  { repo: 'wickra-proof', crate: 'wickra-proof-cli', nuget: 'Wickra.Proof', docs: 'proof.wickra.org' },
  { repo: 'wickra-radar', nuget: 'Wickra.Radar', docs: 'radar.wickra.org' },
  { repo: 'wickra-screener', nuget: 'Wickra.Screener', docs: 'screener.wickra.org' },
  { repo: 'wickra-shazam', nuget: 'Wickra.Shazam', docs: 'shazam.wickra.org' },
  { repo: 'wickra-strategy-ci', crate: 'wickra-strategy-ci-cli', nuget: 'Wickra.StrategyCi', docs: 'strategy-ci.wickra.org' },
  { repo: 'wickra-synth', nuget: 'Wickra.Synth', docs: 'synth.wickra.org' },
  { repo: 'wickra-terminal', nuget: 'WickraTerminal', docs: 'terminal.wickra.org' },
  { repo: 'wickra-timemachine', nuget: 'Wickra.TimeMachine', docs: 'timemachine.wickra.org' },
  { repo: 'wickra-verify', crate: 'wickra-verify-cli', nuget: 'Wickra.Verify', docs: 'verify.wickra.org' },
  { repo: 'wickra-xray', nuget: 'Wickra.Xray', docs: 'xray.wickra.org' },
  // The CLI crate carries the repo name. Every binding publishes; the wasm
  // module is built but not released, since the prover needs a host.
  { repo: 'wickra-zk', nuget: 'Wickra.Zk', docs: 'zk.wickra.org' },
]

// ---------------------------------------------------------------------------
// Static badges, rendered here (scripts/static-badge.mjs) instead of hot-linked
// from shields.io, which every README used to do for exactly these -- the
// only badges on any page that break when shields is down, and the only ones
// whose content this repository knows entirely on its own.
//
// STATIC names each badge once; `statics` on a product row and STATIC_ROWS for
// every other repository say which badges a repository's README carries. The
// files land in profile/badges/<repo>/<slug>.svg next to the status badges.
// `live-demo` takes the host as its message, so it is written per repository.
// `indicators` takes the count that indicator-count.yml keeps in
// profile/README.md, so the badge moves with the banner.
// ---------------------------------------------------------------------------
export const STATIC = {
  'built-on': { label: 'built on', message: 'wickra', color: '3b82f6' },
  status: { label: 'status', message: 'pre-release', color: 'orange' },
  vitepress: { label: 'built with', message: 'VitePress', color: '5c73e7', logo: 'vite' },
  'vue-vite': { label: 'built with', message: 'Vue 3 + Vite', color: '42b883', logo: 'vuedotjs' },
  'zero-backend': { label: 'backend', message: 'zero', color: '22c55e' },
  'powered-by': { label: 'powered by', message: 'wickra-wasm', color: '8b5cf6' },
  'byte-identical': { label: 'byte-identical', message: '4 languages', color: '8b5cf6' },
  reproduced: { label: 'reproduced across', message: '10 languages', color: '3b82f6' },
  manifest: { label: 'manifest', message: 'deterministic', color: '3b82f6' },
  'no-std': { label: 'no_std', message: 'yes', color: 'success' },
  'byte-parity': { label: 'byte-parity', message: 'wickra-core', color: 'success' },
  targets: { label: 'targets', message: 'thumbv7em | thumbv6m', color: 'informational' },
  'cross-target': { label: 'cross-target', message: 'deterministic', color: '3b82f6' },
  proof: { label: 'proof', message: 'zero-knowledge', color: '8b5cf6' },
}
export const liveDemo = (host) => ({ slug: 'live-demo', label: 'live demo', message: host, color: '3b82f6' })
export const indicators = (count) => ({ slug: 'indicators', label: 'indicators', message: String(count), color: '3b82f6' })

const LIVE = liveDemo('live.wickra.org')

// The product rows: what each README shows beside its status badges.
export const PRODUCT_STATICS = {
  wickra: [LIVE],
  'wickra-backtest': ['built-on', 'status', liveDemo('backtest-live.wickra.org')],
  'wickra-benchmark': ['built-on', 'status', 'reproduced'],
  'wickra-compile': ['built-on', 'status', 'manifest'],
  'wickra-copilot': ['built-on', 'status', LIVE],
  'wickra-darwin': ['built-on', 'status'],
  'wickra-embed': ['built-on', 'status', 'no-std', 'byte-parity', 'targets'],
  'wickra-exchange': ['built-on', 'status', LIVE],
  'wickra-feature-store': ['built-on', 'status'],
  'wickra-genome': ['built-on', 'status'],
  'wickra-gym': ['built-on', 'status'],
  'wickra-impact': ['built-on', 'status'],
  'wickra-pico': ['built-on', 'status', 'cross-target'],
  'wickra-playground': ['built-on', 'vue-vite', 'zero-backend', 'byte-identical'],
  'wickra-proof': ['built-on', 'status'],
  'wickra-radar': ['built-on', 'status', LIVE],
  'wickra-screener': ['built-on', LIVE],
  'wickra-shazam': ['built-on', 'status', LIVE],
  'wickra-strategy-ci': ['built-on', 'status'],
  'wickra-synth': ['built-on', 'status'],
  'wickra-terminal': ['built-on', LIVE],
  'wickra-timemachine': ['built-on', 'status'],
  'wickra-verify': ['built-on', 'status'],
  'wickra-xray': ['built-on', LIVE],
  'wickra-zk': ['built-on', 'status', 'proof'],
}

// Every other repository with a badge row of its own. A -site README points
// its docs and license badges at the product's directory (they are the
// product's), and carries these beside them.
const SITES = REPO_NAMES.filter((name) => name !== 'wickra').map((name) => `${name}-site`)
export const STATIC_ROWS = {
  ...Object.fromEntries(SITES.map((site) => [site, ['built-on', 'vitepress']])),
  'wickra-backtest-site': ['built-on', liveDemo('backtest-live.wickra.org'), 'vitepress'],
  'wickra-playground-site': ['built-on', liveDemo('playground.wickra.org'), 'vitepress'],
  'wickra-docs': ['indicators', LIVE, 'vitepress'],
  webpage: ['indicators', LIVE, 'vitepress'],
  'wickra-live': ['indicators', 'powered-by', 'vue-vite', 'zero-backend'],
  'wickra-backtest-live': ['built-on'],
  // The org profile README, served from profile/badges/wickra-lib/ like its
  // star badges.
  'wickra-lib': [LIVE],
}

