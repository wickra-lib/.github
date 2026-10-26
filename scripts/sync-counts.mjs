#!/usr/bin/env node
/*
 * Sets every indicator count a repository states to the number the code behind
 * it actually has, and reports the ones it must not decide by itself.
 *
 * The org states its catalogue size in some seven hundred places: READMEs and
 * their per-language copies, ARCHITECTURE notes, CITATION abstracts, package
 * descriptions, site pages, web manifests, llms.txt files, the org profile. The
 * hourly bots used to rewrite four files with `sed "s/[0-9]+ indicators/…/"`,
 * which caught one phrasing in a handful of files and nothing else, so every
 * new indicator left the rest a release behind.
 *
 * There is also more than one number, and a phrase-only rewrite cannot tell
 * them apart:
 *
 *   core      the public indicator types wickra-core exports -- the
 *             `pub use indicators::{…}` block of crates/wickra-core/src/lib.rs
 *             minus FAMILIES and the *Output companions, the same rule
 *             wickra's check-indicator-count.yml enforces.
 *   live      the core count of the latest release. The live demo, the banner
 *             and the org-wide copy describe what is published, so a product
 *             pinned to an older core still quotes the current one there.
 *   registry  the indicators the wickra-backtest registry resolves by name
 *             (gen_registry.py writes the number into registry.rs). A product
 *             that resolves a spec through it -- screener, feature-store,
 *             genome, gym, shazam, copilot, darwin and the rest of the backtest
 *             family -- reaches these and not the whole core: bar builders,
 *             histogram profiles and a few struct outputs are out of its scope.
 *   terminal  the indicators wickra-terminal's own generated registry resolves.
 *             The terminal keeps that number itself, behind
 *             `<!--indicator-count-->` markers and a test; only its site quotes
 *             it from outside.
 *
 * So every count in context is classified before it is touched, by the rules
 * in classify(): a phrase that describes the live demo is `live`, a sentence
 * that describes a registry product is `registry` wherever it stands, and the
 * rest takes the class of the repository (REPOS). Two shapes are never edited:
 * a subset claim ("461 of the 514 are bit-identical", "the remaining 461") is a
 * measurement that has to be recounted, not renumbered, and is reported for
 * review; and a registry count in a sentence that calls it the core's ("any of
 * the 495 indicators of the Wickra core") is a contradiction a number change
 * cannot fix, and fails the check.
 *
 * Counts come from the code at a tag, never from the repository being edited:
 *
 *   --source latest   core and registry at the latest wickra / wickra-backtest
 *                     release -- what docs, webpage, the profile, the sites and
 *                     the live demo describe.
 *   --source pinned   core and registry at the versions this repository's
 *                     Cargo.lock pins -- what a product describes is the code it
 *                     builds against. Falls back to latest for a crate the lock
 *                     does not carry. wickra and wickra-backtest read their own
 *                     working tree for the number they define.
 *
 * Any count can be given explicitly (--core N, --registry N, ...), which skips
 * the lookup for it.
 *
 * Usage:
 *   node scripts/sync-counts.mjs --repo <name> [--root <dir>] [--source latest|pinned]
 *        [--core N] [--live N] [--registry N] [--terminal N] [--check] [--ref <commit>] [--json <file>]
 *   node scripts/sync-counts.mjs --repo <name> --stdin     (rewrite one text, e.g. a repo description)
 *   node scripts/sync-counts.mjs --repo <name> --print-counts   (the resolved counts as JSON)
 *
 * --ref reads the files at a commit instead of the working tree (e.g.
 * origin/main after a fetch) and implies --check; a pinned product's
 * Cargo.lock is read at the same commit.
 *
 * Without --check the counts are written and the rest is reported; the exit
 * code is 0 unless a count could not be resolved (2). --check writes nothing
 * and exits 1 when a count is off, a contradiction is found, or a count-shaped
 * number matched no rule. GH_TOKEN or GITHUB_TOKEN is used for the GitHub API
 * when set.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OWNER = 'wickra-lib'

// The class every count in a repository takes unless a phrase rule says
// otherwise. `own` means the repository keeps its counts itself (only the
// live-demo, banner and registry-product phrases are set from here). A
// repository missing from this table is refused rather than guessed: a new
// product has to be placed on purpose.
export const REPOS = {
  '.github': 'core',
  webpage: 'core',
  wickra: 'core',
  'wickra-docs': 'core',
  'wickra-live': 'core',
  'wickra.wiki': 'core',
  'wickra-embed': 'core',
  'wickra-embed-site': 'core',
  'wickra-exchange': 'core',
  'wickra-exchange-site': 'core',
  'wickra-pico': 'core',
  'wickra-pico-site': 'core',
  'wickra-radar': 'core',
  'wickra-radar-site': 'core',
  'wickra-synth': 'core',
  'wickra-synth-site': 'core',
  'wickra-xray': 'core',
  'wickra-xray-site': 'core',
  'wickra-backtest': 'registry',
  'wickra-backtest-live': 'registry',
  'wickra-backtest-site': 'registry',
  'wickra-benchmark': 'registry',
  'wickra-benchmark-site': 'registry',
  'wickra-compile': 'registry',
  'wickra-compile-site': 'registry',
  'wickra-copilot': 'registry',
  'wickra-copilot-site': 'registry',
  'wickra-darwin': 'registry',
  'wickra-darwin-site': 'registry',
  'wickra-feature-store': 'registry',
  'wickra-feature-store-site': 'registry',
  'wickra-genome': 'registry',
  'wickra-genome-site': 'registry',
  'wickra-gym': 'registry',
  'wickra-gym-site': 'registry',
  'wickra-impact': 'registry',
  'wickra-impact-site': 'registry',
  'wickra-playground': 'registry',
  'wickra-playground-site': 'registry',
  'wickra-proof': 'registry',
  'wickra-proof-site': 'registry',
  'wickra-screener': 'registry',
  'wickra-screener-site': 'registry',
  'wickra-shazam': 'registry',
  'wickra-shazam-site': 'registry',
  'wickra-strategy-ci': 'registry',
  'wickra-strategy-ci-site': 'registry',
  'wickra-timemachine': 'registry',
  'wickra-timemachine-site': 'registry',
  'wickra-verify': 'registry',
  'wickra-verify-site': 'registry',
  'wickra-zk': 'registry',
  'wickra-zk-site': 'registry',
  'wickra-terminal': 'own',
  'wickra-terminal-site': 'terminal',
}

// Files no count rule applies to, in every repository: history (a changelog
// entry states what was true then), lockfiles and data, generated sources, and
// images that are rendered from a count rather than holding one.
const SKIP = new RegExp(
  [
    String.raw`(^|/)CHANGELOG[^/]*\.md$`,
    String.raw`\.lock$`,
    String.raw`(^|/)package-lock\.json$`,
    String.raw`\.(csv|tsv|parquet|bin|png|webp|jpe?g|gif|ico|woff2?|ttf|otf|wasm|dll|so|dylib|node|pyd|gz|xz|zip|pdf|lib|a|o)$`,
    String.raw`(^|/)(testdata|golden|fixtures|node_modules|dist|target)/`,
    String.raw`(^|/)registry\.rs$`, // generated; its count is the source, not a statement
    String.raw`^profile/badges/`, // rendered by fetch-badges.mjs from profile/README.md
    String.raw`(^|/)wickra-banner\.svg$`, // rendered by gen-banner.mjs from profile/README.md
    String.raw`(^|/)scripts/og-banner\.svg$`, // a template; gen-og-banner.mjs fills the count at build
  ].join('|'),
)

// Per repository: files whose counts are history or examples rather than
// statements about the catalogue today.
const EXCLUDE = {
  '.github': ['scripts/sync-counts.mjs', 'scripts/sync-counts.test.mjs'], // the rules and their fixtures
  wickra: [
    '.github/workflows/check-indicator-count.yml', // "it said 214 indicators" -- the bug it fixed
    'scripts/gen_python_stubs.py', // "72 of the 520 exported names" -- the bug it fixed
    'bindings/r/tests/testthat/test-batch-shapes.R', // "158 of the 514 had" -- the bug it fixed
  ],
  'wickra-backtest': ['tools/gen_registry.py'], // writes the count; quotes a retired bound
  'wickra-docs': ['scripts/sync-doc-counts.mjs'], // "(e.g. "485 indicators")" -- an example
  'wickra-terminal': ['ROADMAP.md'], // quotes a retired claim to explain the fix
}

// --- Matching ----------------------------------------------------------------

// A count is a 3-4 digit number that is not part of a decimal, a version, an
// identifier or a hex colour, followed by what makes it a count of indicators.
const NUM = String.raw`(?<![\w.,$#/@+-])(\d{3,4})(?![\d.,]\d|[\w])`
// A line break inside a count phrase, with the prefix a wrapped markdown quote,
// doc comment or YAML block puts on the next line.
const BREAK = String.raw`[ \t]*\n[ \t]*(?:>[ \t]*|\/\/[!/]?[ \t]*|#'?[ \t]*|\*[ \t]*|--[ \t]*)?`
const GAP = String.raw`(?:[ \t]+|${BREAK})`
const QUAL = String.raw`(?:O\(1\)|streaming(?:-first)?|technical|backtestable|Wickra|\[Wickra\]\([^)\s]*\)|\x60?wickra-core\x60?|registry|registered|name-resolvable|C#|Go|Java|Node|WASM|Python|R)`
const TAIL = String.raw`(?:\*\*|<\/b>|<\/strong>)?(?:-(?:indicator|dim(?:ensional)?)\b|${GAP}(?:${QUAL}${GAP}){0,3}(?:indicators?\b|exported${GAP}types\b))`
const COUNT_RE = new RegExp(NUM + TAIL, 'g')
const BANNER_RE = /(wickra-banner\.(?:svg|webp)\?v=)(\d+)/g
// Tests that pin the whole catalogue: wickra-core's FAMILIES test adds up to
// it, and the R golden replay counts every indicator it checked (an R integer,
// so the literal ends in L).
const CATALOGUE_RES = [/(assert_eq!\(total,\s*)(\d+)/g, /(expect_equal\(checked,\s*)(\d+)(?=L\))/g]
// wickra's README comparison table: the Wickra row states the catalogue twice,
// as "yes, all N" and as a bare bold cell, with no "indicators" next to either.
const WICKRA_ROW_RE = /^\|\s*\*\*★&nbsp;Wickra\*\*.*$/gm
const ROW_COUNT_RE = /(?<=\ball )\d{3,4}\b|(?<=\|\s*\*\*)\d{3,4}(?=\*\*\s*\|)/g

// The live demo, the org banner and the published catalogue -- including the
// "the indicator core" row an ecosystem table gives wickra itself: always the
// latest core, whatever the repository pins.
const LIVE_RE = /Binance|live\.wickra\.org|Live demos?\b|in your browser|in-browser|The indicator core\b/i
// The one-line descriptions of the products that resolve through the backtest
// registry, as they appear in every ecosystem list, table and family.json.
// Not "registry resolves": the terminal has a registry of its own, and the
// registry products' repositories take the registry count by class anyway.
const REGISTRY_ROW_RE =
  /screening over|matrices over|live vector|indicator space|condition tree over|data-driven conditions over/i
// A measurement over the catalogue rather than its size.
const SUBSET_BEFORE_RE = /(?:\b\d[\d,]*(?:\*\*)?\s+of\s+(?:the\s+)?|\bremaining\s+)(?:\*\*)?$/i
// A registry count may not be called the core's.
// Prose wraps, so any space in the phrase may be a line break (with the prefix
// a wrapped list item or quote carries).
const W = String.raw`(?:\s|>)+`
const CORE_CLAIM_RE = new RegExp(
  [
    `of${W}the${W}Wickra${W}core\\b`,
    `Wickra${W}core's`,
    `from${W}the${W}Wickra${W}core`,
    `indicators${W}of${W}\\[\`?wickra(?:-core)?\`?\\]`,
    `library's${W}own`,
    `of${W}the${W}core\\b`,
    `core's${W}\\d`,
  ].join('|'),
  'i',
)

/** The sentence around [start, end): bounded by blank lines and sentence ends. */
function sentenceAround(text, start, end) {
  let head = text.slice(Math.max(0, start - 240), start)
  for (const re of [/\n[ \t>]*\n/g, /[.!?](?:\*\*)?\s/g]) {
    const all = [...head.matchAll(re)]
    if (all.length) head = head.slice(all.at(-1).index + all.at(-1)[0].length)
  }
  let tail = text.slice(end, end + 240)
  const blankAfter = tail.search(/\n[ \t>]*\n/)
  if (blankAfter >= 0) tail = tail.slice(0, blankAfter)
  const stopAfter = tail.search(/[.!?](?:\s|$)/)
  if (stopAfter >= 0) tail = tail.slice(0, stopAfter + 1)
  return head + text.slice(start, end) + tail
}

