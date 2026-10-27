---
---

# Spec formats

These are the three artifacts `/spec` can produce. Spec Kit and OpenSpec
are for features. The bug report is for bugs. Write only what the format
describes: no plan, no tasks, no code.

Everything you write comes from the thread and the code. Where the thread
does not say, write the gap down. Never invent an answer to fill a section.

## Spec Kit

### Spec Kit path

Write one file: `specs/NNN-<slug>/spec.md`.

- `NNN` is one more than the highest three-digit prefix among the
  directories in `specs/`, zero-padded to 3 digits. If `specs/` does not
  exist or has no numbered directories, use `001`. For example, with
  `specs/001-login/` and `specs/007-csv-export/`, the next is `008`.
- `<slug>` is 2 to 4 lowercase kebab-case words that name the feature,
  such as `csv-export` or `retry-failed-uploads`.

### Spec Kit content

If `.specify/templates/spec-template.md` exists, read it and follow it:
its headings, its order, and its placeholders filled in. Remove template
comments and example text you did not use.

Otherwise use this shape:

```markdown
# Feature Specification: <feature name>

**Feature Branch**: `NNN-<slug>`
**Created**: YYYY-MM-DD
**Status**: Draft
**Input**: Issue #N

## User Scenarios & Testing

### User Story 1 - <title> (Priority: P1)

<The journey in plain words.>

**Why this priority**: <value to the user>

**Independent Test**: <how to check this story alone>

**Acceptance Scenarios**:

1. **Given** <state>, **When** <action>, **Then** <outcome>

### Edge Cases

- <boundary or error case>

## Requirements

### Functional Requirements

- **FR-001**: System MUST <capability>.

## Success Criteria

### Measurable Outcomes

- **SC-001**: <measurable, technology-free outcome>

## Assumptions

- <what you assumed, including unconfirmed guesses from the thread>
```

Rules:

- Write each open gap inline, where it matters, as
  `[NEEDS CLARIFICATION: <what is unknown>]`.
- Put inferences nobody confirmed under Assumptions, not in requirements.
- No implementation detail: no file names, functions, libraries, APIs, or
  schemas. Describe what users need and why, not how to build it.

## OpenSpec

### Read the repository's rules first

Read whichever of these exist, and follow them over the defaults below:

- `openspec/AGENTS.md`
- `openspec/project.md`
- `openspec/config.yaml`
- one or two existing changes under `openspec/changes/`, to copy their
  shape
- the current specs under `openspec/specs/`, to find the capability this
  feature belongs to

### OpenSpec path

Write a change under `openspec/changes/<change-id>/`:

- `proposal.md`
- `specs/<capability>/spec.md`, one per capability the feature touches

The `<change-id>` is kebab-case and starts with a verb, such as
`add-csv-export` or `update-retry-policy`. It must not already exist under
`openspec/changes/` or `openspec/changes/archive/`. Use an existing
capability name when one fits; otherwise choose a short kebab-case noun.

Write `tasks.md` only if the repository's own instructions require every
change to have one. Otherwise do not write it.

### `proposal.md`

```markdown
## Why

<The problem and who has it, in 1-3 sentences.>

## What Changes

- <Each behavior change, as a bullet.>

## Impact

- Affected specs: <capabilities>
- Affected code: <likely areas, stated as guesses>
- Open gaps: <unknowns, or "none">
```

The proposal is the one place where approach may appear. State any
direction from the code as a guess.

### `specs/<capability>/spec.md`

```markdown
## ADDED Requirements

### Requirement: <name>

The system SHALL <behavior>.

#### Scenario: <name>

- **WHEN** <condition>
- **THEN** <outcome>
```

- Every requirement uses SHALL and has at least one `#### Scenario:`.
- Use `## ADDED Requirements` for new behavior. If the feature changes a
  requirement that already exists in `openspec/specs/`, use
  `## MODIFIED Requirements` and repeat the whole updated requirement, as
  OpenSpec expects.

## Bug report

A bug report replaces the issue body. It uses these sections, in order:

```markdown
## Reproduce

1. <Exact step.>

- Version: <release, tag, or commit, or "unknown">
- Environment: <what matters, or "unknown">

## Expected vs actual

- Expected: <what should happen>
- Actual: <what happens>

## Likely location

- `path/to/file.ext:123` <why this is a candidate> _(guess)_

## Done when

- <The regression test that would prove the fix: input, action, and the
  assertion that fails today and passes after the fix.>

## Open gaps

- Unknown: <what is missing and why>

<details>
<summary>Original report</summary>

<the original issue body, verbatim>

</details>
```

- Likely location lists `file:line` candidates you found by reading the
  code. Mark each one _(guess)_.
- Leave out "Open gaps" only when nothing is unknown.
- The Original report is copied exactly, character for character. Do not
  fix its spelling, reformat it, or summarize it.
- If the original report is over 20000 characters, keep the first 20000
  characters and end the section, just before `</details>`, with this
  line:

  ```markdown
  _Truncated at 20000 characters. The full text is in this issue's edit history._
  ```
