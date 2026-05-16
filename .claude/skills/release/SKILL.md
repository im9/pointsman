---
name: release
description: Cut a versioned per-target release of Pointsman (m4l or vst). Bumps the source-of-truth version (vst/CMakeLists.txt project(...) for vst, m4l/package.json for m4l), verifies repo state (clean / synced / CI green / artifact freshness), drafts release notes from the per-target commit log, and runs the tag → push → gh release create flow with explicit user approval at each step.
argument-hint: "<m4l|vst> [major|minor|patch]"
allowed-tools: Read, Write, Edit, Bash(git *), Bash(gh *), Bash(stat *), Bash(ls *), Bash(rm /tmp/pointsman-*)
---

# Release Pointsman

Cut a versioned per-target release. The first $ARGUMENT selects the
target (`m4l` or `vst`); the second is the bump (`major` / `minor` /
`patch`, default `patch`).

Targets ship to different repos, so the tag layout differs:

- **m4l** → tag `vX.Y.Z` on **[im9/pointsman-m4l](https://github.com/im9/pointsman-m4l)**
  (binary-only distribution repo; continues from the existing `v1.0.0`).
  Asset: `dist/Pointsman.amxd` — frozen `.amxd`, manual freeze in Max
  required.
- **vst** → tag `vst-vX.Y.Z` on the source repo `im9/pointsman`.
  Distribution channel undecided
  ([ADR 003 §Out of scope](../../../docs/ai/adr/003-pointsman-vst-architecture.md)).
  Per the project's free/paid split (m4l free, vst/clap/au under paid
  consideration), vst releases are **tag-only** for now — no binary
  asset attached to GH Releases. **HALT and ask the user before
  publishing any vst binary** as a free GH Releases download.

## Pre-flight checks (do these BEFORE creating the tag)

Tags are durable. Once pushed, a release with downloads is harder to
undo cleanly. Run all checks; STOP and ask the user if any fail.

### Check 1 — Working tree is clean

`git status --porcelain` must be empty. Uncommitted changes leak into
the release context if you tag now. Halt if dirty.

### Check 2 — main is synced with origin

```bash
git fetch origin --quiet
git rev-list --count main..origin/main   # must be 0 (origin not ahead)
git rev-list --count origin/main..main   # must be 0 (local not ahead)
```

If origin is ahead, `git pull`. If local is ahead, push first (via
`/commit` for any unstaged work, then a normal push). Then re-run.

### Check 3 — CI is green on HEAD

```bash
gh run list --branch main --limit 5 --json conclusion,headSha,workflowName
```

The most recent completed run for the current HEAD SHA must have
`conclusion: "success"`. If still in progress or failed, halt and ask.

### Check 4 — Artifact exists and reflects current target source

The artifact is gitignored, so it lives only on the build machine.
Verify per target.

#### m4l target

```bash
ls -la dist/Pointsman.amxd
stat -f '%m' dist/Pointsman.amxd                # mtime as epoch
git log -1 --format=%ct -- m4l/Pointsman.maxpat \
                            m4l/pointsman.mjs \
                            m4l/pointsman.entry.mjs \
                            m4l/scaleKeyboard.jsui.js \
                            m4l/engine m4l/host        # latest m4l-source commit time
```

`dist/Pointsman.amxd` mtime must be **>=** the latest m4l-source commit
time. If older, halt and remind:

> Open `m4l/Pointsman.amxd` in Max → click the snowflake (Freeze)
> button in the patcher toolbar → *File → Save As*
> `dist/Pointsman.amxd`.

Even when the mtime check passes, **manual smoke test in a fresh Live
track is recommended before tagging** — drag `dist/Pointsman.amxd`
onto a new MIDI track, confirm it loads, scale-snap works, chord /
harmony modes respond, MIDI flows through. CI does not (and cannot)
cover this.

#### vst target

No binary asset to publish. Confirm the source-only release is
intentional (distribution channel still TBD per ADR 003 §Out of scope).
Run a local build sanity check:

```bash
(cd vst && make build && make test)
```

Also verify `vst/CMakeLists.txt`'s `project(Pointsman VERSION X.Y.Z)`
matches the version about to be tagged — the plist version the plugin
reports to the host and the `v…` label drawn in the editor header are
both sourced from this line via `POINTSMAN_VERSION_STRING`. If it
doesn't match, bump first via Step 0 below.

Manual host smoke (Logic AU MIDI FX + Bitwig VST3 MIDI fx + Bitwig CLAP)
is recommended before tagging — see ADR 003's host-load matrix.

## Drafting

After pre-flight passes:

### Step 0 — Bump the source-of-truth version

The displayed version in the editor header (`v0.1.x` right of the
title) is fed from `project(Pointsman VERSION ...)` in
`vst/CMakeLists.txt` via `POINTSMAN_VERSION_STRING`. The tag and the
in-binary version **must move together** — otherwise the loaded plugin
claims one version while the GH release announces another.

```bash
# Determine next version (logic in Step 1 below) and edit BEFORE tagging:
#   vst target → vst/CMakeLists.txt   line 2: project(Pointsman VERSION x.y.z)
#   m4l target → m4l/package.json     "version": "x.y.z"
#                m4l/engine/package.json + m4l/host/package.json if you
#                version them in lockstep
```

Commit this bump as `chore(<target>): vX.Y.Z` BEFORE creating the tag,
so the tag points at a commit whose source already reports the new
version. Then re-run pre-flight Check 4 (artifact mtime must now
post-date the bump commit — for m4l, this means re-baking the
`.amxd`).

