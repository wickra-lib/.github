/*
 * Is every repository's main branch green -- and if not, what exactly failed?
 *
 * The hourly port of the workspace tools main_status.py, open_runs.py and
 * action_warnings.py, so the answer is a file to read instead of an org-wide
 * scan run by hand on a person's token. Three parts, one pass:
 *
 *   1. Main status. For every repository of the org (archived ones skipped):
 *      the newest commit on the default branch and everything GitHub records
 *      against it -- every check run at its latest attempt (a cancelled check
 *      whose name also passed or is still running on the commit was superseded
 *      by a second push, not failed) and every commit status (r-universe and
 *      Codecov post these instead of check runs, so a main can be green in
 *      check runs and still red). Each red check lists its error annotations
 *      and the error lines of its job log. The lychee jobs never turn a commit
 *      red; their findings arrive as "Broken link" warnings on a green check
 *      and are listed apart, from the newest run of each link check only.
 *
 *   2. Open runs. Every GitHub Actions run that is queued, in progress,
 *      waiting, requested or pending on any branch or commit, and every check
 *      run of another app (Cloudflare Pages, CodSpeed, ...) still open on a
 *      default-branch commit of the last OPEN_DAYS days or on an open pull
 *      request's head -- a run hung on an older commit never shows on the
 *      newest one. Only the app that created a check run can close it. One
 *      the same app has since passed on the branch head is marked superseded.
 *      Runs in STRANDED are ones GitHub left queued for good (the 2026-10-07
 *      outage); they are counted apart so a new hang is not lost among them.
 *      status.json keeps each run's id, attempt and start for cancel_runs.py.
 *
 *   3. Action warnings. Every warning annotation the Actions runs printed on
 *      the newest main commit and on the head of the newest pull request a
 *      person opened (bots skipped), grouped by message across repositories --
 *      a deprecation sits on green runs long before it turns them red.
 *
 * The check runs of each main commit are read once and shared by all three
 * parts. The token is STATUS_TOKEN (the read-only wickra-lib-status app's
 * installation token, about 7900 requests an hour for this org) or else
 * GH_TOKEN; when the
 * remaining budget drops below RESERVE, the later parts are skipped and the
 * report says so instead of pretending the org is clean. STATUS_REPOS
 * (comma-separated) limits a run to some repositories, for a local test.
 *
 * Output: versions/status.md and versions/status.json. Times are absolute
 * (no "5 minutes ago"), so an unchanged org writes an unchanged file and the
 * workflow commits only when something moved.
 */
import { mkdir, writeFile } from 'node:fs/promises'

const ORG = 'wickra-lib'
const API = 'https://api.github.com'
const ATTEMPTS = 5
const TOKEN = process.env.STATUS_TOKEN || process.env.GH_TOKEN
const TOKEN_NAME = process.env.STATUS_TOKEN ? 'the wickra-lib-status installation token' : 'GITHUB_TOKEN'
const ONLY = (process.env.STATUS_REPOS || '').split(',').map((s) => s.trim()).filter(Boolean)
const OPEN_DAYS = 3
const RESERVE = 300
const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'])
const OK = new Set(['success'])
const SKIP = new Set(['skipped', 'neutral'])
const LINK_CHECK = /\blinks\b/i
const OPEN_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending']
const GROUPS = [[20, '>= 20h'], [10, '10-20h'], [1, '1-10h'], [0, '< 1h']]
// Scheduled runs created during GitHub's write outage of 2026-10-07 (16:52-16:57
// UTC): queued with no jobs, cancel and force-cancel 409, delete 403. Drop an id
// once GitHub has cleared it. Same list as the workspace's open_runs.py.
const STRANDED = new Set([
  37655498824, 37655500831, 37655500994, 37655501023, 37655505511, 37655505869, 37655506691,
  37655507032, 37655507420, 37655508055, 37655508427, 37655508740, 37655509922, 37655511983,
  37655512887, 37655512998, 37655513974, 37655514883, 37655524293, 37655526322, 37655527277,
  37655527834, 37655528093, 37655528728, 37655533341,
])
const ERR_LINE = /##\[error\](.*)|^.*\berror(\[[A-Z0-9]+\])?:\s.*$|fatal: .*|FAILED.*/i

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let remaining = Infinity
let requests = 0
const skipped = []

