---
name: release
description: Cut a versioned per-target release of Pointsman. m4l publishes to GitHub Releases (tag + asset + notes); vst is local-only (CMakeLists VERSION bump + `make release-vst` to produce signed/notarized dmg AND pkg in dist/, no tag, no GH release — downstream handling is out of skill scope). Verifies repo state, bumps semver, runs the build (vst), drafts notes (m4l), and walks each step with explicit user approval. `none` bump (vst only) keeps the current version and regenerates artifacts — for doc-only fixes to bundled files.
argument-hint: "<m4l|vst> [major|minor|patch|none]"
allowed-tools: Read, Write, Edit, Bash(git *), Bash(gh *), Bash(stat *), Bash(ls *), Bash(rm /tmp/pointsman-*), Bash(make release-vst), Bash(xcrun stapler validate *)
---

# Release Pointsman

Cut a versioned per-target release. The first $ARGUMENT selects the
target (`m4l` or `vst`); the second is the bump (`major` / `minor` /
`patch` / `none`, default `patch`). `none` is vst-only — keep the
current version and regenerate artifacts only.

m4l publishes to GitHub Releases with tags namespaced as
`m4l-vX.Y.Z`. vst is local-only — no tag, no GH release; the
in-tree `vst/CMakeLists.txt` `project(Pointsman VERSION …)` is the
version source of record. The skill stops after producing the
signed/notarized dmg + pkg in `dist/`; whatever happens to those
artifacts after that is out of skill scope.

The legacy `im9/pointsman-m4l/v1.0.0` (canary distribution on a
separate binary-only repo) is retained on that repo as legacy;
future m4l releases live on `im9/pointsman` with the
`m4l-v*` tag namespace.

The release asset is target-specific:

- **m4l** → `dist/Pointsman.amxd` — frozen `.amxd`. Manual freeze
  in Max required (snowflake button → *File → Save As*). See
  [ADR 002](../../../docs/ai/adr/002-pointsman-release.md).
