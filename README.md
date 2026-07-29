# JSON Workbench

面向 Ubuntu 的离线 JSON 桌面工具，基于 Tauri 2、React 和 TypeScript。

## 功能

- JSON 格式化、压缩、校验和递归键排序
- 标准 JSONPath 查询与结果预览
- JSON 字符串转义、反转义、压缩并转义
- Unicode 转义与反转义
- 文本和树形结果视图
- 本地文件打开、保存和浏览器模式下载
- 行数、字符数和文件大小统计

所有数据都在本机处理，不会上传到网络。

## 开发

安装 Ubuntu 的 Tauri 系统依赖和 Rust 工具链后运行：

```bash
npm install
npm run tauri dev
```

仅启动浏览器开发模式：

```bash
npm run dev
```

## 测试与构建

```bash
npm test
npm run build
npm run tauri build
```

桌面构建产物位于 `src-tauri/target/release/bundle`。
