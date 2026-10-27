'use strict';

const DEFAULTS = Object.freeze({
  trigger: 'all',
  triggerLabel: 'needs-brainstorm',
  roundCap: 3,
  specFormat: 'auto',
  labels: Object.freeze({
    bug: 'bug',
    feature: 'feature',
    ready: 'spec-ready',
    stop: 'no-bot',
    done: 'spec-drafted',
  }),
});

function freshDefaults() {
  return { ...DEFAULTS, labels: { ...DEFAULTS.labels } };
}

function unquote(value) {
  const m = /^(["'])(.*)\1$/.exec(value);
  return m ? m[2] : value;
}

const LABEL_KEYS = {
  'label-bug': 'bug',
  'label-feature': 'feature',
  'label-ready': 'ready',
  'label-stop': 'stop',
  'label-done': 'done',
};

function parseConfig(text) {
  const config = freshDefaults();
  const warnings = [];
  if (typeof text !== 'string') return { config, warnings };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) {
      warnings.push(`ignored line without ':': ${line}`);
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = unquote(line.slice(idx + 1).trim());

    if (key === 'trigger') {
      if (value === 'all' || value === 'label') config.trigger = value;
      else warnings.push(`invalid trigger '${value}', using '${DEFAULTS.trigger}'`);
    } else if (key === 'trigger-label') {
      if (value) config.triggerLabel = value;
      else warnings.push(`empty trigger-label, using '${DEFAULTS.triggerLabel}'`);
    } else if (key === 'round-cap') {
      const n = Number(value);
      if (/^\d+$/.test(value) && n >= 1 && n <= 10) config.roundCap = n;
      else warnings.push(`invalid round-cap '${value}', using ${DEFAULTS.roundCap}`);
    } else if (key === 'spec-format') {
      if (['auto', 'spec-kit', 'openspec'].includes(value)) config.specFormat = value;
      else warnings.push(`invalid spec-format '${value}', using '${DEFAULTS.specFormat}'`);
    } else if (Object.hasOwn(LABEL_KEYS, key)) {
      const name = LABEL_KEYS[key];
      if (value) config.labels[name] = value;
      else warnings.push(`empty ${key}, using '${DEFAULTS.labels[name]}'`);
    } else {
      warnings.push(`unknown key '${key}'`);
    }
  }
  return { config, warnings };
}

const BOT_MARKER = /gh-aw-workflow-id:\s*issue-bot(-spec)?(?![\w-])/;
const ROUND_MARKER = /gh-aw-workflow-id:\s*issue-bot(?![\w-])/;

const NOISE = new Set([
  '+1', '👍', 'bump', 'anyupdate', 'anyupdates', 'metoo', 'same', 'samehere',
  'following', 'subscribe', 'thanks', 'thankyou', 'ty', ':+1:', 'thx',
]);
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const skip = (reason) => ({ go: false, mode: null, reason });
const go = (mode, reason) => ({ go: true, mode, reason });

function isNoise(body) {
  const normalized = body.toLowerCase().replace(/[\s.,!?]/g, '');
  return normalized === '' || NOISE.has(normalized);
}

function decide(event, config, rounds) {
  const labels = event.issueLabels;
  if (event.isPullRequest) return skip('pull-request');
  if (labels.includes(config.labels.done)) return skip('spec-drafted');
  if (labels.includes(config.labels.stop)) return skip('stopped');

  if (event.name === 'issues') {
    let start = null;
    if (event.action === 'opened' && config.trigger === 'all') start = 'opened';
    if (event.action === 'labeled' && event.labelAdded === config.triggerLabel && rounds === 0) {
      start = 'label-trigger';
    }
    if (!start) return skip('issue-event');
    if (event.issueAuthorType === 'Bot') return skip('bot-author');
    return go('first', start);
  }

  const { comment } = event;
  if (comment.authorType === 'Bot' || BOT_MARKER.test(comment.body)) return skip('own-comment');

  const firstWord = comment.body.trim().split(/\s+/)[0];
  if (firstWord === '/spec') return skip('spec-command');
  if (firstWord === '/stop') {
    const isFiler = comment.author.toLowerCase() === event.issueAuthor.toLowerCase();
    return isFiler || MAINTAINER_ASSOCIATIONS.has(comment.association)
      ? go('stop', 'stop')
      : skip('stop-not-allowed');
  }

  if (isNoise(comment.body)) return skip('noise');
  if (rounds === 0) return skip('not-engaged');
  if (rounds >= config.roundCap) return skip('round-cap');
  if (labels.includes(config.labels.ready)) return go('post-ready', 'post-ready');
  return go('round', 'round');
}

function eventFromPayload(eventName, payload) {
  const issue = payload.issue ?? {};
  const isComment = eventName === 'issue_comment';
  const c = payload.comment ?? {};
  return {
    name: eventName,
    action: payload.action ?? '',
    isPullRequest: Boolean(issue.pull_request),
    issueAuthor: issue.user?.login ?? '',
    issueAuthorType: issue.user?.type ?? '',
    issueLabels: (issue.labels ?? []).map((l) => l.name),
    labelAdded: eventName === 'issues' ? (payload.label?.name ?? null) : null,
    comment: isComment
      ? {
          body: c.body ?? '',
          author: c.user?.login ?? '',
          authorType: c.user?.type ?? '',
          association: c.author_association ?? '',
        }
      : null,
  };
}

/**
 * @param {{ body?: string, user?: { type?: string } | null, author_association?: string }[]} comments
 *   raw REST API comment objects
 */
function countRounds(comments) {
  return comments.filter((c) =>
    ROUND_MARKER.test(c.body ?? '') &&
    (c.user?.type === 'Bot' || MAINTAINER_ASSOCIATIONS.has(c.author_association))).length;
}

function formatOutputs(decision, config, rounds) {
  const outputs = {
    go: decision.go,
    mode: decision.mode ?? '',
    reason: decision.reason,
    round: rounds + 1,
    round_cap: config.roundCap,
    final_round: rounds + 1 >= config.roundCap,
    label_bug: config.labels.bug,
    label_feature: config.labels.feature,
    label_ready: config.labels.ready,
    label_stop: config.labels.stop,
    label_done: config.labels.done,
  };
  return Object.entries(outputs)
    .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, '')}\n`)
    .join('');
}

/**
 * @param {string[]} [currentLabels] the issue's labels fetched at run time;
 *   when given they replace the payload's labels, which may be stale
 */
function run({ eventName, payload, configText, comments, currentLabels }) {
  const { config } = parseConfig(configText);
  const event = eventFromPayload(eventName, payload);
  if (Array.isArray(currentLabels)) event.issueLabels = currentLabels;
  const rounds = countRounds(comments);
  return formatOutputs(decide(event, config, rounds), config, rounds);
}

const API = 'https://api.github.com';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'issue-bot-prefilter',
  };
}

async function fetchConfigText(repo, token) {
  const res = await fetch(`${API}/repos/${repo}/contents/.github/issue-bot.yml`, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`config fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  return Buffer.from(body.content ?? '', 'base64').toString('utf8');
}

