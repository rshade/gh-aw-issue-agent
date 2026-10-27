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
  'following', 'subscribe',
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
    if (event.action === 'opened' && config.trigger === 'all') return go('first', 'opened');
    if (event.action === 'labeled' && config.trigger === 'label' &&
        event.labelAdded === config.triggerLabel && rounds === 0) {
      return go('first', 'label-trigger');
    }
    return skip('issue-event');
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
  if (!labels.includes(config.labels.bug) && !labels.includes(config.labels.feature)) {
    return skip('not-engaged');
  }
  if (rounds >= config.roundCap) return skip('round-cap');
  if (labels.includes(config.labels.ready)) return go('post-ready', 'post-ready');
  return go('round', 'round');
}

module.exports = { parseConfig, DEFAULTS, decide, BOT_MARKER, ROUND_MARKER };
