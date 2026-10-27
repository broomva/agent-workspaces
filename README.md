# Agent Workspaces

**The workspace is the product.** An offline, animated keynote with 37 scenes, speaker notes, a reading guide, presenter view and deterministic frame capture. Version 1.0.0; implementation tracking: BRO-3533.

## Run and check

Open `deck/index.html` directly in a modern Chromium browser or Safari. All fonts are local; viewing needs no install, private workspace, account or network. Use the arrow keys to advance, `G` for the guide, `N` for notes, `L` for the ledger, `P` for presenter view, `T` for day mode, `O` for tone and `M` for still mode. Presenter synchronization uses BroadcastChannel; if your browser isolates local files, serve this directory with a local HTTP server. See [script.md](script.md) for the talk track.

For development and export, install Bun 1.3.14, then:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run check
bun run smoke
```

Playwright is pinned to **1.62.0**. Linux may also require `bunx playwright install-deps chromium`. Browser smoke covers all scenes/beats, reduced motion, capture purity, navigation, presenter synchronization, guide layout and rendering fallbacks. Performance results depend on the host. `check` is static and standalone: it never reads private workspace files, installed skills or a knowledge graph. Publication reviewers can supply private scan terms via the comma-separated `PUBLICATION_DENYLIST` environment variable; the repository stores no private denylist. General secret/path scanning always runs. Biome checks the package tooling; the inherited renderer is intentionally kept in its original style.

## Build an immutable release

Commit the source first, then run:

```sh
bun run build
bun run verify:dist
bun run bundle
```

The build uses the package's Playwright dependency and exports both PDFs serially from the final local deck. No cached PDF inputs are used. `PLAYWRIGHT_DIR` is an optional local override for a compatible Playwright installation; it is unnecessary for normal use. The build produces only:

```text
dist/
  deck/index.html
  deck/fonts/                 # fonts, full OFL texts, notices
  deck/preview.webp          # scene 1, final beat, midnight
  script.md
  resources.md
  downloads/agent-workspaces-slides.pdf
  downloads/agent-workspaces-guide.pdf
  release.json
```

`release.json` has `version`, `sourceCommit`, `upstreamCommit`, `generatedAt` and `files` (relative path → SHA-256 string). It excludes itself from the checksum map. `sourceCommit` identifies this standalone source; `upstreamCommit` identifies the original deck. The bundle and its `.sha256` receipt are ignored, outside `dist/`; the archive contains the **contents** of `dist/` at its root. Source git excludes PDFs, generated assets and dependencies. Export is reproducible from committed source and the lockfile; PDF bytes and timestamps can vary with Chromium, platform and generation time.

For website integration, vendor the exact verified output under `public/agent-workspaces/v1.0.0/`. Validate every manifest checksum before copying, preserve the manifest, and link that immutable version from the site's current landing route. Do not regenerate PDFs in the website build. Publish a new version directory for subsequent releases; a source SHA and archive checksum should accompany each release. Website integration, GitHub publication, release creation and deployment are owned by the parent project and are not performed by this package.

## Source provenance and scope

The deck, fonts, smoke tests and script were extracted from the original workspace's `docs/keynote/agent-workspaces/` at **ce6f879f1045fae540e5b31ad4f5252737a83801**, rather than from its dirty working tree. The PDF exporter was extracted from that path at **1e2445ac1c7867f10c81827fd07b12399aecbfe4**. These identify the owner's original workspace history; that private repository is not a prerequisite or a promised public download.

The renderer, canvas scenes, guide, presenter, hash navigation and blue midnight theme are preserved. Surgical fixes address accessibility fallback specificity, inactive-chip dimming under reduced motion, unnecessary breaker settling, and narrative qualifications. Purple rim accents are changed to blue. No arcan-glass stylesheet is used.

Paths such as `research/entities/`, `.claude/settings.json`, `docs/knowledge-index.md` and `skills/…` inside the talk are **author-workspace examples**, not files included here. Measurements are dated observations supplied with the source deck, not universal benchmarks or independently reproduced claims. Only the curated graph slugs/edges already embedded in the deck ship; no entity bodies, private research files, AGENTS primer, CRM or client files are included. [resources.md](resources.md) maps the techniques to public tools and setup.

## Licensing

Copyright 2026 Broomva. Authored renderer and tooling (`deck/index.html` CSS/JavaScript, `deck/*.mjs`, `scripts/`, package configuration) are licensed under **Apache-2.0**, see [LICENSE-CODE](LICENSE-CODE). Authored talk text, slide prose, notes, guide prose, `script.md`, `resources.md` and documentation are licensed under **CC BY 4.0**, see [LICENSE-CONTENT](LICENSE-CONTENT). Attribute “Agent Workspaces — The workspace is the product, Broomva” and identify modifications. Exported slides/guide carry the talk's CC BY 4.0 content license. These are the owner's documented publication defaults; no applicable first-party license was found at the original deck path.

Vendored fonts retain their separate SIL OFL 1.1 licenses. Third-party names, linked material and dependencies retain their owners' rights; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). License texts remain in the source package; the full code license is also embedded in an HTML comment in the distributed deck, and font notices accompany the distributed fonts. The release's `resources.md` carries content attribution and links to the code license.