**Confirm with the user before committing the bump** — same gate as
any other commit.

### Step 1 — Determine next version

For **m4l**, query `pointsman-m4l`:

```bash
gh release list --repo im9/pointsman-m4l --limit 1 --json tagName \
  --jq '.[0].tagName'
```

The existing line starts at `v1.0.0`. Bump per the second $ARGUMENT
(default `patch`).

For **vst**, query the source repo:

```bash
git tag -l 'vst-v*' | sort -V | tail -1
```

If no prior `vst-v*` tag, propose `vst-v0.1.0`.

Show the proposed version to the user and **confirm before proceeding
to Step 0**. The user can override.

### Step 2 — Draft release notes

Generate the draft from the commit log between the previous per-target
reference and HEAD.

For **m4l**, use the previous m4l release date as the lower bound
(tags live on `pointsman-m4l`, not here, so we cannot `git log
<prev-tag>..HEAD` directly):

```bash
PREV_DATE=$(gh release view --repo im9/pointsman-m4l --json publishedAt \
  --jq '.publishedAt')
git log --since="$PREV_DATE" --pretty=format:'- %s' -- m4l/ docs/ai/
```

For **vst**, use the previous `vst-v*` tag:

```bash
PREV=$(git tag -l 'vst-v*' | sort -V | tail -1)
git log "${PREV:-}"..HEAD --pretty=format:'- %s' -- vst/ docs/ai/
```

If `$PREV` is empty (first vst release), scope to vst-touching commits
since the repo started:

```bash
git log --pretty=format:'- %s' -- vst/ docs/ai/adr/
```

Categorize commits by their `type(scope):` prefix into sections:

- **Features** — `feat:`
- **Fixes** — `fix:`
- **Docs / housekeeping** — `docs:` / `chore:` / `style:` / `refactor:`
- **CI / build** — `ci:`

Drop the `Co-Authored-By` lines and trailing housekeeping noise. Keep
the section short — release notes are for users, not contributors;
detailed history is in `git log`.

For the very first vst release (no prior `vst-v*` tag), use a
project-intro template instead of a changelog: "What it does" /
"Install" / "Requirements". For m4l, the `v1.0.0` release notes on
`pointsman-m4l` already serve that purpose — subsequent m4l releases
are changelog-style.

Write the draft to `/tmp/pointsman-<tag>-notes.md` and show it to the
user. **Wait for explicit "ok" or edit instructions** before Step 3.

### Step 3 — Tag, push, create release

For **m4l** (tag + asset on the distribution repo):

```bash
TAG=vX.Y.Z
TITLE="Pointsman vX.Y.Z"

gh release create "$TAG" dist/Pointsman.amxd \
  --repo im9/pointsman-m4l \
  --title "$TITLE" \
  --notes-file "/tmp/pointsman-$TAG-notes.md"
```

The `pointsman-m4l` repo is binary-only — no source push to it. The
GH-Releases-created tag lives on that repo's empty default branch.

For **vst** (tag on the source repo, no asset):

```bash
TAG=vst-vX.Y.Z
TITLE="Pointsman vst vX.Y.Z"

git tag "$TAG"
git push origin "$TAG"
gh release create "$TAG" \
  --title "$TITLE" \
  --notes-file "/tmp/pointsman-$TAG-notes.md"
```

### Step 4 — Verify

```bash
# m4l
gh release view "$TAG" --repo im9/pointsman-m4l \
  --json name,tagName,assets,url

# vst
gh release view "$TAG" --json name,tagName,assets,url
```

Confirm:

- For m4l: `assets[0].name == "Pointsman.amxd"`, `assets[0].size > 0`,
  and matches the local file's size.
- For vst: `assets == []` (tag-only by design until distribution
  channel decision is recorded).
- The release URL is reachable.

Show the release URL to the user.

### Step 5 — Cleanup

```bash
rm "/tmp/pointsman-$TAG-notes.md"
```

## Rules

- **Bump before tag.** `project(Pointsman VERSION ...)` (vst) or
  `package.json` (m4l) must be edited and committed BEFORE the tag
  exists. The editor reads the version at compile time via
  `POINTSMAN_VERSION_STRING`, so a tag that pre-dates the bump points
  at a binary reporting the OLD version.
- **Asset / repo are target-specific.** m4l → `dist/Pointsman.amxd`
  on `im9/pointsman-m4l`; vst → tag-only on `im9/pointsman`. Never mix.
- **Tag scheme differs per target.** m4l uses `vX.Y.Z` (continues from
  the existing `v1.0.0` on pointsman-m4l); vst uses `vst-vX.Y.Z` on
  this source repo. The vst prefix exists so the source repo can
  someday host both m4l-source-changes tags and vst tags without
  collision.
- **Manual Freeze required for m4l.** Max has no CLI freeze; this skill
  does not automate it.
- **Tag once, never re-tag.** If a tag for the proposed version already
  exists, bump again rather than overwrite. Force-deleting a pushed
  tag is messy and breaks anyone who pulled it.
- **Notes via `--notes-file`, not `--notes`.** The temp-file flow lets
  the user edit before publish.
- **Halt on any pre-flight failure.** Don't release past a red gate.
- **Halt on any user-confirmation gate.** Steps 0 (bump commit),
  1 (version number), 2 (notes) each require explicit "ok" — don't
  proceed silently.
- **Halt before publishing any vst binary.** Until the distribution
  channel is recorded in a follow-up ADR (per ADR 003 §Out of scope),
  vst releases stay tag-only on the source repo.
