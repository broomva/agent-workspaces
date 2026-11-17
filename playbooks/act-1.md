# Agent Workspaces: Act I playbook

This is the playbook promised by the five Agent Workspaces Act I Instagram reels: “Comment WORKSPACE and I'll send you the Act One playbook.” [Keynote repository](https://github.com/broomva/agent-workspaces).

When the chat ends, can the next agent find and check the findings? The five core steps below turn that question into files, boundaries and checks. The sixth step is the keynote's optional review-system example.

## Outcome

You finish with a repository containing:

- A canonical `AGENTS.md` routing primer and an identical `CLAUDE.md`.
- Six layers: primer, policy, skills, knowledge, record and work.
- A written sandbox/harness/wire boundary and an inventory of harness integrations.
- `bronze/`, `silver/`, `gold/` and a ledger table design naming the code that writes records.
- Optionally, a document-review skill, a deterministic quote verifier and its tests.

Local paths and workspace measurements in the keynote are dated author-workspace examples, not files shipped in this package. Create your own files below; you do not need the author's workspace, knowledge graph or configuration. The paths chosen here make the checks repeatable; they are not an additional framework.

## Preconditions

Use a repository you control and any agent CLI with file and shell tools. You need Git, a POSIX shell and ripgrep (`rg`). Skill installation is optional and uses `npx`; follow your harness's loading instructions. See [public tools and setup](../resources.md#1-start-with-files-and-a-bounded-task).

For an empty starting point, run these commands in the directory you want to use:

```sh
git init
pwd
git status --short
```

Launch your harness there. Run all checks below from that repository root. A human can perform the file edits directly; an agent can follow the quoted prompts. Stop at each check and correct failures before continuing. Commands test structure; the accompanying observables test meaning.

## 1. Give the agent a filesystem and a shell

Read files, run commands and leave cited findings. Read-only inspection should be easy; destructive actions need gates.

**Exact prompt** (thesis guide, with a concrete question added):

> Question: what files and tools are available in this repository, and what context is missing? Before answering, look. Search this repository with rg for the terms in my question, open the files that matter, and run any command that would confirm the answer. Cite each claim as path:line or as the command you ran. If something cannot be checked, say so instead of guessing. Write anything worth keeping to notes/FINDINGS.md. In an empty repository, record that observation and its confirming command rather than inventing context.

**Check:**

```sh
test -s notes/FINDINGS.md
cat notes/FINDINGS.md
```

Open one cited file or rerun one cited command. Its result must support the finding. An empty-repo finding is valid; a claim about files that do not exist is not.

