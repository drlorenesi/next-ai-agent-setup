# Maintaining next-ai-agent-setup

This guide is for **maintainers**: people who change this repository and publish new versions of the kit. If you're setting up a new app, you only need [README.md](README.md).

## Who needs what

| Path                                         | For         | What it is                                                                                     |
| :------------------------------------------- | :---------- | :--------------------------------------------------------------------------------------------- |
| `README.md`                                  | Users       | The setup guide and architecture blueprint                                                     |
| `kit/`                                       | Users       | Files downloaded into a new app. Mirrors the app's root: each path here is its path in the app |
| `merge/`                                     | Users       | Files the scaffold already has (`AGENTS.md`, `next.config.ts`, `package.json`), merged by hand |
| `LICENSE.txt`                                | Both        | MIT license                                                                                    |
| `MAINTAINING.md`                             | Maintainers | This guide                                                                                     |
| `AGENTS.md`, `CLAUDE.md`                     | Maintainers | Rules for AI agents working **on this repo**. Not the app's rules: those are `merge/AGENTS.md` and `kit/CLAUDE.md` |
| `package.json`, `package-lock.json`          | Maintainers | Dependencies and npm scripts for checking the kit. `version` is the kit's version              |
| `tsconfig.json`, `vitest.config.ts`          | Maintainers | Type-check and test the kit from the repo root (`@/` = `kit/`)                                  |
| `tests/`                                     | Maintainers | Unit tests for the `kit/lib` modules (Vitest, drivers mocked). Not shipped: apps use `npm run db:check` |
| `docs/db-modules/`                           | Maintainers | Design notes and per-driver testing reports. The README and `kit/lib/db/postgres.ts` link to them on GitHub |
| `.github/workflows/release.yml`              | Maintainers | Publishes a GitHub release when a version tag is pushed                                         |
| `.env.local` (not committed)                 | Maintainers | Optional database credentials for running the `db:*` scripts against real servers              |

Users download only `kit/` and `merge/`, either with `giget` or as the release zip. Keep anything maintainer-only out of those two folders, and out of the README.

## Your responsibilities

1. **Keep the kit working.** `npm run typecheck && npm test` must pass on every commit. The release workflow refuses to publish otherwise.
2. **Keep `kit/` a mirror of the app.** A new file goes at its final app path inside `kit/`. If it replaces or extends a file the scaffold creates, it goes in `merge/` instead, because `giget --force` would otherwise overwrite the user's file. A single setting (like `allowImportingTsExtensions` in `tsconfig.json`) goes straight into the README's setup steps instead of a file: don't ship files users don't need.
3. **Keep the README in sync, and user-only.** Changing a script, skill, `merge/` file, `kit/lib/` module, environment variable or setup step means updating the README section that describes it. Maintainer material belongs here, not there.
4. **Keep outside references current.** The README names vendor skills, CLI commands and Better Auth endpoint paths that change upstream. Before a release, check that they still exist. For example, `kit/lib/auth.ts` rate limits only work if their paths match the installed Better Auth version.
5. **Release versions** so users can pin a known kit. See [Releasing a version](#releasing-a-version).

## Working on the repo

```bash
npm install
npm run typecheck          # kit/lib, kit/scripts, tests/
npm test                   # tests/ with Vitest, no database needed
```

- `kit/lib/auth.ts`, `auth-client.ts`, `email.ts`, `safe-action.ts` and `session.ts` aren't type-checked here: they import Next.js, Better Auth, React and Nodemailer, which this repo doesn't install. Review changes to them by reading carefully, or try them in a scratch app.
- The `db:*` scripts run the kit's scripts against the databases in a root `.env.local`, using the same variables as `kit/.env.example`. They connect to real servers, so use dev databases only.
- Code conventions (plain `node`, `.ts` import extensions, erasable TypeScript only) are listed in [AGENTS.md](AGENTS.md), and `tsconfig.json` enforces most of them.

## Releasing a version

The README's download commands fetch a **tag**: a name like `v1.0.0` attached to one commit. Pushing a tag makes that version downloadable and starts the release workflow ([.github/workflows/release.yml](.github/workflows/release.yml)). The workflow:

1. checks that the tag matches `version` in `package.json`;
2. runs `npm run typecheck` and `npm test`;
3. publishes a GitHub release with a zip of `kit/`, `merge/`, `README.md` and `LICENSE.txt`.

To release:

```bash
# 1. Set the new version in package.json ("version": "1.1.0") and in
#    README.md: the "Version" line at the top and both #v… download tags in
#    "Downloading the kit". Then commit.
git add -A && git commit -m "Release v1.1.0"

# 2. Upload the commits to GitHub.
git push

# 3. Create the tag on the commit you just pushed, then upload the tag.
#    Commits and tags are pushed separately: `git push` alone doesn't send tags.
git tag v1.1.0
git push origin v1.1.0
```

Follow the workflow in the repository's **Actions** tab. If a check fails, no release is published. Fix the problem, delete the tag (`git tag -d v1.1.0 && git push origin :refs/tags/v1.1.0`), and tag the fixed commit.

Then check the download works the way users will run it:

```bash
cd "$(mktemp -d)"
npx giget@latest gh:drlorenesi/next-ai-agent-setup/kit#v1.1.0 . --force
ls -A    # expect .claude/, .env.example, app/, db/, lib/, scripts/, CLAUDE.md
```

Versions follow [semantic versioning](https://semver.org):

- **Patch** (1.0.1): fixes.
- **Minor** (1.1.0): additions that don't change existing setup steps.
- **Major** (2.0.0): an app set up with an earlier version would need changes.
