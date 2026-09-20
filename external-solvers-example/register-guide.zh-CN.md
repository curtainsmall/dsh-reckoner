# 注册回显求解器

对端先以 `node src/echo.ts http --port 8787` 启动，然后按下表把每个字段填入面板的 **「外部求解器」表单**。面板在保存时会重新校验；文末同时给出 JSON 形式的同一声明，供智能体使用。

[English](register-guide.md)

## 目录

- [注册回显求解器](#注册回显求解器)
  - [目录](#目录)
  - [基本信息](#基本信息)
  - [参数](#参数)
  - [返回值](#返回值)
  - [传输](#传输)
  - [声明 JSON](#声明-json)
  - [线协议](#线协议)

## 基本信息

| 字段 | 填写 | 说明 |
|---|---|---|
| 名称 | `echo_http` | 智能体调用的求解器 id；小写字母开头，仅 `a-z0-9_` |
| 描述 | `Echo peer over http (Reckoner external-solver manual test): returns every parameter it receives, verbatim` | 智能体据此判断何时调用它 |
| 启用 | 开 | 停用的声明仍留在归档中，但不注册 |

## 参数

| 名称 | 类型 | 必填 | 其他字段 |
|---|---|---|---|
| `message` | string | 是 | 说明：`a text echoed back verbatim` |
| `values` | array | 否 | 数组元素：`complex`；数量类别：`none`；说明：`values echoed back verbatim` |
| `flag` | boolean | 否 | 说明：`a boolean echoed back verbatim` |

量元素有两种写法：

| 元素 | 接受 |
|---|---|
| `complex` | 该 kind 的实数或复数 |
| `number` | 仅实数；复数在参数处被拒绝 |

## 返回值

必填：没有 `returns` 的声明永远不会注册。类型选 `object`，然后为每个返回键添加一个字段：

| 字段名 | 类型 | 其他字段 |
|---|---|---|
| `message` | string | |
| `values` | array | 数组元素：`complex`；数量类别：`none` |
| `flag` | boolean | |

## 传输

| 字段 | 填写 | 说明 |
|---|---|---|
| URL | `http://127.0.0.1:8787/` | 宿主向该地址 POST 类型化信封；`--port` 可改对端端口 |
| 超时（毫秒） | `10000` | 可选；留空保持默认 30000 |

## 声明 JSON

```json
{
  "name": "echo_http",
  "description": "Echo peer over http (Reckoner external-solver manual test): returns every parameter it receives, verbatim",
  "enabled": true,
  "parameters": {
    "message": { "type": "string", "description": "a text echoed back verbatim", "required": true },
    "values": { "type": "array", "items": { "type": "complex", "kind": "none" }, "description": "values echoed back verbatim" },
    "flag": { "type": "boolean", "description": "a boolean echoed back verbatim" }
  },
  "returns": {
    "type": "object",
    "fields": {
      "message": { "type": "string" },
      "values": { "type": "array", "items": { "type": "complex", "kind": "none" } },
      "flag": { "type": "boolean" }
    }
  },
  "transport": "http",
  "transportOptions": { "url": "http://127.0.0.1:8787/" },
  "timeoutMs": 10000
}
```

把这段 JSON 粘给会话，智能体会以 `external_solver_add` 注册它。

## 线协议

| 方向 | 内容 |
|---|---|
| 请求 | `{ "requestId": "…", "args": { "message": { "type": "string", "value": "hi" }, … } }` |
| 结果 | `{ "requestId": "…", "result": { "type": "object", "value": { … } } }` |
| 失败 | `{ "requestId": "…", "error": "…" }` |

对端把每个参数原样放进对象结果中回显；不是类型化值的参数会被包成字符串。实现见 [`src/echo.ts`](src/echo.ts)，完整声明语法见[引擎手册](../docs/engine.zh-CN.md#6-外部求解器)。