Source: [`thesis` guide](../deck/index.html#scene=2), [script scene 2](../script.md), [public setup §1](../resources.md#1-start-with-files-and-a-bounded-task).

## 2. A folder is not a workspace

Decide what survives each task and which component writes it. Begin with a proposal, before creating the layout.

**Exact prompt** (workspace guide):

> Turn this repository into an agentic workspace. Propose (do not write yet) the minimum layout: an AGENTS.md primer, a policy file for hard gates, a folder for knowledge entries with front matter, a skills folder, and a docs/conversations folder for session records. For each, give its path, its one job, and what writes to it. Keep it to one screen.

**Then implement:** review the proposal and ask the agent to create the agreed skeleton. For these checks, use `.control/policy.yaml`, `research/entities/`, `skills/`, `docs/conversations/Conversations.md` and `.control/initiatives/`. Keep the product work in this repository; a separate product repository is not required. Put the path/job/writer table in `docs/workspace-layout.md`. Draft the policy's actual hard boundaries and a session-record entry. Do not claim that policy prose is enforced.

Decide whether each session leaves a log, decision or sourced note. Document the session-end capture mechanism in `docs/workspace-layout.md`: use a supported Stop hook if your host offers one, otherwise record the manual handoff needed. A hook is only active after you observe it run.

**Check:**

```sh
test -s .control/policy.yaml
test -d research/entities && test -d skills
test -d .control/initiatives
test -s docs/conversations/Conversations.md
test -s docs/workspace-layout.md
cat docs/workspace-layout.md
```

The table must name a writer for every persistent surface. End a session and inspect its new record. If capture is manual or unsupported, record that limitation explicitly.

Source: [`ws` guide](../deck/index.html#scene=5), [script scene 5](../script.md).

## 3. Six layers an agent reads before it writes

Read primer, policy and procedures before acting. Write knowledge, records and product evidence back afterward. Keep the primer a map.

**Exact prompt** (anatomy guide, adapted for files created in step 2):

> Draft AGENTS.md for this repository as a routing primer, under 300 lines. Sections: philosophy (4 rules), non-negotiable boundaries, a "when / read" table pointing at real files in this repo, and completion checks (the exact commands to run before calling work done). Link to protocols; do not inline them. Then show me the table of files it routes to and whether each exists. Use the layout in docs/workspace-layout.md. Create any missing local protocol documents before linking them; do not link to files from the keynote author's workspace. Keep AGENTS.md canonical and copy it to CLAUDE.md.

Create `docs/knowledge-index.md` as the knowledge catalog, initially empty if there are no entries. Document how it will be compiled from your own entries when you add them. Show the six layers in `docs/workspace-layout.md`; the skills layer holds on-demand procedures, not all instructions in the primer. Add these exact headings to the primer: `## Philosophy`, `## Non-negotiable boundaries`, `## When / read`, `## Completion checks`.

**Check:**

```sh
test -f AGENTS.md && cmp AGENTS.md CLAUDE.md
test "$(wc -l < AGENTS.md)" -lt 300
for heading in '## Philosophy' '## Non-negotiable boundaries' '## When / read' '## Completion checks'; do
  grep -Fx "$heading" AGENTS.md || exit 1
done
test -f docs/knowledge-index.md
```

Follow every route in the primer and confirm the target exists. Confirm your harness actually loads its primer; identical files alone do not prove loading. Read each completion command and run it before declaring work done.

Source: [`anatomy` guide](../deck/index.html#scene=6), [script scene 6](../script.md), [AGENTS.md and harness memory references](../resources.md#1-start-with-files-and-a-bounded-task).

## 4. Sandbox, harness, wire

Separate the persistent execution environment, the agent loop and the way a person reaches it. Inventory first; this step does not provision infrastructure or migrate integrations.

**Exact prompt** (harness guide):

> List every place this project integrates with a specific agent harness (config files, plugins, hooks, SDK calls). For each, say whether the same capability could live behind an MCP server or a CLI that any harness can call, and what moving it would take. Do not change anything.

**Then document:** save the reviewed inventory to `docs/runtime-boundary.md`, using headings `## Sandbox`, `## Harness`, `## Wire`, `## Integrations`. State what persists, what can be swapped and how the user reaches the agent. In a fresh local repo, explicitly mark remote sandbox and wire choices as not provisioned. For a future sandbox, record the guide's snapshot/persistent-volume requirement. Name local CLI and authenticated remote MCP surfaces where needed; do not build on undocumented harness internals. An empty integration inventory must say what you inspected.

**Check:**

```sh
for heading in '## Sandbox' '## Harness' '## Wire' '## Integrations'; do
  grep -Fx "$heading" docs/runtime-boundary.md || exit 1
done
cat docs/runtime-boundary.md
```

Compare the inventory with actual config files and hooks. Mark every integration as observed, proposed or unavailable. A written boundary is the outcome here, not proof of an isolated VM or remote connection.

Source: [`harness` guide](../deck/index.html#scene=7), [script scene 7](../script.md), [public boundary references](../resources.md#6-verify-the-harness-and-tool-boundary).

## 5. Medallion layers in the filesystem

Preserve received inputs in bronze, cited typed records in silver, and decisions/definitions in gold. Local working files and the shared system of record have separate jobs.

**Exact prompt** (medallion guide):

> Design a medallion layout for this workspace's data as folders: bronze/ (inputs as received, append-only, sha256 recorded), silver/ (typed records, each with a citation back to bronze), gold/ (decisions and definitions). Specify the ledger table that records activities, approvals and gold definitions, and which component writes each row. Output a tree and a table schema.

**Then implement the layout:** create the three folders and save the design to `docs/medallion.md`, under `## Bronze`, `## Silver`, `## Gold`, `## Ledger`. Specify bronze hashing on arrival and the silver citation fields (file, page, span). The ledger design must identify activities, approvals, gold definitions and the code component responsible for each write; the model does not write ledger rows directly. This step produces a table design, not a running database or enforced append-only storage. State what remains unimplemented.

**Check:**

```sh
for layer in bronze silver gold; do test -d "$layer" || exit 1; done
ls -d bronze silver gold
for heading in '## Bronze' '## Silver' '## Gold' '## Ledger'; do
  grep -Fx "$heading" docs/medallion.md || exit 1
done
cat docs/medallion.md
```

Trace a proposed silver value back to its bronze file/page/span. Inspect the table design and name the code writer for each row type. Do not report append-only enforcement, hashing or a ledger write as working until their implementation has been exercised.

Source: [`medallion` guide](../deck/index.html#scene=8), [script scene 8](../script.md). The guide's private workspace references are examples, not prerequisites.

## 6. Optional: worked example, a review system

Use one isolated case workspace with read-only inputs. Readers extract claims; deterministic code verifies quotes before rules use them. Untrusted document text must not reach the decider. The guide places the shared Postgres ledger outside case sandboxes.

**Exact prompt** (example guide, with explicit output paths):

> Write a review skill for documents in bronze/. For each document, launch one reader subagent with read-only tools. It returns claims as JSON: {field, value, quote, page, bbox}. Then run a deterministic verifier that checks each quote occurs verbatim in the source; unverified claims keep status "claimed". Only verified claims reach the rules. Record every step in the ledger. Show the skill file and the verifier's tests. Put the skill at skills/review/SKILL.md and document the exact verifier test command and observed results in docs/review-verification.md. Keep agent writes limited to scratch, notes and proposals. If this harness cannot provide read-only reader subagents or the external ledger is not connected, report the missing capability and stop before claiming the workflow works.

**Check:**

```sh
test -s skills/review/SKILL.md
test -s docs/review-verification.md
cat docs/review-verification.md
```

Run the exact test command the implementation records. Require cases for an exact quote, a fabricated quote and an unverified claim staying `claimed` and excluded from rules. Inspect rule inputs: no raw document text. Exercise case isolation, read-only readers and an external ledger append separately. If any prerequisite is unavailable, leave this optional step incomplete; do not substitute a passing file-existence check for a working review system.

Source: [`example` guide](../deck/index.html#scene=9), [script scene 9](../script.md). This is an architecture pattern with the domain removed, not a supplied review application.

## Common failure modes and recovery

| Failure | Recovery |
| --- | --- |
| Findings disappear into chat | Write the cited finding to `notes/FINDINGS.md`; test session capture and inspect the next session's read. |
| Primer routes to missing files | Create the needed local document or remove the route; check every target again. |
| Primers drift | Edit canonical `AGENTS.md`, run `cp AGENTS.md CLAUDE.md`, then `cmp AGENTS.md CLAUDE.md`. |
| A policy or installed skill is called enforcement | Inspect the host's actual hook/CI registrations; exercise a gate and record the result. Until then label it guidance. |
| The audit silently becomes a migration | Keep step 4 read-only until its inventory is reviewed; document the boundary before changing integrations. |
| Bronze inputs are overwritten or silver lacks citations | Preserve the received input, record its hash on arrival, and attach source locations before promoting values. |
| A model writes decisions straight to the ledger | Route writes through the named code component; verify its activity/approval/gold records. |
| Fabricated quotes reach rules | Keep failed verification as `claimed`; exclude it from rules and route toward manual review. |
| A keynote path or measurement is treated as a dependency | Replace it with your own observed path or result. This package ships neither private entities nor author configuration. |

## Skills to install selectively

These names occur in the six guides and were confirmed as `SKILL.md` packages on [broomva/skills main](https://github.com/broomva/skills) on 2026-11-17. Inspect a procedure before installing it; installation does not activate hooks, create CLIs or prove host support. No skill install is required for the file checks above.

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

- [Deck and scene guides](../deck/index.html): prompt and setup source for every step.
- [Narration](../script.md): scenes 2 and 5–9.
- [Public resources](../resources.md): tool setup, primer conventions, skill loading and harness boundaries. Follow its linked primary documentation for current installation details.
- [Reel series](../reels/series.json): five-part framing and WORKSPACE promise.

Adapted from *Agent Workspaces — The workspace is the product*, by Carlos Escobar (Broomva), © 2026 Broomva, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This adaptation adds ordered instructions, local output paths, checks and recovery guidance. Fresh-agent execution of the complete playbook is a separate validation from running these structural checks.