async function fetchCurrentLabels(repo, number, token) {
  const res = await fetch(`${API}/repos/${repo}/issues/${number}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`issue fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  return (body.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

async function fetchComments(repo, number, token) {
  const comments = [];
  let url = `${API}/repos/${repo}/issues/${number}/comments?per_page=100`;
  while (url) {
    const res = await fetch(url, { headers: headers(token) });
    if (!res.ok) throw new Error(`comments fetch failed: HTTP ${res.status}`);
    comments.push(...(await res.json()));
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
    url = next ? next[1] : null;
  }
  return comments;
}

async function main() {
  const fs = require('node:fs');
  const outputPath = process.env.GITHUB_OUTPUT;
  try {
    const eventName = process.env.GITHUB_EVENT_NAME;
    const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GITHUB_TOKEN;

    const configText = await fetchConfigText(repo, token);
    const comments = await fetchComments(repo, payload.issue.number, token);
    const currentLabels = await fetchCurrentLabels(repo, payload.issue.number, token);

    const { warnings } = parseConfig(configText);
    for (const w of warnings) console.log(`issue-bot prefilter warning: ${w}`);

    const out = run({ eventName, payload, configText, comments, currentLabels });
    const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(out)[1];
    console.log(`issue-bot prefilter: go=${get('go')} mode=${get('mode')} reason=${get('reason')} rounds=${countRounds(comments)}`);
    fs.appendFileSync(outputPath, out);
  } catch (err) {
    console.log(`issue-bot prefilter error: ${err.message}`);
    fs.appendFileSync(outputPath, 'go=false\nreason=prefilter-error\n');
  }
}

if (require.main === module) main();

module.exports = {
  parseConfig, DEFAULTS, decide, BOT_MARKER, ROUND_MARKER,
  eventFromPayload, countRounds, formatOutputs, run,
};
