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

使用 Conventional Commits。

| 项 | 规则 |
|---|---|
| 形式 | `type(scope): subject`，例如 `feat(expression): …` |
| type | `feat`、`fix`、`refactor`、`docs`、`test`、`chore`、`perf`、`build`、`ci`、`revert` |
| subject | 英文、祈使语气、小写开头 |
| 正文 | 只要改动需要说明理由就写；成段叙述，而不是改动文件清单 |

## 开发环境

| 项目 | 取值 |
|---|---|
| pnpm | 11 |
| Node | ≥ 20；CI 使用 24 |
| 构建 | TypeScript、tsdown、vitest |
| 测试 | `tests/`，每个单元一个 `*.test.ts`，镜像 `src/` |
| `lib/` | 已被 gitignore；发布时全新构建 |

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 发布

| 项 | 值 |
|---|---|
| 操作者 | 仅限所有者 |
| 单位 | 一次发布对应一个 tag |

| 步骤 | 动作 |
|---|---|
| 1 | 更新 `package.json` 与 `dsh.plugin.json`，并在 `CHANGELOG.md` 添加对应条目 |
| 2 | 推送 `develop`，向 `main` 发起 PR 并合并 |
| 3 | 在 `main` 上打 `vX.Y.Z` 并推送该 tag |
| 4 | 预发布无需额外动作，自行发布 |

最新的版本化 changelog 条目必须等于新版本号。第 2 步等待 `build` 工作流通过。第 3 步触发发布工作流：它校验 tag 与分支及两个版本文件一致，发布到 npm 并创建 GitHub Release。预发布版本 `x.y.z-*` 发布到 `beta` dist-tag，并在 GitHub 上标记为预发布。

## 文档

| 规则 | 说明 |
|---|---|
| 范围 | README 只记录已实现的功能 |
| 语言 | 规范路径下为 en-US，其旁以 `xxx.zh-CN.md` 提供简体中文 |
| changelog | 仅英文 |
| 术语 | 分贝写作**分贝**；`dBm`、`dBu`、`dBµV`、`dBW` 保持不变 |
| 路线图 | 规划内容在成为实际工作之前不进入仓库 |
| 行文 | 只有句子最清楚时才写散文；事实进表格与列表 |

## 许可

通过参与贡献，你同意你的贡献以 [MIT 许可](../LICENSE) 授权。
