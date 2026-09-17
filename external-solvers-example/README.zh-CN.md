# ElectroLab 回显对端

ElectroLab 外部求解器功能的可运行对端：一个说类型化信封协议的 http 对端，把收到的每个参数原样回显，因此「注册 → 重启 → 调用」这条往返链路可以凭肉眼核对。

[English](README.md)

## 目录

- [项目](#项目)
- [1. 运行对端](#1-运行对端)
- [2. 注册声明](#2-注册声明)
- [3. 重启宿主](#3-重启宿主)
- [4. 调用它](#4-调用它)
- [5. 脱离插件自检对端](#5-脱离插件自检对端)
- [协议参考](#协议参考)

## 项目

| 项目 | 取值 |
|---|---|
| 结构 | 独立的 npm 工程，自带 `package.json` 与 `tsconfig.json` |
| 依赖 | 运行时零依赖，只使用标准库 |
| TypeScript | 由 Node ≥ 22.18 或 ≥ 23.6 在运行时擦除，因此没有构建步骤 |
| 质量门槛 | 在本目录执行 `pnpm typecheck`，启用 `erasableSyntaxOnly` |
| 与插件的关系 | 插件的 `src/` 不引用它，插件的构建与测试不覆盖它，npm 产物也从不包含它 |

## 1. 运行对端

```bash
node src/echo.ts http --port 8787
# [http] echo peer listening on http://127.0.0.1:8787/
```

或先安装一次开发依赖再使用脚本：`pnpm install` 与 `pnpm echo:http`。

## 2. 注册声明

[`register-guide.zh-CN.md`](register-guide.zh-CN.md) 逐字段给出该求解器的取值，包含 `returns` 编辑区。可以在面板的**「外部求解器」页**添加，或把其中的 `agentDeclaration` JSON 粘给会话，由智能体调用 `external_solver_add`。

## 3. 重启宿主

声明在引擎启动时编译，因此求解器要在宿主重启后才存在。重载页面后，`echo_http` 就会出现在智能体可调用的求解器之中。

## 4. 调用它

让智能体调用 `echo_http`，携带 `message`、可选的数字数组 `values` 与可选的 `flag`。引擎把结果存入具名 target 槽，`get` 返回的正是对端回显的内容：

```json
{
  "message": { "type": "string", "value": "round trip ok" },
  "values": { "type": "array", "value": [
    { "type": "number", "value": 1, "kind": "none" },
    { "type": "number", "value": 2.5, "kind": "none" }
  ] },
  "flag": { "type": "boolean", "value": true }
}
```

「记录」页会在轨迹中并排显示调用参数与回显结果。

## 5. 脱离插件自检对端

```bash
curl -s -X POST http://127.0.0.1:8787/ \
  -H 'content-type: application/json' \
  -d '{"requestId":"manual-1","args":{"message":{"type":"string","value":"hi"},"flag":{"type":"boolean","value":true}}}'
```

```json
{ "requestId": "manual-1", "result": { "type": "object", "value": { "message": { "type": "string", "value": "hi" }, "flag": { "type": "boolean", "value": true } } } }
```

## 协议参考

| 情形 | 结果 |
|---|---|
| 对端没在运行 | 收据读作 `fetch failed: connect ECONNREFUSED 127.0.0.1:8787`，据此可把「对端没跑」与「端点写错」或「信封损坏」区分开 |
| 响应的 `requestId` 不匹配 | 宿主拒绝该响应 |
| 请求体不是 JSON | 对端应答 `{ "error": "…" }` |
| 计算失败 | 对端应答 `{ "requestId": "…", "error": "…" }`，宿主将其提升为 `EXTERNAL_ERROR` |

声明语法、类型化值形状与信封定义见[引擎手册](../docs/engine.zh-CN.md#6-外部求解器)，实现见 `src/engine/external-solvers.ts` 与 `src/engine/external.ts`。
