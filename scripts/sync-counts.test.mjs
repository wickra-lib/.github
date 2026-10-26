// Run with `node --test scripts/`. Every case is a phrasing the org's
// repositories carry today; a rule change that misreads one fails here before
// a bot rewrites a page with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lockedVersion, parseCoreCount, parseRegistryCount, parseTerminalCount, syncText } from './sync-counts.mjs'

const counts = { core: 515, live: 516, registry: 496, terminal: 498 }
const sync = (repo, text) => syncText(text, { repo, counts })

test('core phrasings take the core count', () => {
  for (const [input, want] of [
    ['514 streaming-first indicators across twenty-four families', '515 streaming-first indicators across twenty-four families'],
    ['Wickra ships **514 indicators** organised', 'Wickra ships **515 indicators** organised'],
    ['That is **514** indicators', 'That is **515** indicators'],
    ['every one of the 514 Go indicators', 'every one of the 515 Go indicators'],
    ['the whole 514-indicator catalogue', 'the whole 515-indicator catalogue'],
    ['exposes all 514\nindicators as idiomatic types', 'exposes all 515\nindicators as idiomatic types'],
    ['// Every one of the 514\n// indicators is reconstructed', '// Every one of the 515\n// indicators is reconstructed'],
    ['surface is 514 exported types that ten', 'surface is 515 exported types that ten'],
    ['  514 indicators across twenty-four families', '  515 indicators across twenty-four families'],
  ]) {
    assert.equal(sync('wickra', input).text, input === want ? input : want, input)
  }
})

test('the live demo, the banner and the core row take the latest core', () => {
  assert.equal(
    sync('wickra-screener', '> all 514 indicators of the core over a real Binance feed').text,
    '> all 516 indicators of the core over a real Binance feed',
  )
  assert.equal(
    sync('wickra-screener', 'profile/wickra-banner.svg?v=514-8" alt="x"').text,
    'profile/wickra-banner.svg?v=516-8" alt="x"',
  )
  assert.equal(
    sync('wickra-strategy-ci', '| [wickra](u) | The indicator core — 514 streaming indicators, O(1) per tick. |').text,
    '| [wickra](u) | The indicator core — 516 streaming indicators, O(1) per tick. |',
  )
  assert.equal(
    sync('wickra-live', '**All 514 [Wickra](https://github.com/wickra-lib/wickra) streaming indicators, computed live over real Binance market data**').text,
    '**All 516 [Wickra](https://github.com/wickra-lib/wickra) streaming indicators, computed live over real Binance market data**',
  )
})

test('registry products take the registry count wherever they are described', () => {
  for (const repo of ['wickra', 'wickra-docs', '.github', 'wickra-exchange']) {
    assert.equal(
      sync(repo, '— parallel multi-symbol screening over 514 streaming indicators').text,
      '— parallel multi-symbol screening over 496 streaming indicators',
    )
    assert.equal(sync(repo, 'every asset a 514-dim live vector').text, 'every asset a 496-dim live vector')
    assert.equal(
      sync(repo, 'crossing JSON specs across the 514-indicator space').text,
      'crossing JSON specs across the 496-indicator space',
    )
    assert.equal(
      sync(repo, 'feature matrices over 514 O(1) streaming indicators').text,
      'feature matrices over 496 O(1) streaming indicators',
    )
  }
  assert.equal(
    sync('wickra-backtest', 'The strategy spec can reference **495 `wickra-core` indicators** by name').text,
    'The strategy spec can reference **496 `wickra-core` indicators** by name',
  )
  assert.equal(sync('wickra-backtest', 'so the 495\n  backtestable indicators stay').text, 'so the 496\n  backtestable indicators stay')
})

test('the terminal site takes the terminal count; the terminal keeps its own', () => {
  assert.equal(sync('wickra-terminal-site', 'tape and 455 streaming indicators').text, 'tape and 498 streaming indicators')
  const own = 'Every one of the **514** indicators and bar builders. 1 of the 504 indicators is not reachable.'
  const res = sync('wickra-terminal', own)
  assert.equal(res.text, own)
  assert.deepEqual([res.reviews.length, res.loose.length], [0, 0])
})