async function request(url, { raw = false } = {}) {
  let reason = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(url.startsWith('http') ? url : API + url, {
        headers: {
          authorization: `bearer ${TOKEN}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'wickra-lib/.github fetch-status',
        },
      })
    } catch (err) {
      reason = err.message
      if (attempt < ATTEMPTS) await sleep(attempt * 500)
      continue
    }
    requests++
    const left = res.headers.get('x-ratelimit-remaining')
    if (left !== null) remaining = Number(left)
    if (res.status === 404) return null
    if ((res.status === 403 || res.status === 429) && remaining === 0) {
      throw new Error(`rate limit exhausted at ${url}`)
    }
    if (res.ok) {
      // A 2xx status line does not mean the body arrived (see fetch-inbox.mjs):
      // read and, for JSON, parse it inside the retry loop.
      try {
        const text = await res.text()
        if (raw) return { text, headers: res.headers }
        return { body: text ? JSON.parse(text) : null, headers: res.headers }
      } catch (err) {
        reason = `incomplete body: ${err.message}`
        if (attempt < ATTEMPTS) await sleep(attempt * 500)
        continue
      }
    }
    if (res.status < 500 && res.status !== 429) throw new Error(`${url} -> HTTP ${res.status}`)
    reason = `HTTP ${res.status}`
    if (attempt < ATTEMPTS) await sleep(attempt * 1000)
  }
  throw new Error(`${url} unreachable after ${ATTEMPTS} attempts: ${reason}`)
}

async function get(url) {
  const res = await request(url)
  return res ? res.body : null
}

// Follows rel="next"; list endpoints return an array, check runs and workflow
// runs wrap theirs in an object.
async function paged(url, key) {
  const out = []
  let next = url + (url.includes('?') ? '&' : '?') + 'per_page=100'
  while (next) {
    const res = await request(next)
    if (!res) break
    const body = res.body
    out.push(...(Array.isArray(body) ? body : (key && body[key]) || []))
    const m = (res.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/)
    next = m ? m[1] : null
  }
  return out
}

const enough = () => remaining > RESERVE
const oneLine = (s) => String(s).split(/\s+/).join(' ').trim()
const isBot = (user) => !user || user.type === 'Bot' || (user.login || '').endsWith('[bot]')

// ---------------------------------------------------------------- 1. main status

// The newest run of each link check: a scheduled sweep and a dispatched re-run
// are two suites on one commit, and only the newest one's findings are current.
function newestLinkRuns(runs) {
  const newest = new Map()
  for (const r of runs) {
    if (LINK_CHECK.test(r.name) && r.started_at) {
      const cur = newest.get(r.name)
      if (!cur || r.started_at > cur.started_at) newest.set(r.name, { started_at: r.started_at, id: r.id })
    }
  }
  return newest
}

async function annotations(repo, runId) {
  return paged(`/repos/${ORG}/${repo}/check-runs/${runId}/annotations`)
}

let logsReadable = true
async function logErrors(repo, jobId) {
  if (!logsReadable) return []
  let res
  try {
    res = await request(`/repos/${ORG}/${repo}/actions/jobs/${jobId}/logs`, { raw: true })
  } catch (err) {
    if (/HTTP 40[13]/.test(err.message)) {
      logsReadable = false
      return []
    }
    throw err
  }
  const out = []
  for (let line of (res ? res.text : '').split('\n')) {
    line = line.replace(/^\S+Z\s/, '')
    if (ERR_LINE.test(line)) {
      const msg = oneLine(line).slice(0, 240)
      if (!out.includes(msg)) out.push(msg)
    }
  }
  return out
}

async function repoStatus(repo) {
  const name = repo.name
  const commit = await get(`/repos/${ORG}/${name}/commits/${repo.default_branch}`)
  if (!commit) return { repo: name, branch: repo.default_branch, error: 'no commit on the default branch' }
  const sha = commit.sha
  const out = {
    repo: name, branch: repo.default_branch, sha: sha.slice(0, 8), full_sha: sha,
    subject: commit.commit.message.split('\n')[0].slice(0, 72),
    committed_at: commit.commit.committer.date,
    passed: [], failed: [], running: [], skipped: [], links: [],
  }
  const runs = await paged(`/repos/${ORG}/${name}/commits/${sha}/check-runs?filter=latest`, 'check_runs')
  out.runs = runs // shared with parts 2 and 3, dropped before writing
  const live = new Set(runs.filter((r) => r.status !== 'completed' || OK.has(r.conclusion)).map((r) => r.name))
  const newestLink = newestLinkRuns(runs)
  for (const run of runs) {
    const label = run.name
    if (run.status === 'completed' && run.conclusion === 'cancelled' && live.has(label)) continue
    if (run.status !== 'completed') {
      out.running.push(label)
    } else if (OK.has(run.conclusion)) {
      out.passed.push(label)
      const newest = newestLink.get(label)
      if (LINK_CHECK.test(label) && run.output?.annotations_count && (!newest || newest.id === run.id)) {
        for (const a of await annotations(name, run.id)) {
          const msg = a.message ? oneLine(a.message) : ''
          if (a.title === 'Broken link' && msg && !out.links.includes(msg)) out.links.push(msg)
        }
      }
    } else if (SKIP.has(run.conclusion)) {
      out.skipped.push(label)
    } else {
      const errors = []
      if (run.output?.annotations_count) {
        for (const a of await annotations(name, run.id)) {
          if (['failure', 'warning'].includes(a.annotation_level) && a.message) {
            const msg = oneLine(a.message)
            if (!errors.includes(msg)) errors.push(msg)
          }
        }
      }
      if (run.app?.slug === 'github-actions') {
        for (const msg of await logErrors(name, run.id)) if (!errors.includes(msg)) errors.push(msg)
      }
      out.failed.push({ name: label, conclusion: run.conclusion, url: run.html_url, errors: errors.slice(0, 8) })
    }
  }
  const combined = (await get(`/repos/${ORG}/${name}/commits/${sha}/status`)) || {}
  for (const st of combined.statuses || []) {
    const label = `status: ${st.context}`
    if (st.state === 'success') out.passed.push(label)
    else if (st.state === 'pending') out.running.push(label)
    else out.failed.push({ name: label, conclusion: st.state, url: st.target_url, errors: st.description ? [st.description] : [] })
  }
  return out
}

// ---------------------------------------------------------------- 2. open runs

async function workflowRuns(name) {
  const seen = new Set()
  const out = []
  for (const status of OPEN_STATUSES) {
    for (const run of await paged(`/repos/${ORG}/${name}/actions/runs?status=${status}`, 'workflow_runs')) {
      if (seen.has(run.id) || run.status === 'completed') continue
      seen.add(run.id)
      out.push({
        kind: 'actions', repo: name, id: run.id, attempt: run.run_attempt || 1, name: run.name,
        title: (run.display_title || '').slice(0, 72), event: run.event, branch: run.head_branch,
        sha: run.head_sha.slice(0, 8), status: run.status, started_at: run.run_started_at || run.created_at,
        url: run.html_url, stranded: STRANDED.has(run.id),
      })
    }
  }
  return out
}

async function foreignChecks(repo, main) {
  const name = repo.name
  const head = main.full_sha
  const onHead = main.runs
  const passedOnHead = new Set(onHead
    .filter((r) => r.status === 'completed' && r.conclusion === 'success')
    .map((r) => `${r.app?.slug}\u0000${r.name}`))
  const shas = [head]
  for (const pr of await paged(`/repos/${ORG}/${name}/pulls?state=open`)) shas.push(pr.head.sha)
  // The default-branch history only where another app posts checks on the
  // head: an app that is not there now left nothing behind recently.
  if (onHead.some((r) => r.app?.slug !== 'github-actions')) {
    const since = new Date(Date.now() - OPEN_DAYS * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    for (const c of await paged(`/repos/${ORG}/${name}/commits?sha=${repo.default_branch}&since=${since}`)) shas.push(c.sha)
  }
  const out = []
  const seen = new Set()
  for (const sha of [...new Set(shas)]) {
    const runs = sha === head ? onHead : ((await get(`/repos/${ORG}/${name}/commits/${sha}/check-runs?filter=latest&per_page=100`)) || {}).check_runs || []
    for (const run of runs) {
      const app = run.app?.slug || '?'
      if (run.status === 'completed' || app === 'github-actions' || seen.has(run.id)) continue
      seen.add(run.id)
      out.push({
        kind: 'check', repo: name, id: run.id, app, name: run.name, sha: sha.slice(0, 8),
        status: run.status, started_at: run.started_at || '', url: run.html_url, details_url: run.details_url,
        superseded: sha !== head && passedOnHead.has(`${app}\u0000${run.name}`),
      })
    }
  }
  return out
}

const hoursSince = (iso) => (Date.now() - Date.parse(iso)) / 3600000
const groupOf = (h) => GROUPS.find(([floor]) => h >= floor)[1]

// ---------------------------------------------------------------- 3. warnings

async function newestOwnPr(name) {
  const prs = (await get(`/repos/${ORG}/${name}/pulls?state=all&sort=created&direction=desc&per_page=30`)) || []
  return prs.find((pr) => !isBot(pr.user)) || null
}

async function warningsOn(name, runs) {
  const out = []
  const seen = new Set()
  const newestLink = newestLinkRuns(runs)
  for (const run of runs) {
    if (run.app?.slug !== 'github-actions') continue
    const newest = newestLink.get(run.name)
    if (newest && newest.id !== run.id) continue
    if (!run.output?.annotations_count) continue
    for (const a of await annotations(name, run.id)) {
      if (a.annotation_level !== 'warning' || !a.message) continue
      const msg = oneLine(a.message)
      if (seen.has(`${run.id}\u0000${msg}`)) continue
      seen.add(`${run.id}\u0000${msg}`)
      out.push({ message: msg, job: run.name, url: run.html_url, path: ['', '.github', undefined, null].includes(a.path) ? null : a.path })
    }
  }
  return out
}

// One cause groups once: run-specific numbers, hashes and workspace paths masked.
const normalise = (msg) => msg
  .replace(/\/home\/runner\/work\/[^/\s]+\/[^/\s]+/g, '<workspace>')
  .replace(/\b[0-9a-f]{12,40}\b/g, '<sha>')
  .replace(/\d+(\.\d+)?/g, '#')

// ---------------------------------------------------------------- run

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

let repos = (await paged(`/orgs/${ORG}/repos?type=all`)).filter((r) => !r.archived)
if (ONLY.length) repos = repos.filter((r) => ONLY.includes(r.name))
repos.sort((a, b) => a.name.localeCompare(b.name))

const results = await pool(repos, 8, async (repo) => {
  try {
    return await repoStatus(repo)
  } catch (err) {
    return { repo: repo.name, error: `not read -- ${err.message.slice(0, 160)}` }
  }
})

let openRuns = []
const openFailed = []
if (enough()) {
  const byName = new Map(results.map((r) => [r.repo, r]))
  const found = await pool(repos, 8, async (repo) => {
    const main = byName.get(repo.name)
    try {
      const wf = await workflowRuns(repo.name)
      const fc = main && !main.error ? await foreignChecks(repo, main) : []
      return [...wf, ...fc]
    } catch (err) {
      openFailed.push(repo.name)
      return []
    }
  })
  openRuns = found.flat().filter((r) => r.started_at)
  openRuns.sort((a, b) => a.repo.localeCompare(b.repo) || Date.parse(a.started_at) - Date.parse(b.started_at))
} else {
  skipped.push('open runs')
}

let warnings = []
if (enough()) {
  const byName = new Map(results.map((r) => [r.repo, r]))
  warnings = await pool(repos, 8, async (repo) => {
    const res = { repo: repo.name, targets: [], error: null }
    try {
      const main = byName.get(repo.name)
      if (main && !main.error) res.targets.push({ source: 'main', ref: main.sha, warnings: await warningsOn(repo.name, main.runs) })
      if (enough()) {
        const pr = await newestOwnPr(repo.name)
        if (pr) {
          const runs = await paged(`/repos/${ORG}/${repo.name}/commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs')
          res.targets.push({ source: `pr#${pr.number}`, ref: pr.head.sha.slice(0, 8), warnings: await warningsOn(repo.name, runs) })
        }
      }
    } catch (err) {
      res.error = err.message.slice(0, 200)
    }
    return res
  })
} else {
  skipped.push('action warnings')
}

