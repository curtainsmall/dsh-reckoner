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

| item | value |
|---|---|
| pnpm | 11 |
| Node | ≥ 20; CI runs 24 |
| build | TypeScript, tsdown, vitest |
| tests | `tests/`, one `*.test.ts` per unit, mirroring `src/` |
| `lib/` | gitignored; built fresh on publish |

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Release

| item | value |
|---|---|
| who | reserved to the owner |
| unit | one release is one tag |

| step | action |
|---|---|
| 1 | bump `package.json` and `dsh.plugin.json`, and add the matching `CHANGELOG.md` entry |
| 2 | push `develop`, open a pull request to `main`, merge it |
| 3 | tag `vX.Y.Z` on `main` and push the tag |
| 4 | nothing to do for a prerelease; it publishes itself |

The newest versioned changelog entry must equal the new version. Step 2 waits for the `build` workflow. Step 3 starts the release workflow, which checks the tag against the branch and both version files, publishes to npm and creates a GitHub Release. A prerelease version `x.y.z-*` publishes under the `beta` dist-tag and is marked prerelease on GitHub.

## Documentation

| rule | detail |
|---|---|
| scope | the README documents implemented features only |
| languages | en-US at the canonical path, Simplified Chinese beside it as `xxx.zh-CN.md` |
| changelog | English only |
| terms | 分贝 for the decibel; `dBm`, `dBu`, `dBµV`, `dBW` stay unchanged |
| roadmap | plan items stay out of the repository until they become real work |
| structure | prose only where a sentence is the clearest form; facts in tables and lists |

## License

By contributing, you agree your contributions are licensed under the [MIT License](../LICENSE).