- **vst** → `dist/Pointsman.pkg` (recommended installer) **and**
  `dist/Pointsman.dmg` (drag-to-install fallback) — both signed /
  notarized / stapled, built in lockstep by `make release-vst`.
  Local artifacts only; GitHub Releases is not used for vst. See
  [ADR 003 §Release procedure](../../../docs/ai/adr/003-pointsman-vst-architecture.md#release-procedure).

> **⚠️ vst is local-only.** No tag is created, no GH release is
> created, no asset is uploaded by this skill. `/release vst` ends
> at Step 1.6: a signed/notarized/stapled `dist/Pointsman.pkg` **and**
> `dist/Pointsman.dmg` in `dist/` + (when bumping) a CMakeLists
> VERSION bump committed to main. The build itself
> (`make release-vst`) runs inside the skill at Step 1.6.
> Downstream handling of the local artifacts (uploads, listing
> copy, channel-specific metadata) is out of skill scope.
>
> No prior `vst-v*` tags exist on this repo; none will be created
> going forward. The in-tree `project(Pointsman VERSION …)` line
> in `vst/CMakeLists.txt` is the single authoritative version
> source. m4l remains a free GitHub Releases distribution (tag +
> release + asset).

## Pre-flight checks (do these BEFORE the publish step)

Once a release ships (m4l: tag pushed + GH release; vst:
artifacts handed off downstream), it is harder to undo cleanly.
Run all checks; STOP and ask the user if any fail.

### Check 1 — Working tree is clean

`git status --porcelain` must be empty. Uncommitted changes leak
into the release context. Halt if dirty.

### Check 2 — main is synced with origin

```bash
git fetch origin --quiet
git rev-list --count main..origin/main   # must be 0 (origin not ahead)
git rev-list --count origin/main..main   # must be 0 (local not ahead)
```

If origin is ahead, `git pull`. If local is ahead, push first
(via `/commit` for any unstaged work, then a normal push). Then
re-run.

### Check 3 — CI is green on HEAD

```bash
gh run list --branch main --limit 5 --json conclusion,headSha,workflowName
```

The most recent completed run for the current HEAD SHA must have
`conclusion: "success"`. If still in progress or failed, halt and
ask. Don't ship distribution artifacts past a red gate — chasing
"probably just CI flake" has historically masked real regressions.

### Check 4 — Asset reflects current source (m4l only)

For **m4l**, the asset is produced by manual Max freeze (no CLI
freeze available), so this is a pre-flight gate — the user has to
have done the freeze before the skill runs. For **vst**, skip this
check; the build is run by the skill itself in Step 1.6, and the
artifact freshness check moves there too.

```bash
ls -la dist/Pointsman.amxd
stat -f '%m' dist/Pointsman.amxd                       # mtime as epoch
git log -1 --format=%ct -- m4l/Pointsman.maxpat \
                            m4l/pointsman.mjs \
                            m4l/pointsman.entry.mjs \
                            m4l/scaleKeyboard.jsui.js \
                            m4l/engine m4l/host        # latest m4l-source commit time
```

`dist/Pointsman.amxd` mtime must be **>=** the latest m4l-source
commit time. If older, halt and remind:

> Open `m4l/Pointsman.amxd` in Max → click the snowflake (Freeze)
> button in the patcher toolbar → *File → Save As*
> `dist/Pointsman.amxd`.

Even when the mtime check passes, **manual smoke test in a fresh
Live track is recommended before tagging** — drag
`dist/Pointsman.amxd` onto a new MIDI track, confirm it loads,
scale-snap works, chord / harmony modes respond, MIDI flows
through. CI does not (and cannot) cover this.

## Drafting

After pre-flight passes:

### Step 1 — Determine next version

The second $ARGUMENT is the bump (default `patch`). `none` is
**vst-only** and means "keep the current version, just regenerate
artifacts" — useful when only bundled docs / readmes change and the
plug-in binary doesn't actually need a new version.

For **m4l**, parse the highest `m4l-v*` tag and bump per the second
$ARGUMENT:

```bash
git tag -l 'm4l-v*' | sort -V | tail -1
```

If no prior `m4l-v*` tag (first release on `im9/pointsman` — the
legacy `v1.0.0` lives on `im9/pointsman-m4l` and does not count),
propose `m4l-v0.1.0`.

(`none` is rejected for m4l — m4l version metadata isn't in-tree,
so re-freezing at the same version would just produce a duplicate
tag, which the skill blocks.)

For **vst**, no tags are created — the in-tree
`project(Pointsman VERSION X.Y.Z)` line in `vst/CMakeLists.txt` is
the authoritative previous version. Bump from there, or keep with
`none`:

```bash
grep '^project(Pointsman VERSION' vst/CMakeLists.txt
```

Show the proposed version to the user and **confirm before
proceeding**. The user can override.

### Step 1.5 — Bump version metadata (vst only; skipped on `none`)

If Step 1 resolved to a new version (bump): edit
`vst/CMakeLists.txt` so `project(Pointsman VERSION X.Y.Z)` matches
the target version, commit, and push to main BEFORE the build runs
in Step 1.6. The plist version reported to the DAW and the `v…`
label drawn in the editor header both come from this line via
`POINTSMAN_VERSION_STRING`.

```bash
# In vst/CMakeLists.txt, line 2:
# project(Pointsman VERSION <old>) → project(Pointsman VERSION <new>)
git add vst/CMakeLists.txt
git commit -m "chore(vst): bump version to X.Y.Z"
git push origin main
```

If Step 1 was `none` (regen at same version): skip this step
entirely — nothing to commit, nothing to push. Proceed to Step 1.6
so the build picks up whatever other source changes triggered the
regen (e.g. bundled README / INSTALL.txt fixes).

For m4l this step is skipped — m4l version metadata isn't in-tree
(the freeze captures whatever is on disk).

### Step 1.6 — Build and verify (vst only)

Run `make release-vst` to produce both artifacts (codesign +
notarize + staple + dmg + pkg are wrapped in the script chain):

```bash
make release-vst
```

This takes a few minutes — notarization is the long leg (waits on
Apple's service). Requires `DEVELOPER_TEAM_ID` env var +
`im9-notary` keychain profile + `Developer ID Application` and
`Developer ID Installer` certs in the login keychain. If
`make release-vst` fails, halt and surface the error; do not retry
blindly — notarization rejections, expired certs, and missing env
all need investigation before re-run.

After build, verify both artifacts are present, fresh, and have a
stapled notarization ticket:

```bash
ls -la dist/Pointsman.pkg dist/Pointsman.dmg
stat -f '%m' dist/Pointsman.pkg                        # mtime as epoch
stat -f '%m' dist/Pointsman.dmg                        # mtime as epoch
git log -1 --format=%ct -- vst/Source/ \
                            vst/CMakeLists.txt \
                            vst/scripts/ \
                            vst/tests/                 # latest vst-source commit time
xcrun stapler validate dist/Pointsman.pkg
xcrun stapler validate dist/Pointsman.dmg
```

Both `dist/Pointsman.pkg` AND `dist/Pointsman.dmg` mtimes must be
**>=** the latest vst-source commit time, and `stapler validate`
must succeed on both. If either check fails, halt — something went
wrong in build or notarization.

Manual host smoke (Logic AU MIDI FX + Bitwig VST3 MIDI fx + Bitwig
CLAP) is recommended before handing the artifacts off downstream.

**vst stops here.** Steps 2-5 are m4l-only. Downstream handling of
`dist/Pointsman.dmg` and `dist/Pointsman.pkg` is out of skill scope.

### Step 2 — Draft release notes (m4l only)

For **vst**, skip this step — the skill does not draft downstream
listing copy. Write any release-side description out of band.

For **m4l**, compute the previous-release boundary (highest
`m4l-v*` tag) and generate the changelog from the commit log
between it and HEAD:

```bash
PREV=$(git tag -l 'm4l-v*' | sort -V | tail -1)
git log "${PREV:-}"..HEAD --pretty=format:'- %s' -- m4l/
```

If `$PREV` is empty (first m4l release on `im9/pointsman`), scope
to m4l-touching commits since the repo started:

```bash
git log --pretty=format:'- %s' -- m4l/ docs/ai/adr/
```

Categorize commits by their `type(scope):` prefix into sections:

- **Features** — `feat:`
- **Fixes** — `fix:`
- **Docs / housekeeping** — `docs:` / `chore:` / `style:` / `refactor:`
- **CI / build** — `ci:`

Drop the `Co-Authored-By` lines and trailing housekeeping noise.
Keep the section short — release notes are for users, not
contributors; detailed history is in `git log`.

For the very first `m4l-v*` release on `im9/pointsman`, use a
project-intro template ("What it does" / "Install" /
"Requirements") instead of a changelog — the legacy `v1.0.0` on
`im9/pointsman-m4l` is on a different repo and does not count as a
prior boundary here.

Write the draft to `/tmp/pointsman-m4l-vX.Y.Z-notes.md` and show it
to the user. **Wait for explicit "ok" or edit instructions** before
continuing. The file is fed to `gh release create --notes-file` in
Step 3.

### Step 3 — Tag, push, create release (m4l only)

For **vst**, skip this step entirely — vst is local-only (see the
block at the top). vst's flow already ended at Step 1.6 with both
artifacts in `dist/` and (when bumping) the CMakeLists bump
committed.

```bash
TAG=m4l-vX.Y.Z
ASSET=dist/Pointsman.amxd
TITLE="Pointsman m4l vX.Y.Z"

git tag "$TAG"
git push origin "$TAG"
gh release create "$TAG" "$ASSET" \
  --title "$TITLE" \
  --notes-file "/tmp/pointsman-$TAG-notes.md"
```

### Step 4 — Verify (m4l only)

```bash
gh release view "$TAG" --json name,tagName,assets,url
```

Confirm:

- `assets[0].name` is `Pointsman.amxd`.
- `assets[0].size` > 0 and matches the local file's size.
- The release URL is reachable.

Show the release URL to the user.

### Step 5 — Cleanup (m4l only)

```bash
rm "/tmp/pointsman-m4l-vX.Y.Z-notes.md"
```

## Rules

- **Asset is target-specific.** m4l → `dist/Pointsman.amxd`
  (frozen); vst → both `dist/Pointsman.pkg`
  (signed/notarized/stapled installer) and `dist/Pointsman.dmg`
  (signed/notarized/stapled drag-to-install). Never mix.
- **m4l publishes to GitHub; vst does not.** m4l tags
  `m4l-vX.Y.Z`, creates a GH release, attaches the `.amxd`. vst
  skips Step 3/4 entirely — no tag, no GH release, no asset
  upload. Downstream handling of vst artifacts is out of skill
  scope.
- **vst version source of record = CMakeLists.** Since vst has no
  tags going forward, `project(Pointsman VERSION X.Y.Z)` in
  `vst/CMakeLists.txt` is the single authoritative version. Bump
  at Step 1.5 (skipped on `none`) and commit + push before Step
  1.6 builds the artifacts.
- **Manual Freeze required for m4l.** Max has no CLI freeze; this
  skill does not automate it.
- **`make release-vst` runs inside the skill (Step 1.6).** Both
  the dmg and the pkg are built + signed + notarized + stapled by
  the script chain (`codesign.sh` → `notarize.sh` →
  `build-dmg.sh` → `build-pkg.sh`). The skill invokes it after
  Step 1.5 — the user doesn't run it manually. Requires
  `DEVELOPER_TEAM_ID` + `im9-notary` keychain profile + signing
  certs in the login keychain (see ADR 003 §Release procedure).
- **`none` bump is vst-only.** A vst regen at the same version is
  for doc-only fixes (bundled README / INSTALL.txt) where the
  plug-in binary doesn't need a version change. Step 1.5 is
  skipped; Step 1.6 still rebuilds artifacts so the new bundled
  files land in dmg + pkg.
- **Tag once, never re-tag (m4l).** If an `m4l-v*` tag for the
  proposed version already exists, bump again rather than
  overwrite. Force-deleting a tag that was already pushed is
  messy and breaks anyone who pulled it.
- **Notes via `--notes-file`, not `--notes`** (m4l). The temp-file
  flow lets the user edit before publish. vst has no
  notes-drafting step — downstream listing copy is written out of
  band.
- **Halt on any pre-flight failure.** Don't release past a red
  gate.
- **Halt on any user-confirmation gate.** Steps 1 (version) and 2
  (notes) require explicit "ok" — don't proceed silently.