for (const r of results) delete r.runs

// ---------------------------------------------------------------- write

const red = results.filter((r) => r.failed?.length || r.error)
const busy = results.filter((r) => !r.failed?.length && r.running?.length && !r.error)
const green = results.filter((r) => !r.failed?.length && !r.running?.length && !r.error)
const linked = results.filter((r) => r.links?.length)
const stranded = openRuns.filter((r) => r.stranded)
const actionsOpen = openRuns.filter((r) => r.kind === 'actions' && !r.stranded)
const checksOpen = openRuns.filter((r) => r.kind === 'check')
const ghosts = checksOpen.filter((r) => r.superseded)

const groups = new Map()
for (const r of warnings) {
  for (const t of r.targets) {
    for (const w of t.warnings) {
      const key = normalise(w.message)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ repo: r.repo, source: t.source, ref: t.ref, ...w })
    }
  }
}
const warnGroups = [...groups.entries()]
  .map(([key, hits]) => ({ key, message: hits[0].message, hits, repos: [...new Set(hits.map((h) => h.repo))].sort() }))
  .sort((a, b) => b.repos.length - a.repos.length || a.key.localeCompare(b.key))

const scannedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|')
const commitUrl = (r) => `https://github.com/${ORG}/${r.repo}/commit/${r.full_sha}`
const L = []
L.push('# Main status', '', 'Generated by [`scripts/fetch-status.mjs`](../scripts/fetch-status.mjs) every hour -- do not edit by hand.', '')
L.push(`Last scan: **${scannedAt}** over ${results.length} repositories with ${TOKEN_NAME}.`, '')
L.push(`**${green.length} green, ${busy.length} still running, ${red.length} red**` + (red.length ? ` -- red: ${red.map((r) => `\`${r.repo}\``).join(', ')}` : '') + '.', '')
if (skipped.length) L.push(`Not collected this run, the API budget ran low: ${skipped.join(', ')}. That is not "nothing found".`, '')
if (!logsReadable) L.push('Job logs were not readable with this token, so red checks list their annotations only.', '')

L.push(`## Red mains (${red.length})`, '')
if (red.length) {
  for (const r of red) {
    if (r.error) {
      L.push(`- \`${r.repo}\`: ${cell(r.error)}`)
      continue
    }
    L.push(`- \`${r.repo}\` [\`${r.sha}\`](${commitUrl(r)}) ${cell(r.subject)} (committed ${r.committed_at})`)
    for (const f of r.failed) {
      L.push(`  - **${cell(f.name)}** (${f.conclusion})${f.url ? ` [run](${f.url})` : ''}`)
      for (const e of f.errors) L.push(`    - \`${cell(e).replace(/`/g, "'")}\``)
    }
  }
  L.push('')
} else {
  L.push('None.', '')
}