/** Decide what a count at [start, end) stands for. */
export function classify(text, start, end, repoClass) {
  const before = text.slice(Math.max(0, start - 40), start)
  if (SUBSET_BEFORE_RE.test(before)) return 'review'
  const sentence = sentenceAround(text, start, end)
  if (LIVE_RE.test(sentence)) return 'live'
  if (REGISTRY_ROW_RE.test(sentence)) return 'registry'
  return repoClass
}

const lineOf = (text, i) => text.slice(0, i).split('\n').length
const LOOSE_WINDOW = 40

/**
 * Rewrite the counts in one text. Returns the new text and what was found:
 * edits, review items (subset claims), contradictions (a registry count called
 * the core's) and loose numbers (a known count next to "indicator" that no rule
 * matched -- a phrasing this file does not know yet).
 */
export function syncText(input, { repo, counts }) {
  // A Windows checkout carries CRLF; the rules are written against LF, so the
  // text is matched as LF and handed back in the line endings it came in.
  const crlf = input.includes('\r\n')
  const res = syncLf(crlf ? input.replace(/\r\n/g, '\n') : input, { repo, counts })
  if (crlf) res.text = res.text.replace(/\n/g, '\r\n')
  return res
}

function syncLf(text, { repo, counts }) {
  const repoClass = REPOS[repo]
  if (!repoClass) throw new Error(`unknown repository ${repo}: add it to REPOS in sync-counts.mjs`)
  const edits = []
  const reviews = []
  const contradictions = []
  const covered = []
  const out = []
  let last = 0

  const hits = []
  for (const m of text.matchAll(BANNER_RE)) {
    const s = m.index + m[1].length
    hits.push({ start: s, end: s + m[2].length, value: m[2], cls: 'live', kind: 'banner' })
  }
  if (repo === 'wickra') {
    for (const re of CATALOGUE_RES) {
      for (const m of text.matchAll(re)) {
        const s = m.index + m[1].length
        hits.push({ start: s, end: s + m[2].length, value: m[2], cls: 'core', kind: 'catalogue' })
      }
    }
    for (const row of text.matchAll(WICKRA_ROW_RE)) {
      for (const m of row[0].matchAll(ROW_COUNT_RE)) {
        const s = row.index + m.index
        hits.push({ start: s, end: s + m[0].length, value: m[0], cls: 'core', kind: 'table' })
      }
    }
  }
  for (const m of text.matchAll(COUNT_RE)) {
    const s = m.index
    if (hits.some((h) => h.start < s + m[1].length && s < h.end)) continue
    const cls = classify(text, s, s + m[0].length, repoClass)
    hits.push({ start: s, end: s + m[1].length, value: m[1], cls, kind: 'count', phrase: m[0] })
  }
  hits.sort((a, b) => a.start - b.start)

  for (const h of hits) {
    covered.push([h.start, h.end])
    const line = lineOf(text, h.start)
    if (h.cls === 'own' || (h.cls === 'review' && repoClass === 'own')) continue
    if (h.cls === 'review') {
      reviews.push({ line, value: h.value, text: sentenceAround(text, h.start, h.end).trim() })
      continue
    }
    if (h.cls === 'registry' && CORE_CLAIM_RE.test(sentenceAround(text, h.start, h.end))) {
      contradictions.push({ line, value: h.value, text: sentenceAround(text, h.start, h.end).trim() })
    }
    const want = counts[h.cls]
    if (want == null) throw new Error(`no ${h.cls} count resolved`)
    if (String(want) !== h.value) {
      out.push(text.slice(last, h.start), String(want))
      last = h.end
      edits.push({ line, from: h.value, to: String(want), cls: h.cls })
    }
  }
  out.push(text.slice(last))

  // Loose: a number on a line that talks about indicators, close to a count
  // (a catalogue grows a few indicators per release, so a stale figure sits
  // near the current one) or equal to one matched elsewhere in the file, that
  // no rule above matched -- a phrasing the rules do not know yet.
  const loose = []
  if (repoClass !== 'own') {
    const targets = [counts.core, counts.live, counts.registry, counts.terminal].filter((v) => v != null)
    const seen = new Set(hits.map((h) => h.value))
    for (const m of text.matchAll(/(?<![\w.,$#/@+-])(\d{3,4})(?![\d.,]\d|[\w+])/g)) {
      const n = Number(m[1])
      if (!seen.has(m[1]) && !targets.some((c) => Math.abs(c - n) <= LOOSE_WINDOW)) continue
      if (covered.some(([a, b]) => m.index >= a && m.index < b)) continue
      // The part side of a subset claim ("461 of the 514") is not a count.
      if (/^(?:\*\*)?\s+of\s+(?:the\s+)?\d/.test(text.slice(m.index + m[1].length, m.index + m[1].length + 12))) continue
      const ls = text.lastIndexOf('\n', m.index) + 1
      const le = text.indexOf('\n', m.index)
      const lineText = text.slice(ls, le < 0 ? undefined : le)
      const onTopic = /indicator/i.test(lineText)
      const item = { line: lineOf(text, m.index), value: m[1], text: lineText.trim() }
      // The whole side of a subset claim is a measurement to recount -- also
      // when the sentence names the indicators on another line, as long as the
      // whole is exactly a count.
      if (SUBSET_BEFORE_RE.test(text.slice(Math.max(0, m.index - 40), m.index)) && (onTopic || targets.includes(n))) {
        reviews.push(item)
        continue
      }
      if (!onTopic) continue
      // wickra's own arithmetic over the catalogue (the class count without the
      // bar builders, a test's breakdown) moves with every indicator and is
      // recounted by the wiring, not renumbered: it is reported for review.
      if (repo === 'wickra') reviews.push(item)
      else loose.push(item)
    }
  }

  return { text: out.join(''), edits, reviews, contradictions, loose }
}

// --- Counts --------------------------------------------------------------------

/** The core count, by the rule check-indicator-count.yml uses. */
export function parseCoreCount(libRs) {
  const block = libRs.match(/^pub use indicators::\{([\s\S]*?)^\};/m)
  if (!block) throw new Error('lib.rs: no `pub use indicators::{…};` block')
  const names = new Set(
    block[1]
      .split(/[,{}\s]+/)
      .filter((w) => /^[A-Z][A-Za-z0-9_]*$/.test(w))
      .filter((w) => w !== 'FAMILIES' && !w.endsWith('Output')),
  )
  if (names.size < 100) throw new Error(`lib.rs: parsed only ${names.size} indicators; refusing a wrong number`)
  return names.size
}

/** The registry count gen_registry.py writes into registry.rs. */
export function parseRegistryCount(registryRs) {
  const m = registryRs.match(/valid default parameters\s*(?:\/\/\/\s*)?\((\d+) indicators\)/)
  if (!m) throw new Error('registry.rs: no "(N indicators)" line from gen_registry.py')
  const n = Number(m[1])
  if (n < 100) throw new Error(`registry.rs: ${n} indicators; refusing a wrong number`)
  return n
}

/** The terminal's own count, from its README markers (all must agree). */
export function parseTerminalCount(readme) {
  const all = [...readme.matchAll(/<!--indicator-count-->(\d+)<!--\/indicator-count-->/g)].map((m) => m[1])
  if (all.length === 0) throw new Error('wickra-terminal README: no indicator-count marker')
  if (new Set(all).size !== 1) throw new Error(`wickra-terminal README: markers disagree (${[...new Set(all)]})`)
  return Number(all[0])
}

/** The version a Cargo.lock pins for the first of `names` it carries. */
export function lockedVersion(lock, names) {
  for (const name of names) {
    const m = lock.match(new RegExp(String.raw`\[\[package\]\]\nname = "${name}"\nversion = "([^"]+)"`))
    if (m) return m[1]
  }
  return null
}

const token = () => process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''

async function get(url, { json = false } = {}) {
  const headers = { 'User-Agent': 'wickra-lib-sync-counts' }
  if (json) headers.Accept = 'application/vnd.github+json'
  if (token() && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token()}`
  let err
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers })
      if (res.ok) return json ? res.json() : res.text()
      err = new Error(`${url}: HTTP ${res.status}`)
      if (res.status === 404) break
    } catch (e) {
      err = e
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
  }
  throw err
}

const latestTag = async (repo) => (await get(`https://api.github.com/repos/${OWNER}/${repo}/releases/latest`, { json: true })).tag_name
const raw = (repo, ref, path) => get(`https://raw.githubusercontent.com/${OWNER}/${repo}/${ref}/${path}`)
const CORE_PATH = 'crates/wickra-core/src/lib.rs'
const REGISTRY_PATH = 'crates/wickra-backtest-core/src/registry.rs'

/** Resolve every count a repository needs; explicit values win. */
export async function resolveCounts({ repo, root, source = 'latest', given = {}, ref }) {
  // A file of the repository being synced: the working tree, or `ref`.
  const local = (rel) => {
    if (!root) return null
    if (ref) {
      try {
        return execFileSync('git', ['-C', root, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
      } catch {
        return null
      }
    }
    return existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null
  }
  const memo = new Map()
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn())
    return memo.get(key)
  }
  const coreAt = (ref) => once(`core@${ref}`, async () => parseCoreCount(await raw('wickra', ref, CORE_PATH)))
  const registryAt = (ref) => once(`reg@${ref}`, async () => parseRegistryCount(await raw('wickra-backtest', ref, REGISTRY_PATH)))
  const latestCore = async () => coreAt(await once('tag:wickra', () => latestTag('wickra')))
  const latestRegistry = async () => registryAt(await once('tag:backtest', () => latestTag('wickra-backtest')))

  const counts = { ...given }
  counts.live ??= await latestCore()

  const lock = source === 'pinned' ? local('Cargo.lock') : null
  if (counts.core == null) {
    const own = source === 'pinned' && repo === 'wickra' ? local(CORE_PATH) : null
    const v = lock && lockedVersion(lock, ['wickra-core'])
    counts.core = own ? parseCoreCount(own) : v ? await coreAt(`v${v}`) : await latestCore()
  }
  if (counts.registry == null) {
    const own = source === 'pinned' && repo === 'wickra-backtest' ? local(REGISTRY_PATH) : null
    const v = lock && lockedVersion(lock, ['wickra-backtest-core', 'wickra-backtest'])
    counts.registry = own ? parseRegistryCount(own) : v ? await registryAt(`v${v}`) : await latestRegistry()
  }
  if (counts.terminal == null && REPOS[repo] === 'terminal') {
    const tag = await latestTag('wickra-terminal')
    counts.terminal = parseTerminalCount(await raw('wickra-terminal', tag, 'README.md'))
  }
  return counts
}

// --- Files -----------------------------------------------------------------------

/** The files a rule may read: tracked in the working tree, or in `ref`. */
export function trackedFiles(root, repo, ref) {
  const args = ref ? ['ls-tree', '-r', '-z', '--name-only', ref] : ['ls-files', '-z']
  const out = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const excluded = new Set(EXCLUDE[repo] ?? [])
  return out.split('\0').filter((p) => p && !SKIP.test(p) && !excluded.has(p))
}

const asText = (buf) => {
  if (buf.includes(0)) return null // binary
  const text = buf.toString('utf8')
  return text.includes('�') ? null : text
}

/** The contents of `paths` at `ref`, through one `git cat-file --batch`. */
function readAtRef(root, ref, paths) {
  const out = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: paths.map((p) => `${ref}:${p}\n`).join(''),
    maxBuffer: 1 << 30,
  })
  const files = new Map()
  let at = 0
  for (const path of paths) {
    const nl = out.indexOf(10, at)
    const header = out.subarray(at, nl).toString('utf8')
    at = nl + 1
    const m = header.match(/^\S+ (\w+) (\d+)$/)
    if (!m) continue // "<ref>:<path> missing"
    const size = Number(m[2])
    if (m[1] === 'blob') files.set(path, out.subarray(at, at + size))
    at += size + 1
  }
  return files
}

/**
 * Sync every tracked file of a checkout. With `ref` the files are read from
 * that commit (e.g. origin/main after a fetch) and nothing is written: a check
 * of what is published, whatever the working tree holds.
 */
export function syncRepo(root, repo, counts, { write, ref }) {
  const report = { edits: [], reviews: [], contradictions: [], loose: [] }
  const paths = trackedFiles(root, repo, ref)
  const atRef = ref ? readAtRef(root, ref, paths) : null
  for (const rel of paths) {
    const path = join(root, rel)
    let text
    if (atRef) text = atRef.has(rel) ? asText(atRef.get(rel)) : null
    else text = existsSync(path) ? asText(readFileSync(path)) : null
    if (text == null) continue
    const res = syncText(text, { repo, counts })
    for (const key of Object.keys(report)) for (const item of res[key]) report[key].push({ file: rel, ...item })
    if (write && !ref && res.text !== text) writeFileSync(path, res.text)
  }
  return report
}

// --- CLI -------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { source: 'latest', given: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--repo') args.repo = next()
    else if (a === '--root') args.root = next()
    else if (a === '--source') args.source = next()
    else if (a === '--check') args.check = true
    else if (a === '--stdin') args.stdin = true
    else if (a === '--print-counts') args.printCounts = true
    else if (a === '--json') args.json = next()
    else if (a === '--ref') args.ref = next()
    else if (['--core', '--live', '--registry', '--terminal'].includes(a)) {
      const n = Number(next())
      if (!Number.isInteger(n) || n < 100) throw new Error(`${a} needs a count, got ${argv[i]}`)
      args.given[a.slice(2)] = n
    } else throw new Error(`unknown argument ${a}`)
  }
  if (!args.repo) throw new Error('--repo is required')
  if (!REPOS[args.repo]) throw new Error(`unknown repository ${args.repo}: add it to REPOS in sync-counts.mjs`)
  if (!['latest', 'pinned'].includes(args.source)) throw new Error('--source is latest or pinned')
  if (args.ref) args.check = true // a commit is read, never written
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root ?? '.')
  const counts = await resolveCounts({ repo: args.repo, root, source: args.source, given: args.given, ref: args.ref })

  if (args.printCounts) {
    process.stdout.write(JSON.stringify(counts) + '\n')
    return
  }

  if (args.stdin) {
    const text = readFileSync(0, 'utf8')
    const res = syncText(text, { repo: args.repo, counts })
    process.stdout.write(res.text)
    for (const c of res.contradictions) console.error(`contradiction: ${c.text}`)
    process.exit(res.contradictions.length ? 1 : 0)
  }

  const report = syncRepo(root, args.repo, counts, { write: !args.check, ref: args.ref })
  const shown = Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  console.log(`${args.repo}: ${shown}`)
  for (const e of report.edits) console.log(`  ${args.check ? 'off ' : 'set '} ${e.file}:${e.line} ${e.from} -> ${e.to} (${e.cls})`)
  for (const r of report.reviews) console.log(`  review ${r.file}:${r.line} ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`)
  for (const c of report.contradictions)
    console.log(`  contradiction ${c.file}:${c.line} a registry count called the core's: ${c.text.replace(/\s+/g, ' ').slice(0, 200)}`)
  for (const l of report.loose) console.log(`  loose ${l.file}:${l.line} ${l.value} matched no rule: ${l.text.slice(0, 200)}`)
  if (args.json) writeFileSync(args.json, JSON.stringify({ repo: args.repo, counts, ...report }, null, 2) + '\n')

  // Writing never fails on what it reports: a bot still commits the counts it
  // could set. --check is the gate.
  const failed = report.contradictions.length + report.loose.length + report.edits.length
  process.exit(args.check && failed ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`sync-counts: ${err.message}`)
    process.exit(2)
  })
}
