# Release notes

Release notes are generated automatically. Run:

```sh
bun run release 0.8.0 --dry-run
bun run release 0.8.0
```

Use the version you intend to ship; these commands are examples. All three
packages receive that version. The private root package version is unchanged.

By default, notes list commits since the previous reachable release tag, grouped
by conventional commit type (features, fixes, performance, documentation,
maintenance and other changes). Commit scopes such as `react` or `svelte` and
PR references such as `(#123)` are preserved. Release commits and merge wrappers
are excluded; individual merged commits and squash titles remain. Breaking-change
markers (`!` or `BREAKING CHANGE:`) get their own section.

Stable releases compare against the previous stable tag, including changes from
the entire prerelease cycle. Prereleases compare against the previous release,
including earlier prereleases. With no previous tag, notes use the full history.
Automatic notes require full history and local release tags; follow the error's
`git fetch` instructions if the clone is shallow or tags are missing.

Dry runs preview generated notes without writing them. Actual releases save the
snapshot to `docs/releases/<version>.md` in the release commit; CI publishes that
exact text. No GitHub API token or PR lookup is needed to generate notes.

For custom notes, pass `--notes /absolute/path/to/notes.md`, or write and commit
`docs/releases/<version>.md` beforehand. Existing notes are respected instead of
regenerated. An explicit `--notes` file must exist and contain text; errors do not
silently fall back to generated notes. Describe migration steps manually for
breaking changes—the generator summarizes commit titles, not the code's behavior.
A suggested structure for custom notes (omit sections that do not apply):

```markdown
## Core
- Describe shared rendering or runtime changes.

## React
- Describe React API or behavior changes.

## Svelte
- Describe Svelte API or behavior changes.

## Migration
- Explain breaking changes and required user actions.
```

A custom notes file inside the repository must be committed first because the
command requires a clean working tree. External notes are imported into the release
commit. No handwritten file is required for the default workflow.

Prereleases such as `0.9.0-beta.1` use npm's `next` tag and GitHub's prerelease flag.
Stable releases use `latest`. Versions must increase, with no `v` prefix or build
metadata. Promotion is a new stable release, e.g. `0.9.0-beta.1` → `0.9.0`.

The script requires clean `main` matching the remote, an unused tag, and synchronized
package versions. It refreshes the lockfile without updating dependency ranges,
runs lint, builds, type checks, unit tests, both playground builds, browser/GPU
checks and packed-consumer tests, then creates a commit and annotated tag and
pushes both atomically. Install Playwright Chromium before releasing. Linux also
needs Xvfb (installed by Playwright's `install --with-deps chromium`).

A dry run checks prerequisites and prints the plan/notes without changing files,
refs, dependencies or remote state. It does not run validation or test push permissions.

If validation fails, the release's manifest, lockfile and notes edits are restored.
Generated build output may remain. If committing succeeds but tagging or pushing
fails, the local commit is retained and the command prints the atomic push to
retry. Never force-push a published tag. If the remote advanced or branch protection
rejects the push, resolve that deliberately; the script does not bypass protections.

After a successful push, follow the Release workflow in GitHub Actions. Its failure
does not require a new tag: rerun failed jobs to finish a partial publication.
Published package versions are skipped; registry errors are fatal. Release notes
are created or updated from the versioned Markdown, so a notes-step retry is safe.
Routine npm publishing happens in CI through Trusted Publishing. A newly named
package needs one initial authenticated publication of its verified tarball before
Trusted Publishing can be configured. All packages use the personal `@kiaa` scope.