L.push(`## Still running (${busy.length})`, '')
if (busy.length) {
  for (const r of busy) L.push(`- \`${r.repo}\` [\`${r.sha}\`](${commitUrl(r)}): ${r.running.slice(0, 6).map(cell).join(', ')}${r.running.length > 6 ? ' ...' : ''}`)
  L.push('')
} else {
  L.push('None.', '')
}

L.push(`## Broken links (${linked.reduce((n, r) => n + r.links.length, 0)})`, '')
L.push('Advisory: the link checks never turn a commit red.', '')
if (linked.length) {
  for (const r of linked) for (const link of r.links) L.push(`- \`${r.repo}\`: ${cell(link)}`)
  L.push('')
} else {
  L.push('None.', '')
}

// The stranded runs (2026-10-07 outage) stay out of the Markdown entirely --
// no count in the heading, no line below: nothing can end them and they never
// change, so they are only noise here. status.json still lists every one.
L.push(`## Open runs (${actionsOpen.length} workflow runs, ${checksOpen.length - ghosts.length} checks of other apps${ghosts.length ? `, +${ghosts.length} superseded` : ''})`, '')
if (skipped.includes('open runs')) {
  L.push('Not collected this run.', '')
} else {
  if (openFailed.length) L.push(`Not scanned (API error): ${openFailed.map((n) => `\`${n}\``).join(', ')}.`, '')
  const shown = openRuns.filter((r) => !r.stranded)
  if (shown.length) {
    L.push('| Repository | Kind | Status | Since | What |', '|---|---|---|---|---|')
    for (const r of shown) {
      if (r.kind === 'actions') {
        L.push(`| \`${r.repo}\` | workflow | ${r.status} | ${r.started_at} | [${cell(r.name)}](${r.url}) (${r.event}, ${cell(r.branch)} ${r.sha}) |`)
      } else {
        const note = r.superseded ? `passed on the branch head since; a ghost only ${r.app} could close` : `only ${r.app} can close it`
        L.push(`| \`${r.repo}\` | ${r.superseded ? 'superseded' : 'check'} | ${r.status} | ${r.started_at} | [${cell(r.name)}](${r.details_url || r.url}) [${r.app}] on ${r.sha} -- ${note} |`)
      }
    }
    L.push('')
    const counts = GROUPS.map(([, label]) => `${label}: ${actionsOpen.filter((r) => groupOf(hoursSince(r.started_at)) === label).length}`)
    L.push(`Workflow runs by age at the scan: ${counts.join(', ')}.`, '')
  } else {
    L.push('None.', '')
  }
}

