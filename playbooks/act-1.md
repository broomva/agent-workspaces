# Agent Workspaces: Act I playbook

This is the playbook promised by the five Agent Workspaces Act I Instagram reels: “Comment WORKSPACE and I'll send you the Act One playbook.” [Keynote repository](https://github.com/broomva/agent-workspaces).

When the chat ends, can the next agent find and check the findings? The five core steps below turn that question into files, boundaries and checks. The sixth step is the keynote's optional review-system example.

## Outcome

You finish with a repository containing:

- A canonical `AGENTS.md` routing primer and an identical `CLAUDE.md`.
- Six layers: primer, policy, skills, knowledge, record and work.
- A written sandbox/harness/wire boundary and an inventory of harness integrations.
- `bronze/`, `silver/`, `gold/` and a ledger table design naming the code that writes records.
- Optionally, a document-review skill, a deterministic quote verifier and its passing tests.

Local paths and workspace measurements in the keynote are dated author-workspace examples, not files shipped in this package. Create your own files below; you do not need the author's workspace, knowledge graph or configuration. The paths chosen here make the checks repeatable.

## Preconditions

Use a repository you control and any agent CLI with file and shell tools, such as `claude` or `codex`. You need Git, a POSIX shell and ripgrep (`rg`). Skill installation is optional and uses `npx`; follow your harness's loading instructions. See [public tools and setup](../resources.md#1-start-with-files-and-a-bounded-task).

The playbook works in an existing project repository, where steps 1 and 4 have more to find. For an empty starting point, run these commands in the directory you want to use:

```sh
git init
pwd
git status --short
```

Launch your harness there and run every check from that repository root. Each step has quoted prompts: give them to the agent in order, or do the edits yourself. Each check block prints what is missing and ends with `ok` only when everything passed. Pasting one never closes your terminal; steps 1–5 only read files, and step 6 runs the test command your agent recorded, so read that command first. Stop at a failing check and fix it before continuing. Commands test structure; the observable under each check tests meaning.

Each step names its keynote source. To read a scene's guide, clone the keynote repository, open `deck/index.html` in a browser at the scene number given (for example `deck/index.html#scene=5`) and press `G`.

## 1. Give the agent a filesystem and a shell

Read files, run commands and leave cited findings. Read-only inspection should be easy; destructive actions need gates.

**Prompt** (thesis guide, with a concrete question and an empty-repo instruction added):

> Question: what files and tools are available in this repository, and what context is missing? Before answering, look. Search this repository with rg for the terms in my question, open the files that matter, and run any command that would confirm the answer. Cite each claim as path:line or as the command you ran. If something cannot be checked, say so instead of guessing. Write anything worth keeping to notes/FINDINGS.md. In an empty repository, record that observation and its confirming command rather than inventing context.

**Check:**

```sh
(
  test -s notes/FINDINGS.md || { echo "missing: notes/FINDINGS.md"; exit 1; }
  cat notes/FINDINGS.md
) && echo "step 1: ok"
```

Open one cited file or rerun one cited command. Its result must support the finding. An empty-repo finding is valid; a claim about files that do not exist is not.

