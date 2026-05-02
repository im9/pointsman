# ADR 004: m4l Bake & Distribution

## Status: Proposed

**Created**: 2026-05-02

This ADR specifies how the `.maxpat` source files are baked into
distributable `.amxd` artifacts, the path / external-reference conventions
inside the patcher JSON, the guard tests that defend the bake pipeline,
and the packaging conventions for distribution channel upload.

## Context

[ADR 002](002-m4l-architecture.md) defines the file layout — `.maxpat`
source tracked in git, `.amxd` is a built artifact — and resolves the
script choice ("port from oedipa with argv parameterization"). It does
not specify the bake pipeline itself, the path conventions inside
`.maxpat`, the guard tests, or how the resulting `.amxd` files are
packaged for distribution channel upload.

[ADR 003](003-m4l-ui-design.md) covers the UI inside the `.maxpat` files
but is silent on the path / freeze layer. Without an ADR to anchor the
bake pipeline, the bake script port and its guard tests have no spec to
verify against — they would just match oedipa's behavior, which is fine
operationally but leaves Stencil-specific decisions undocumented (two
devices instead of one, bundle vs split listing).

[oedipa ADR 007](https://github.com/im9/oedipa) is the reference for the
single-device case. This ADR ports + extends.

## Decision

### Bake script

`m4l/scripts/maxpat-to-amxd.mjs`, ported from oedipa with two changes:

1. Accept `argv[2] ∈ {TM, QT}` (validated; reject else).
2. Resolve I/O as
   `m4l/Stencil-${argv[2]}.maxpat` → `m4l/dist/Stencil-${argv[2]}.amxd`.

Core operations carry verbatim from oedipa: AMPF header splice, JSON
validation, `--check` mode that returns nonzero without writing.

Workspace scripts at `m4l/package.json`:

```
pnpm bake:tm           # node scripts/maxpat-to-amxd.mjs TM
pnpm bake:qt           # node scripts/maxpat-to-amxd.mjs QT
pnpm bake:check:tm     # ... TM --check
pnpm bake:check:qt     # ... QT --check
pnpm bake              # bake:tm && bake:qt
pnpm bake:check        # bake:check:tm && bake:check:qt
```

### Patcher path conventions

- `[node.script]` references its host index by **bare-sibling path**
  (`host-tm/index.js`, `host-qt/index.js`) — not absolute.
- `[jsui]` references its renderer file by bare-sibling path
  (`host-tm/ui/registerRing.jsui.js`, `host-qt/ui/scaleKeyboard.jsui.js`)
  per [ADR 003](003-m4l-ui-design.md) §jsui widgets.
- No absolute paths anywhere in `.maxpat` JSON: no `/Users/`, no
  `/home/`, no `C:\`, no Windows drive letters.
- All sub-patcher refs (if any are introduced later) follow the same
  bare-sibling rule.

### Guard tests

Run via `pnpm bake:check:*`. Failures are nonzero exit and block bake.

1. **Abs-path scrub** — fail if `.maxpat` JSON contains `/Users/`,
   `/home/`, or matches a Windows-absolute path regex.
2. **External validation** — fail if any `[node.script]` or `[jsui]`
   filename referenced in `.maxpat` does not exist as a sibling file
   relative to the `.maxpat` root. Both kinds are validated by the same
   pass — every `filename`-bearing object in the patcher JSON must
   resolve.
3. **Live.* parameter consistency** *(optional, deferred)* — fail if any
   `live.*` widget references a parameter name not in ADR 002's table.

Tests run on each device's `.maxpat` independently — TM can pass while
QT fails.

### dist/ tracking

- Host TS sources compile to `dist/` per package
  (`m4l/host-tm/dist/`, `m4l/host-qt/dist/`). Committed to git;
  `[node.script]` loads them directly without a build step on the user's
  machine. (Already specified in ADR 002 §File layout.)
- `.amxd` outputs land in `m4l/dist/Stencil-{TM,QT}.amxd`. Committed to
  git as the distributable artifact — channel uploads reference these
  paths or pull from a tagged release.

### Distribution packaging

Two packaging modes are supported; the choice is made at upload time
based on the channel's upload policy:

- **Bundle**: a single archive `Stencil.zip` containing
  `Stencil-TM.amxd`, `Stencil-QT.amxd`, plus a short `README.txt` (use
  case + chain example) and an optional demo `.mid` clip.
- **Split**: two separate listings, each with its single `.amxd` and
  per-device README/demo.

Both modes are achievable from the same baked `.amxd` set; the listing
material differs.

### Listing materials

Required at upload time (v1):

- Device screenshot — Live's device strip view, both devices visible if
  bundle, single device if split.
- Audio demo — 30–60 sec MP3 covering: TM solo, QT solo, TM→QT chain.
- Description copy — 1 paragraph use case + 1 paragraph features.
- Author / license: `im9 / free distribution` per project README.

Format / dimensions are channel-specific; resolve at upload time.

## Open questions

These are flagged for follow-up rather than blocking implementation.
Resolution events are noted where known.

- **Distribution channel** — maxforlive.com is the obvious default for
  m4l devices but its listing format and pricing model may force
  packaging decisions. Alternatives: gumroad, itch.io, GitHub releases
  (free only). Resolves at upload time when the v1 verification
  checklist is green.
- **Bundle vs split listing** — depends on the channel above. Both are
  achievable from the same artifact set; only the listing material
  differs. (Moved here from ADR 002 §Open questions.)
- **`.amxd` output path** — `m4l/dist/Stencil-{TM,QT}.amxd` vs flatter
  `m4l/Stencil-{TM,QT}.amxd`. Default is `dist/` (matches oedipa);
  flatten only if the bake pipeline forces it.
- **Free vs paid** — README says "free distribution" but channels may
  offer name-your-price or tip-jar models. Non-architectural; resolves
  at upload time.
- **Versioning / update flow** — once v1 ships, how are updates pushed
  (re-upload? channel-specific update mechanics? semver tags on git?).
  Defer to first-update event; not blocking v1.
- **Listing screenshot / demo specifics** — exact pixel dimensions,
  audio length, demo musical content. Resolve at upload time when the
  channel's upload form is open.

## Implementation checklist

### Bake pipeline

- [ ] Port `m4l/scripts/maxpat-to-amxd.mjs` from oedipa
- [ ] Parameterize `argv[2]` for `TM` | `QT`; validate
- [ ] Wire `pnpm bake:tm`, `bake:qt`, `bake`, and `bake:check:*` at
      `m4l/package.json`
- [ ] Abs-path scrub guard test
- [ ] External-validation guard test (verify `[node.script]` filenames
      resolve as sibling files)

### Bake outputs

- [ ] `pnpm bake:tm` produces `m4l/dist/Stencil-TM.amxd` from a working
      `Stencil-TM.maxpat`
- [ ] `pnpm bake:qt` produces `m4l/dist/Stencil-QT.amxd` from a working
      `Stencil-QT.maxpat`
- [ ] Both `.amxd` load in Live without console errors
- [ ] `pnpm bake:check` passes on a fresh checkout

### Distribution

- [ ] Choose distribution channel; close the channel Open Q
- [ ] Decide bundle vs split based on channel; close that Open Q
- [ ] Prepare screenshot at channel-required dimensions
- [ ] Record audio demo (TM solo / QT solo / chain) and export MP3
- [ ] Write description copy
- [ ] Upload v1; first public version live
- [ ] Flip ADR 002 / 003 / 004 to *Implemented* and archive

## Out of scope

- **Versioning / update mechanics post-v1** — open question, deferred
  to first-update event.
- **Marketing / pricing strategy** — non-architectural; the README
  states free distribution and that holds unless the channel forces
  otherwise.
- **vst distribution** — separate target, separate ADR series, post-v1
  per the ADR set's implicit roadmap.
- **CI for bake** — running `bake:check` in GitHub Actions on PR is a
  nice-to-have; add when there's a second contributor or the manual
  check becomes burdensome.
