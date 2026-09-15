# 注册示例求解器

对端必须先行启动（`node src/echo.ts http --port 8787`）。在插件的记录面板中打开**「外部求解器」页**，点击**「添加外部求解器」**，然后按下表填写对话框。更改在宿主重启后生效。

另一种方式是：在会话中让智能体注册该求解器，并把该求解器的 `agentDeclaration` JSON 原文粘贴给它；智能体会调用 `external_solver_add`。

## echo_http

| 对话框字段 | 填写 | 说明 |
|---|---|---|
| 名称 | `echo_http` | 智能体将调用的 solver 名称；小写字母开头，仅 `a-z0-9_` |
| URL | `http://127.0.0.1:8787/` | 唯一的传输方式：宿主向该地址 POST 类型化信封；`--port` 可覆盖 8787 |
| 超时（毫秒） | `10000` | 可选；留空保持默认 30000 |
| 描述 | `Echo peer over http (ElectroLab external-solver manual test): returns every parameter it receives, verbatim` | 智能体据此判断何时调用该 solver |
| 启用 | 开 | 停用的声明会被保留，但不会被注册 |

参数——每一行先点击一次「添加参数」：

| 名称 | 类型 | 必填 | 其他字段 |
|---|---|---|---|
| `message` | string | 是 | 说明：`a text echoed back verbatim` |
| `values` | array | 否 | 数组元素：`quantity` · 数量类别：`none` · 说明：`values echoed back verbatim` |
| `flag` | boolean | 否 | 说明：`a boolean echoed back verbatim` |

Returns——**Returns** 区域（必填；没有 Returns 的声明永远不会注册）：类型选 `object`，然后为每个返回键添加一个字段：

| 字段名 | 类型 | 其他字段 |
|---|---|---|
| `message` | string | |
| `values` | array | 数组元素：`quantity` · 数量类别：`none` |
| `flag` | boolean | |

`agentDeclaration`：

```json
{
  "name": "echo_http",
  "description": "Echo peer over http (ElectroLab external-solver manual test): returns every parameter it receives, verbatim",
  "enabled": true,
  "parameters": {
    "message": { "type": "string", "description": "a text echoed back verbatim", "required": true },
    "values": { "type": "array", "items": { "type": "quantity", "kind": "none" }, "description": "values echoed back verbatim" },
    "flag": { "type": "boolean", "description": "a boolean echoed back verbatim" }
  },
  "returns": {
    "type": "object",
    "fields": {
      "message": { "type": "string" },
      "values": { "type": "array", "items": { "type": "quantity", "kind": "none" } },
      "flag": { "type": "boolean" }
    }
  },
  "transport": "http",
  "transportOptions": { "url": "http://127.0.0.1:8787/" },
  "timeoutMs": 10000
}
```

## 线协议速览

```
request:  { "requestId": "…", "args": { "message": { "type": "string", "value": "hi" }, … } }
response: { "requestId": "…", "result": { "type": "object", "value": { "message": { "type": "string", "value": "hi" }, … } } }
failure:  { "requestId": "…", "error": "…" }
```

对端把收到的每个参数都以类型化值形式回显在一个对象结果里；不是类型化值的值会被包成字符串。完整协议见插件引擎源码（`src/engine/external-solvers.ts` 与 `src/engine/external.ts`）。