Source: `thesis` guide (deck scene 2), [script scene 2](../script.md), [public setup §1](../resources.md#1-start-with-files-and-a-bounded-task).

## 2. A folder is not a workspace

Decide what survives each task and which component writes it. Begin with a proposal, then create the layout.

**Proposal prompt** (workspace guide):

> Turn this repository into an agentic workspace. Propose (do not write yet) the minimum layout: an AGENTS.md primer, a policy file for hard gates, a folder for knowledge entries with front matter, a skills folder, and a docs/conversations folder for session records. For each, give its path, its one job, and what writes to it. Keep it to one screen.

Review the proposal, then give the implement prompt.

**Implement prompt:**

> Create the agreed layout with these exact paths: .control/policy.yaml (the hard boundaries this repository needs, as plain YAML; do not describe it as enforced), research/entities/ (knowledge entries with front matter), skills/ (on-demand procedures), docs/conversations/Conversations.md (session records, with a first entry for this session), and .control/initiatives/ (current work). Put a one-line README.md in research/entities/, skills/ and .control/initiatives/ saying what belongs there, so the folders survive a commit. Write docs/workspace-layout.md with a table of path, job and writer for every one of these, and a "Session capture" section saying how each session leaves a log, decision or sourced note: a Stop hook if this harness supports one, otherwise the manual handoff. Keep the product work in this repository.

**Check:**

```sh
(
  for f in .control/policy.yaml research/entities/README.md skills/README.md .control/initiatives/README.md docs/conversations/Conversations.md docs/workspace-layout.md; do
    test -s "$f" || { echo "missing: $f"; exit 1; }
  done
  cat docs/workspace-layout.md
) && echo "step 2: ok"
```

The table must name a writer for every persistent surface. End a session and inspect its new record. A hook counts as active only after you have seen it run; if capture is manual, the layout must say so.

Source: `ws` guide (deck scene 5), [script scene 5](../script.md).

## 3. Six layers an agent reads before it writes

Read primer, policy and procedures before acting. Write knowledge, records and product evidence back afterward. Keep the primer a map.

**Proposal prompt** (anatomy guide, adapted for the files created in step 2):

> Draft AGENTS.md for this repository as a routing primer, under 300 lines. Sections: philosophy (4 rules), non-negotiable boundaries, a "when / read" table pointing at real files in this repo, and completion checks (the exact commands to run before calling work done). Link to protocols; do not inline them. Then show me the table of files it routes to and whether each exists. Use the layout in docs/workspace-layout.md. Create any missing local protocol documents before linking them; do not link to files from the keynote author's workspace. Keep AGENTS.md canonical and copy it to CLAUDE.md.

**Implement prompt:**

> Write AGENTS.md with exactly these section headings, each on its own line: "## Philosophy", "## Non-negotiable boundaries", "## When / read", "## Completion checks". Write every route in the "When / read" table as a relative Markdown link, [label](path), to a file or folder that exists in this repository. Create docs/knowledge-index.md as the knowledge catalog (empty if there are no entries yet) and say how it will be compiled from research/entities/. Add a "Six layers" section to docs/workspace-layout.md naming primer, policy, skills, knowledge, record and work and where each lives. Keep AGENTS.md under 300 lines, then run: cp AGENTS.md CLAUDE.md

**Check:**

```sh
(
  test -f AGENTS.md || { echo "missing: AGENTS.md"; exit 1; }
  cmp AGENTS.md CLAUDE.md || { echo "CLAUDE.md differs from AGENTS.md"; exit 1; }
  awk 'END { if (NR >= 300) { print "AGENTS.md has " NR " lines; keep it under 300"; exit 1 } }' AGENTS.md || exit 1
  for h in '## Philosophy' '## Non-negotiable boundaries' '## When / read' '## Completion checks'; do
    grep -Fxq "$h" AGENTS.md || { echo "missing heading in AGENTS.md: $h"; exit 1; }
  done
  grep -o '](\([^)#]*\)' AGENTS.md | sed 's/^](//' | grep -v '://' | grep -v '^$' | grep -q . || { echo "AGENTS.md has no local route"; exit 1; }
  grep -o '](\([^)#]*\)' AGENTS.md | sed 's/^](//' | grep -v '://' | grep -v '^$' | while read -r p; do
    test -e "$p" || { echo "broken route in AGENTS.md: $p"; exit 1; }
  done || exit 1
  test -f docs/knowledge-index.md || { echo "missing: docs/knowledge-index.md"; exit 1; }
) && echo "step 3: ok"
```

Confirm your harness actually loads the primer; identical files alone do not prove loading. Run each completion command in the primer before declaring work done.

Source: `anatomy` guide (deck scene 6), [script scene 6](../script.md), [AGENTS.md and harness memory references](../resources.md#1-start-with-files-and-a-bounded-task).

## 4. Sandbox, harness, wire

Separate the persistent execution environment, the agent loop and the way a person reaches it. Inventory first; this step does not provision infrastructure or migrate integrations.

**Proposal prompt** (harness guide):

> List every place this project integrates with a specific agent harness (config files, plugins, hooks, SDK calls). For each, say whether the same capability could live behind an MCP server or a CLI that any harness can call, and what moving it would take. Do not change anything.

Review the inventory, then give the implement prompt.

**Implement prompt:**

> Save the reviewed inventory to docs/runtime-boundary.md with exactly these headings, each on its own line: "## Sandbox", "## Harness", "## Wire", "## Integrations". Under them, state what persists, what can be swapped and how a person reaches the agent. Mark any remote sandbox or wire that is not set up as "not provisioned", and record that a future sandbox needs a snapshot or persistent volume. Under "## Integrations", mark each item observed, proposed or unavailable, and if there are none, list what you inspected. Change nothing else.

**Check:**

```sh
(
  test -s docs/runtime-boundary.md || { echo "missing: docs/runtime-boundary.md"; exit 1; }
  for h in '## Sandbox' '## Harness' '## Wire' '## Integrations'; do
    grep -Fxq "$h" docs/runtime-boundary.md || { echo "missing heading in docs/runtime-boundary.md: $h"; exit 1; }
  done
  cat docs/runtime-boundary.md
) && echo "step 4: ok"
```

Compare the inventory with the actual config files and hooks. A written boundary is the outcome here, not proof of an isolated VM or a remote connection.

Source: `harness` guide (deck scene 7), [script scene 7](../script.md), [public boundary references](../resources.md#6-verify-the-harness-and-tool-boundary).

## 5. Medallion layers in the filesystem

Preserve received inputs in bronze, cited typed records in silver, and decisions and definitions in gold. Local working files and the shared system of record have separate jobs.

**Proposal prompt** (medallion guide):

> Design a medallion layout for this workspace's data as folders: bronze/ (inputs as received, append-only, sha256 recorded), silver/ (typed records, each with a citation back to bronze), gold/ (decisions and definitions). Specify the ledger table that records activities, approvals and gold definitions, and which component writes each row. Output a tree and a table schema.

Review the design, then give the implement prompt.

**Implement prompt:**

> Create bronze/, silver/ and gold/, each with a one-line README.md stating its rule (bronze: inputs as received, sha256 recorded on arrival; silver: typed records citing file, page and span in bronze; gold: accepted decisions and definitions). Save the design to docs/medallion.md with exactly these headings, each on its own line: "## Bronze", "## Silver", "## Gold", "## Ledger". Under "## Ledger", give the table schema for activities, approvals and gold definitions and name the code component that writes each row; the model never writes ledger rows directly. So the trace can be checked even in an empty repository, add one small sample input to bronze/ with its sha256 recorded, and one silver record that cites it by file, page and span. End with what is designed but not yet implemented.

**Check:**

```sh
(
  for f in bronze/README.md silver/README.md gold/README.md docs/medallion.md; do
    test -s "$f" || { echo "missing: $f"; exit 1; }
  done
  for d in bronze silver; do
    ls "$d" | grep -v '^README.md$' | grep -q . || { echo "no sample file in $d/ besides README.md"; exit 1; }
  done
  for h in '## Bronze' '## Silver' '## Gold' '## Ledger'; do
    grep -Fxq "$h" docs/medallion.md || { echo "missing heading in docs/medallion.md: $h"; exit 1; }
  done
  cat docs/medallion.md
) && echo "step 5: ok"
```

Trace the sample silver record back to its bronze file, page and span, and check the recorded sha256 against the file. Name the code writer for each ledger row type. Do not report append-only storage, hashing or a ledger write as working until you have exercised it.

Source: `medallion` guide (deck scene 8), [script scene 8](../script.md). The guide's private workspace references are examples, not prerequisites.

## 6. Optional: worked example, a review system

Use one isolated case workspace with read-only inputs. Readers extract claims; deterministic code verifies quotes before rules use them. Untrusted document text must not reach the decider. The guide places the shared Postgres ledger outside case sandboxes.

The quote verifier and its tests need neither subagents nor a ledger, so build and run them here. The read-only readers, case isolation and the external ledger depend on your harness and infrastructure: record which you have, and mark the rest "not provisioned" instead of claiming them.

**Prompt** (example guide, with output paths added):

> Write a review skill for documents in bronze/. For each document, launch one reader subagent with read-only tools. It returns claims as JSON: {field, value, quote, page, bbox}. Then run a deterministic verifier that checks each quote occurs verbatim in the source; unverified claims keep status "claimed". Only verified claims reach the rules. Record every step in the ledger. Show the skill file and the verifier's tests. Put the skill at skills/review/SKILL.md. Implement the verifier and tests in this repository, with cases for an exact quote, a fabricated quote, and an unverified claim that stays "claimed" and never reaches the rules. Run the tests. Write docs/review-verification.md with one line beginning "TEST: " followed by the exact command that runs them, and the observed result. In the same file, mark read-only readers, case isolation and the external ledger each as working (with how you exercised it) or "not provisioned".

**Check.** This block runs the command on the `TEST: ` line your agent wrote in `docs/review-verification.md`. Read that line before you paste it; it prints the command before running it.

```sh
(
  for f in skills/review/SKILL.md docs/review-verification.md; do
    test -s "$f" || { echo "missing: $f"; exit 1; }
  done
  grep -q '^TEST: *[^[:space:]]' docs/review-verification.md || { echo "no TEST: line with a command in docs/review-verification.md"; exit 1; }
  grep -m1 '^TEST: ' docs/review-verification.md | sed 's/^TEST: /running: /'
  grep -m1 '^TEST: ' docs/review-verification.md | sed 's/^TEST: //' | sh || { echo "the recorded verifier tests failed"; exit 1; }
) && echo "step 6: ok"
```

Read the tests: the fabricated quote must stay `claimed` and be excluded from rule inputs, and no rule input may contain raw document text. A passing verifier does not prove isolation, read-only readers or a ledger append; exercise each one before calling it working.

Source: `example` guide (deck scene 9), [script scene 9](../script.md). This is an architecture pattern with the domain removed, not a supplied review application.

## Common failure modes and recovery

| Failure | Recovery |
| --- | --- |
| Findings disappear into chat | Write the cited finding to `notes/FINDINGS.md`; test session capture and inspect the next session's read. |
| A check fails although the agent "did the step" | Give the step's implement prompt; the proposal prompt alone only proposes. |
| A folder is missing after a clone | Git does not track empty folders. Add the folder's one-line `README.md` and commit it. |
| Primer routes to missing files | Create the needed local document or remove the route; rerun the step 3 check. |
| Primers drift | Edit canonical `AGENTS.md`, run `cp AGENTS.md CLAUDE.md`, then `cmp AGENTS.md CLAUDE.md`. |
| A policy or installed skill is called enforcement | Inspect the host's actual hook and CI registrations; exercise a gate and record the result. Until then, call it guidance. |
| The audit silently becomes a migration | Keep step 4 read-only until its inventory is reviewed; document the boundary before changing integrations. |
| Bronze inputs are overwritten or silver lacks citations | Preserve the received input, record its hash on arrival, and attach source locations before promoting values. |
| A model writes decisions straight to the ledger | Route writes through the named code component; verify its activity, approval and gold records. |
| Fabricated quotes reach rules | Keep failed verification as `claimed`; exclude it from rules and route it toward manual review. |
| A keynote path or measurement is treated as a dependency | Replace it with your own observed path or result. This package ships neither private entities nor author configuration. |

## Skills to install selectively

These names occur in the six guides and were confirmed as `SKILL.md` packages on [broomva/skills main](https://github.com/broomva/skills) on 2026-11-17. Inspect a procedure before installing it; installation does not activate hooks, create CLIs or prove host support. No skill install is required for the checks above. `kg` and `role-x` expect the author's workspace layout (`docs/knowledge-index.md` and `roles/_index.md`); in a fresh repository, read them as reference.

```sh
npx skills add broomva/skills --skill checkit
npx skills add broomva/skills --skill dogfood
npx skills add broomva/skills --skill handoff
npx skills add broomva/skills --skill role-x
npx skills add broomva/skills --skill kg
npx skills add broomva/skills --skill harness-engineering-playbook
npx skills add broomva/skills --skill cross-review
npx skills add broomva/skills --skill skillify
```

| Steps | Public procedure source |
| --- | --- |
| 1, 5 | [checkit](https://github.com/broomva/skills/blob/main/skills/research/checkit/SKILL.md) |
| 1, 2 | [dogfood](https://github.com/broomva/skills/blob/main/skills/governance/dogfood/SKILL.md) |
| 2 | [handoff](https://github.com/broomva/skills/blob/main/skills/orchestration/handoff/SKILL.md) |
| 3 | [role-x](https://github.com/broomva/skills/blob/main/skills/orchestration/role-x/SKILL.md), [kg](https://github.com/broomva/skills/blob/main/skills/knowledge/kg/SKILL.md) |
| 4 | [harness-engineering-playbook](https://github.com/broomva/skills/blob/main/skills/governance/harness-engineering-playbook/SKILL.md) |
| 5, 6 | [cross-review](https://github.com/broomva/skills/blob/main/skills/governance/cross-review/SKILL.md) |
| 6 | [skillify](https://github.com/broomva/skills/blob/main/skills/tooling/skillify/SKILL.md) |

## References and scope

- Deck and scene guides: `deck/index.html` in this repository (open it locally and press `G`); the prompt and setup source for every step.
- [Narration](../script.md): scenes 2 and 5–9.
- [Public resources](../resources.md): tool setup, primer conventions, skill loading and harness boundaries. Follow its linked primary documentation for current installation details.
- [Reel series](../reels/series.json): the five-part framing and the WORKSPACE promise.

A fresh agent followed an earlier draft of this playbook end to end in an empty repository on 2026-11-17. The fixes from that run and from an independent review are included here.

Adapted from *Agent Workspaces — The workspace is the product*, by Carlos Escobar (Broomva), © 2026 Broomva, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This adaptation adds ordered instructions, implement prompts, local output paths, checks and recovery guidance.
