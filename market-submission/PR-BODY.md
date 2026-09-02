# Add hanrr92/dsh-code-quote

Adds `data/plugins/hanrr92__dsh-code-quote.yml` — one new entry, no other files touched.

## What it does

Composer code-quote collapse for the DSH Web UI. Pasting a `path:lines` header followed by code into the input box folds the draft into one compact inline quote token (`⟦代码引用#id|header⟧`, Ctrl+Z reversible); at send time an `agent/pre-step` hook injects the full pasted snapshot as a separate context message, so the persistent log stays compact while the model sees the complete code.

## Submission checklist

- [x] Declares a `dsh.bundle` manifest in `package.json` (`dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: "web"`), with `cordis.patch.yml` in the repo root
- [x] Real, working code — no build step required (source ships as ESM)
- [x] Category: `ui` (composer/input-box behavior)
- [x] `dsh-plugin` topic added to the repo
- [x] Prebuilt tarball attached to a GitHub Release (`tarball:` field points at the pinned `v0.2.0` asset)
- [ ] Repo age ≥ 1 day and ≥ 10 commits (both verified by CI before this PR is merged)
- [x] npm: `dsh-code-quote@0.1.0` published (0.2.0 with snapshot persistence ships on the Release tarball)

## Install

```sh
dsh plugin --profile web add dsh-code-quote   # after npm publish, if any
# or via this entry's tarball / GitHub source
```