test('subset claims are reported, never renumbered', () => {
  const text = 'so 461 of the 514 indicators are bit-identical. The remaining 461\n> indicators use only IEEE-754'
  const res = sync('wickra', text)
  assert.equal(res.text, text)
  assert.equal(res.reviews.length, 2)
})

test('a registry count called the core\'s is a contradiction', () => {
  const res = sync('wickra-impact-site', 'A strategy\'s signals draw on any of the 514 indicators of the Wickra core.')
  assert.equal(res.contradictions.length, 1)
  assert.equal(sync('wickra-impact-site', 'Signals draw on the 514 indicators the backtest registry resolves.').contradictions.length, 0)
})

test('numbers that are not counts are left alone', () => {
  for (const text of [
    '"pnl": -497.60289158898104,',
    '"close":114.514,"volume":1420.0',
    'the candle stream feeds 436 of them directly',
    'width="514" height="20"',
    'v2.514 indicators', // part of a version
    'a hex #514 indicator colour',
  ]) {
    assert.equal(sync('wickra-live', text).text, text, text)
  }
})

test('a count-shaped number next to "indicator" that no rule matched is loose', () => {
  assert.equal(sync('wickra-screener', 'the indicator library — 514 of them resolvable by name').loose.length, 1)
  // Far from every count: an ordinary number in indicator prose.
  const real = { core: 514, live: 514, registry: 495 }
  assert.equal(syncText('the candle stream feeds 436 of them directly; indicators', { repo: 'wickra-live', counts: real }).loose.length, 0)
  // Neither side of a subset claim is loose, nor is an approximation.
  assert.equal(syncText('so 158 of the 514 had a native indicator batch', { repo: 'wickra', counts: real }).loose.length, 0)
  assert.equal(syncText('so 461 of the 514 indicators are bit-identical', { repo: 'wickra-docs', counts: real }).loose.length, 0)
  assert.equal(syncText('all 500+ structurally-identical indicator pages', { repo: 'wickra-docs', counts: real }).loose.length, 0)
  // In wickra the catalogue arithmetic is a review item for the wiring.
  const own = syncText('const INDICATOR_CLASS_COUNT = 504; // indicator classes', { repo: 'wickra', counts: real })
  assert.deepEqual([own.loose.length, own.reviews.length], [0, 1])
})

test('a CRLF checkout matches across line breaks and keeps its endings', () => {
  assert.equal(
    sync('wickra', 'exposes all 514\r\nindicators as idiomatic types\r\n').text,
    'exposes all 515\r\nindicators as idiomatic types\r\n',
  )
})

test('wickra pins the FAMILIES total', () => {
  assert.equal(sync('wickra', 'assert_eq!(total, 514, "FAMILIES total drifted");').text, 'assert_eq!(total, 515, "FAMILIES total drifted");')
})

test('counts are read the way their owners write them', () => {
  const lib = 'pub use indicators::{\n    Adx, AdxOutput, FAMILIES, Sma,\n    ' + Array.from({ length: 120 }, (_, i) => `I${i}`).join(', ') + ',\n};\n'
  assert.equal(parseCoreCount(lib), 122)
  assert.throws(() => parseCoreCount('pub use indicators::{\n    Sma,\n};\n'))
  assert.equal(parseRegistryCount('/// Every registered indicator with valid default parameters (495 indicators).'), 495)
  assert.equal(parseTerminalCount('a <!--indicator-count-->497<!--/indicator-count--> b <!--indicator-count-->497<!--/indicator-count-->'), 497)
  assert.throws(() => parseTerminalCount('<!--indicator-count-->497<!--/indicator-count--> <!--indicator-count-->496<!--/indicator-count-->'))
  const lock = '[[package]]\nname = "wickra-backtest-core"\nversion = "0.2.0"\n\n[[package]]\nname = "wickra-core"\nversion = "2.0.0"\n'
  assert.equal(lockedVersion(lock, ['wickra-core']), '2.0.0')
  assert.equal(lockedVersion(lock, ['wickra-backtest-core', 'wickra-backtest']), '0.2.0')
  assert.equal(lockedVersion(lock, ['nope']), null)
})
