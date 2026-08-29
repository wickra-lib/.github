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
