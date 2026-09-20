# 参与贡献

感谢你对 **DeepSeek Harness Reckoner** 的关注与贡献。

[English](../.github/CONTRIBUTING.md)

## 分支

| 分支 | 用途 |
|---|---|
| `develop` | 默认分支；所有开发都落在这里 |
| `feature/*` | 可选的短期分支，通过 PR 合并回来 |
| `main` | 仅发布；任何情况下都不直接提交或推送 |

## 拉取请求

| 规则 | 说明 |
|---|---|
| 目标分支 | `develop` 或 `feature/*`；绝不能指向 `main` |
| 仅限所有者 | 合并进 `main`、打发布 tag、发布版本 |
| 远程约束 | `main` 要求走 PR，直接推送会被拒绝 |

## 提交信息

使用 Conventional Commits：`type(scope): subject`，例如 `feat(expression): …`。

| 部分 | 规则 |
|---|---|
| type | `feat`、`fix`、`refactor`、`docs`、`test`、`chore`、`perf`、`build`、`ci`、`revert` |
| subject | 英文、祈使语气、小写开头 |

只要改动需要说明理由，就写正文；正文是成段的叙述，而不是改动文件清单。

## 开发环境

| 项目 | 取值 |
|---|---|
| 工具链 | pnpm 11 与 Node ≥ 20；CI 使用 Node 24 |
| 构建 | TypeScript、tsdown、vitest |

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

测试位于 `tests/`，镜像 `src/` 的目录结构，每个单元一个 `*.test.ts`。`pnpm build` 重新生成 `lib/`，它已被 gitignore，发布时全新构建。

## 发布

仅限所有者操作。一次发布对应一个 tag：

1. 更新 `package.json` 与 `dsh.plugin.json`，并在 `CHANGELOG.md` 添加对应条目。最新的版本化条目必须等于新版本号。
2. 推送 `develop` 并 `main` 发起 PR；`build` 工作流通过后合并。
3. 在 `main` 上打 `vX.Y.Z` 并推送该 tag。发布工作流会校验 tag 与分支及两个版本文件一致，随后发布到 npm 并创建 GitHub Release。
4. 预发布版本 `x.y.z-*` 发布到 `beta` dist-tag，并在 GitHub 上标记为预发布。

## 文档

| 规则 | 说明 |
|---|---|
| 范围 | README 只记录已实现的功能 |
| 语言 | 每份文档都在规范位置有 en-US 版本，并在其旁以 `xxx.zh-CN.md` 提供简体中文版；changelog 仅英文 |
| 术语 | 简体中文里分贝写作**分贝**；`dBm`、`dBu`、`dBµV`、`dBW` 这类单位符号保持不变 |
| 路线图 | 规划内容在成为实际工作之前不进入仓库 |

## 许可

通过参与贡献，你同意你的贡献以 [MIT 许可](../LICENSE) 授权。
