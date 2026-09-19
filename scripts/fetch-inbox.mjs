/*
 * The org's inbox: what is waiting for a person, across every repository.
 *
 * Three lists, rewritten from scratch on every run so they hold only what is
 * open right now (a merged or closed item simply disappears):
 *
 *   1. Dependabot pull requests whose checks have finished -- with the verdict
 *      (green, or which checks are red), so the daily look is "merge or fix",
 *      not "wait". PRs still running their checks are counted, not listed.
 *   2. Issues and pull requests opened by people outside the org -- anyone who
 *      is neither a bot, nor an automation account, nor an owner, member or
 *      collaborator of the repository (the item's author_association).
 *   3. Open security alerts -- code scanning, Dependabot and secret scanning,
 *      one row per alert.
 *
 * The token matters. The workflow's own token sees public data only: a
 * private org membership is invisible to it (so a member's author_association
 * reads CONTRIBUTOR and their items land in list 2), and the alert endpoints
 * answer it 403 for every repository but this one. INBOX_TOKEN -- a
 * fine-grained token of an org member with read access to code scanning,
 * Dependabot and secret scanning alerts on the org's repositories -- is used
 * for everything when set. Without it, the inbox says which repositories it
 * could not read rather than counting them as clean.
 *
 * Every repository the org exposes is scanned, sites and mirrors included,
 * because Dependabot runs in all of them. Output: inbox/README.md and
 * inbox/state.json; the workflow commits only when the lists changed.
 */
import { mkdir, writeFile } from 'node:fs/promises'

const ORG = 'wickra-lib'
const ATTEMPTS = 5
// Logins that are automation even though the API may type them as User.
const AUTOMATION = new Set(['wickra-bot', 'dependabot[bot]', 'github-actions[bot]', 'dependabot', 'github-actions'])
// author_association values that mean "one of us".
const INSIDE = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const TOKEN = process.env.INBOX_TOKEN || process.env.GH_TOKEN
const TOKEN_NAME = process.env.INBOX_TOKEN ? 'INBOX_TOKEN' : 'GITHUB_TOKEN'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function request(url) {
  let reason = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(url, {
        headers: {
          authorization: `bearer ${TOKEN}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'wickra-lib/.github fetch-inbox',
        },
      })
    } catch (err) {
      reason = err.message
      if (attempt < ATTEMPTS) await sleep(attempt * 500)
      continue
    }
    if (res.status === 404) return null
    if (res.ok) return res
    if (res.status < 500 && res.status !== 429) throw new Error(`${url} -> HTTP ${res.status}`)
    reason = `HTTP ${res.status}`
    if (attempt < ATTEMPTS) await sleep(attempt * 500)
  }
  throw new Error(`${url} unreachable after ${ATTEMPTS} attempts: ${reason}`)
}

// Follows GitHub's Link: rel="next" pagination and concatenates the pages.
async function paged(url) {
  const out = []
  let next = url
  while (next) {
    const res = await request(next)
    if (!res) break
    const body = await res.json()
    // Most list endpoints return an array; check-runs wrap theirs in an object.
    out.push(...(Array.isArray(body) ? body : body.check_runs || []))
    const link = res.headers.get('link') || ''
    const m = link.match(/<([^>]+)>;\s*rel="next"/)
    next = m ? m[1] : null
  }
  return out
}

const isBot = (user) => !user || user.type === 'Bot' || user.login.endsWith('[bot]') || AUTOMATION.has(user.login)
const isDependabot = (user) => !!user && user.login.startsWith('dependabot')

// One verdict per PR head: every check run and every commit status, reduced to
// {done, failing[]}. A check that is still queued or running makes done false.
async function verdict(repo, sha) {
  const checks = await paged(`https://api.github.com/repos/${ORG}/${repo}/commits/${sha}/check-runs?per_page=100`)
  const statusRes = await request(`https://api.github.com/repos/${ORG}/${repo}/commits/${sha}/status`)
  const statuses = statusRes ? (await statusRes.json()).statuses || [] : []
  let done = true
  const failing = []
  for (const c of checks) {
    if (c.status !== 'completed') done = false
    else if (!['success', 'skipped', 'neutral'].includes(c.conclusion)) failing.push(c.name)
  }
  for (const s of statuses) {
    if (s.state === 'pending') done = false
    else if (s.state !== 'success') failing.push(s.context)
  }
  return { done, failing, total: checks.length + statuses.length }
}

const age = (iso) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000)
  return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`
}

// An item is from outside when its author is a person and the repository does
// not know them as owner, member or collaborator.
const outsider = (item) => !isBot(item.user) && !INSIDE.has(item.author_association)

// The three alert lists of one repository, each reduced to rows. A 403 means
// the token cannot read that list (the alert endpoints need security_events);
// that is reported as unreadable rather than as zero alerts. 404 means the
// feature is off for the repository, which is a real zero.
async function alertsOf(repo) {
  const rows = []
  const unreadable = []
  const pull = async (kind, path) => {
    try {
      return await paged(`https://api.github.com/repos/${ORG}/${repo}/${path}?state=open&per_page=100`)
    } catch (err) {
      if (!/HTTP 403/.test(err.message)) throw err
      unreadable.push(kind)
      return []
    }
  }
  for (const a of await pull('code scanning', 'code-scanning/alerts')) {
    const severity = a.rule.security_severity_level || a.rule.severity || ''
    rows.push({ repo, kind: 'code scanning', severity, number: a.number, url: a.html_url, created: a.created_at, title: `${a.tool.name}: ${a.rule.description || a.rule.id}` })
  }
  for (const a of await pull('Dependabot', 'dependabot/alerts')) {
    const dep = a.dependency || {}
    const adv = a.security_advisory || {}
    const where = [dep.package && dep.package.name, dep.manifest_path].filter(Boolean).join(' in ')
    rows.push({ repo, kind: 'Dependabot', severity: adv.severity || '', number: a.number, url: a.html_url, created: a.created_at, title: `${where}: ${adv.summary || adv.ghsa_id || ''}` })
  }
  for (const a of await pull('secret scanning', 'secret-scanning/alerts')) {
    rows.push({ repo, kind: 'secret scanning', severity: '', number: a.number, url: a.html_url, created: a.created_at, title: a.secret_type_display_name || a.secret_type })
  }
  return { rows, unreadable }
}