const occurrences = warnGroups.reduce((n, g) => n + g.hits.length, 0)
L.push(`## Action warnings (${warnGroups.length} distinct, ${occurrences} occurrences)`, '')
L.push('Warning annotations on the newest main commit and the newest pull request a person opened. They never fail a check; deprecations show here first.', '')
if (skipped.includes('action warnings')) {
  L.push('Not collected this run.', '')
} else if (warnGroups.length) {
  for (const g of warnGroups) {
    L.push(`<details><summary>${cell(g.message).slice(0, 300).replace(/</g, '&lt;')} -- ${g.repos.length} repo(s), ${g.hits.length} job(s)</summary>`, '')
    const byRepo = new Map()
    for (const h of g.hits) {
      if (!byRepo.has(h.repo)) byRepo.set(h.repo, new Set())
      byRepo.get(h.repo).add(`${h.source} ${h.job}${h.path ? ` (${h.path})` : ''}`)
    }
    for (const repo of g.repos) L.push(`- \`${repo}\`: ${[...byRepo.get(repo)].sort().map(cell).join('; ')}`)
    L.push('', '</details>', '')
  }
  const errs = warnings.filter((w) => w.error)
  if (errs.length) L.push(`Not scanned: ${errs.map((w) => `\`${w.repo}\``).join(', ')}.`, '')
} else {
  L.push('None.', '')
}

L.push(`## Green (${green.length})`, '')
L.push(green.length ? green.map((r) => `\`${r.repo}\``).join(', ') : 'None.', '')

await mkdir('versions', { recursive: true })
await writeFile('versions/status.md', L.join('\n') + '\n')
await writeFile('versions/status.json', JSON.stringify({
  scanned_at: scannedAt, org: ORG, token: TOKEN_NAME, skipped, logs_readable: logsReadable,
  summary: { repositories: results.length, green: green.length, running: busy.length, red: red.map((r) => r.repo) },
  mains: results, open_runs: openRuns, open_runs_not_scanned: openFailed,
  warnings: warnGroups.map((g) => ({ message: g.message, repos: g.repos, hits: g.hits })),
}, null, 2) + '\n')
console.log(`status: ${green.length} green, ${busy.length} running, ${red.length} red; ${actionsOpen.length} open workflow runs, ${checksOpen.length} open checks; ${warnGroups.length} warning groups; ${requests} requests, ${Number.isFinite(remaining) ? remaining : '?'} left${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`)
