# Contributing

Thanks for your interest in contributing to **DeepSeek Harness Reckoner**.

[简体中文](../docs/CONTRIBUTING.zh-CN.md)

## Branches

| branch | role |
|---|---|
| `develop` | the default branch; all development lands here |
| `feature/*` | optional short-lived branches, merged back by pull request |
| `main` | releases only; never committed to or pushed directly |

## Pull requests

| rule | detail |
|---|---|
| target | `develop`, or a `feature/*` branch; never `main` |
| reserved to the owner | merging into `main`, tagging releases and publishing versions |
| enforcement | `main` requires a pull request, so a direct push is rejected |

## Commit messages

Conventional Commits: `type(scope): subject`, for example `feat(expression): …`.

| part | rule |
|---|---|
| type | `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`, `revert` |
| subject | English, imperative mood, lowercase |

A body is welcome whenever a change needs its reason stated, and it reads as prose rather than as a list of touched files.

## Development setup

| item | value |
|---|---|
| toolchain | pnpm 11 and Node ≥ 20; CI runs Node 24 |
| build | TypeScript, tsdown, vitest |

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Tests live in `tests/`, mirroring the `src/` layout with one `*.test.ts` per unit. `pnpm build` regenerates `lib/`, which is gitignored and built fresh on publish.

## Release

Reserved to the owner. One release is one tag:

1. Bump `package.json` and `dsh.plugin.json`, and add the matching `CHANGELOG.md` entry. The newest versioned entry must equal the new version.
2. Push `develop` and open a pull request to `main`; merge it once the `build` workflow passes.
3. Tag `vX.Y.Z` on `main` and push the tag. The release workflow checks the tag against the branch and both version files, then publishes to npm and creates a GitHub Release.
4. A prerelease version `x.y.z-*` publishes under the `beta` dist-tag and is marked prerelease on GitHub.

## Documentation

| rule | detail |
|---|---|
| scope | the README documents implemented features only |
| languages | every document exists in en-US at its canonical path and in Simplified Chinese beside it as `xxx.zh-CN.md`; the changelog is English-only |
| terms | write 分贝 for the decibel in Simplified Chinese; unit symbols such as `dBm`, `dBu`, `dBµV` and `dBW` stay unchanged |
| roadmap | plan items stay out of the repository until they become real work |

## License

By contributing, you agree your contributions are licensed under the [MIT License](../LICENSE).
