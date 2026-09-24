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

Conventional Commits.

| item | rule |
|---|---|
| form | `type(scope): subject`, for example `feat(expression): …` |
| type | `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`, `revert` |
| subject | English, imperative mood, lowercase |
| body | welcome whenever a change needs its reason stated; prose, not a list of touched files |

## Development setup

- **pnpm**: 11
- **Node**: ≥ 20; CI runs 24
- **Build**: TypeScript, tsdown, vitest
- **Tests**: `tests/`, one `*.test.ts` per unit, mirroring `src/`
- **`lib/`**: gitignored, built fresh on publish

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Release

Reserved to the owner. One release is one tag:

1. Bump `package.json` and `dsh.plugin.json`, and add the matching `CHANGELOG.md` entry. The newest versioned entry must equal the new version.
2. Push `develop` and open a pull request to `main`; merge it once the `build` workflow passes.
3. Tag `vX.Y.Z` on `main` and push the tag: the release workflow checks the tag against the branch and both version files, then publishes to npm and creates a GitHub Release.
4. A prerelease version `x.y.z-*` publishes under the `beta` dist-tag and is marked prerelease on GitHub.

## Documentation

- The README documents implemented features only.
- Every document exists in en-US at its canonical path, and in Simplified Chinese beside it as `xxx.zh-CN.md`; the changelog is English only.
- Write 分贝 for the decibel; unit symbols such as `dBm`, `dBu`, `dBµV` and `dBW` stay unchanged.
- Plan items stay out of the repository until they become real work.
- Prose only where a sentence is the clearest form; facts belong in tables and lists, with nominal column headers and one fact per cell.

## License

By contributing, you agree your contributions are licensed under the [MIT License](../LICENSE).