const repos = (await paged(`https://api.github.com/orgs/${ORG}/repos?type=public&per_page=100`))
  .filter((r) => !r.archived)
  .map((r) => r.name)
  .sort()

const dependabot = []
let waiting = 0
const people = []
const alerts = []
const unreadable = []
for (const repo of repos) {
  const prs = await paged(`https://api.github.com/repos/${ORG}/${repo}/pulls?state=open&per_page=100`)
  for (const pr of prs) {
    if (isDependabot(pr.user)) {
      const v = await verdict(repo, pr.head.sha)
      if (!v.done) {
        waiting++
        continue
      }
      dependabot.push({ repo, number: pr.number, title: pr.title, url: pr.html_url, created: pr.created_at, failing: v.failing, checks: v.total })
    } else if (outsider(pr)) {
      people.push({ kind: 'pull request', repo, number: pr.number, title: pr.title, url: pr.html_url, author: pr.user.login, created: pr.created_at })
    }
  }
  const issues = await paged(`https://api.github.com/repos/${ORG}/${repo}/issues?state=open&per_page=100`)
  for (const issue of issues) {
    if (issue.pull_request || !outsider(issue)) continue
    people.push({ kind: 'issue', repo, number: issue.number, title: issue.title, url: issue.html_url, author: issue.user.login, created: issue.created_at })
  }
  const a = await alertsOf(repo)
  alerts.push(...a.rows)
  if (a.unreadable.length) unreadable.push({ repo, kinds: a.unreadable })
}
people.sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
const SEVERITY = ['critical', 'high', 'error', 'medium', 'warning', 'moderate', 'low', 'note', '']
alerts.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) || Date.parse(b.created) - Date.parse(a.created))

const scannedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const cell = (s) => String(s).replace(/\|/g, '\\|')
const lines = []
lines.push('# Inbox', '', 'Generated by [`scripts/fetch-inbox.mjs`](../scripts/fetch-inbox.mjs) -- do not edit by hand.', '')
lines.push(`Last scan: **${scannedAt}** over ${repos.length} repositories. All three lists hold only what is open now.`, '')

lines.push(`## Dependabot pull requests with finished checks (${dependabot.length})`, '')
if (waiting) lines.push(`${waiting} more still running their checks -- they appear here once the checks finish.`, '')
if (dependabot.length) {
  lines.push('| Repository | PR | Checks | Age | Title |', '|---|---|---|---|---|')
  for (const d of dependabot) {
    const checks = d.failing.length ? `red: ${d.failing.join(', ')}` : `green (${d.checks})`
    lines.push(`| \`${d.repo}\` | [#${d.number}](${d.url}) | ${cell(checks)} | ${age(d.created)} | ${cell(d.title)} |`)
  }
  lines.push('')
} else {
  lines.push('None.', '')
}

lines.push(`## Issues and pull requests opened by people outside the org (${people.length})`, '')
if (!process.env.INBOX_TOKEN) lines.push('GITHUB_TOKEN cannot see private org memberships, so items by members with a private membership appear here too until INBOX_TOKEN is set.', '')
if (people.length) {
  lines.push('| Repository | Item | Author | Age | Title |', '|---|---|---|---|---|')
  for (const p of people) {
    lines.push(`| \`${p.repo}\` | [${p.kind} #${p.number}](${p.url}) | @${p.author} | ${age(p.created)} | ${cell(p.title)} |`)
  }
  lines.push('')
} else {
  lines.push('None.', '')
}

lines.push(`## Open security alerts (${alerts.length})`, '')
lines.push('Code scanning, Dependabot and secret scanning alerts.', '')
if (unreadable.length === repos.length) {
  lines.push(`None of the ${repos.length} repositories' alert lists are readable with ${TOKEN_NAME}, so nothing is counted. Set INBOX_TOKEN to a token with read access to the three alert lists on the org's repositories.`, '')
} else if (unreadable.length) {
  const named = unreadable.map((u) => `\`${u.repo}\` (${u.kinds.join(', ')})`).join(', ')
  lines.push(`Not readable with ${TOKEN_NAME}, so not counted: ${named}.`, '')
}
if (alerts.length) {
  lines.push('| Repository | Kind | Severity | Alert | Age | Title |', '|---|---|---|---|---|---|')
  for (const a of alerts) {
    lines.push(`| \`${a.repo}\` | ${a.kind} | ${a.severity} | [#${a.number}](${a.url}) | ${age(a.created)} | ${cell(a.title)} |`)
  }
  lines.push('')
} else {
  lines.push('None.', '')
}

await mkdir('inbox', { recursive: true })
await writeFile('inbox/README.md', lines.join('\n') + '\n')
await writeFile('inbox/state.json', JSON.stringify({ scanned_at: scannedAt, repos: repos.length, dependabot, waiting, people, alerts, unreadable }, null, 2) + '\n')
console.log(`inbox: ${dependabot.length} Dependabot PRs with finished checks (${waiting} waiting), ${people.length} items by people outside the org, ${alerts.length} open alerts (${unreadable.length} repositories unreadable), ${repos.length} repositories`)
