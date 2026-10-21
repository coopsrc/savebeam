# 设置页输入导致白屏的修复验证

日期：2026-10-21。

## 触发与原因

Cookie 授权复选框、自定义组件路径和默认下载目录的事件处理器，在 React 函数式状态更新回调中读取 `event.currentTarget`。React 在事件处理结束后清空该字段；更新回调再次执行时，读取 `checked` 或 `value` 抛出异常，未捕获的渲染错误使应用根节点被清空。

三处处理器现均在事件处理期间提取布尔值或字符串，状态更新回调仅使用提取出的值。

## 浏览器验证

使用真实 Chrome、项目 Vite 开发构建及 React StrictMode。Tauri IPC 由测试提供固定响应；不访问真实浏览器 Cookie，也不修改应用实际设置。

| 场景                   | 修复前                                                               | 修复后                                                     |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 点击 Cookie 授权复选框 | `Cannot read properties of null (reading 'checked')`；根节点文本为空 | 勾选及取消正常，页面保留；保存参数 `accessConfirmed: true` |
| 编辑默认下载目录       | `Cannot read properties of null (reading 'value')`；根节点文本为空   | 输入、继续编辑正常；无页面异常                             |
| 编辑组件自定义路径     | `Cannot read properties of null (reading 'value')`；根节点文本为空   | 输入、继续编辑正常；无页面异常                             |

上述三项修复后均未捕获到浏览器 `pageerror`。输入验证使用自动化文本输入，不涉及读取系统剪贴板。

## 静态检查

- 前端 ESLint、TypeScript/Vite 构建、格式检查和 Git 差异检查通过。
- 本次修改仅涉及前端事件处理；未修改 Rust 或 Cookie 读取后端。
