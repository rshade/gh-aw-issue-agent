---
---

# Default issue coverage

Use these defaults only when the repository has no matching issue template.
They list what a complete issue covers. They are not a question script:
skip what the thread already answers, infer what the code tells you (as a
guess), and ask only about what remains.

"Required" items matter most and are asked about first. Even so, a missing
required item never blocks ready. It becomes an open gap.

## Bug coverage

| Item | Required | What it means |
| --- | --- | --- |
| Reproduce steps | yes | Exact steps that make the bug happen |
| Version | yes | Release, tag, or commit where it happens |
| Environment | no | OS, runtime, browser, config that matter |
| Expected vs actual | no | What should happen, and what happens instead |

## Feature coverage

| Item | Required | What it means |
| --- | --- | --- |
| Who needs it | yes | The user or role that hits the problem |
| The problem | yes | What they cannot do today, and why it hurts |
| Desired behavior | yes | What should happen once this exists |
| Done when | no | An observable check that proves it works |
