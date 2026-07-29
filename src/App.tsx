import { ChangeEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  formatJson,
  getJsonStats,
  minifyAndEscapeJson,
  minifyJson,
  parseJson,
  queryJsonPath,
  sortJsonKeys,
} from "./lib/jsonTools";
import "./App.css";

type ResultView = "text" | "tree";
type Theme = "light" | "dark";
type ToastTone = "success" | "error";
type Toast = { message: string; tone: ToastTone } | null;
type WindowAction = "minimize" | "toggleMaximize" | "close";
type ResizeDirection = "North" | "NorthEast" | "East" | "SouthEast" | "South" | "SouthWest" | "West" | "NorthWest";
type JsonPathQueryState =
  | { status: "idle" }
  | { status: "success"; result: string; count: number }
  | { status: "error"; message: string };
type JsonDocument = {
  id: string;
  name: string;
  source: string;
  result: string;
  resultView: ResultView;
};

const themeStorageKey = "json-workbench-theme";
const fontSizeStorageKey = "json-workbench-font-size";
const fontSizeDefaultVersionStorageKey = "json-workbench-font-size-default-version";
const fontSizeDefaultVersion = "22";
const minEditorFontSize = 11;
const maxEditorFontSize = 26;
const defaultEditorFontSize = 22;
const resizeHandles: Array<{ direction: ResizeDirection; position: string }> = [
  { direction: "North", position: "north" },
  { direction: "NorthEast", position: "north-east" },
  { direction: "East", position: "east" },
  { direction: "SouthEast", position: "south-east" },
  { direction: "South", position: "south" },
  { direction: "SouthWest", position: "south-west" },
  { direction: "West", position: "west" },
  { direction: "NorthWest", position: "north-west" },
];

const sampleJson = `{
  "store": {
    "name": "JSON Workbench",
    "book": [
      {
        "title": "深入理解 JSON",
        "author": "Alex",
        "price": 39.9,
        "available": true
      },
      {
        "title": "JSONPath 实战",
        "author": "Morgan",
        "price": 49.9,
        "available": false
      }
    ]
  }
}`;

function createJsonDocument(name: string, content = ""): JsonDocument {
  return {
    id: window.crypto.randomUUID(),
    name,
    source: content,
    result: content,
    resultView: "text",
  };
}

function JsonTreeNode({ label, value, depth = 0 }: { label?: string; value: unknown; depth?: number }) {
  const isObject = typeof value === "object" && value !== null;
  const entries = isObject ? Object.entries(value as Record<string, unknown>) : [];
  const typeName = Array.isArray(value) ? "array" : typeof value;

  if (!isObject) {
    return (
      <div className="tree-leaf">
        {label !== undefined && <span className="tree-key">{label}: </span>}
        <span className={`tree-value tree-${value === null ? "null" : typeName}`}>
          {typeof value === "string" ? `"${value}"` : String(value)}
        </span>
      </div>
    );
  }

  return (
    <details className="tree-branch" open={depth < 2}>
      <summary>
        {label !== undefined && <span className="tree-key">{label}: </span>}
        <span className="tree-meta">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </summary>
      <div className="tree-children">
        {entries.map(([key, childValue]) => (
          <JsonTreeNode key={key} label={key} value={childValue} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

function App() {
  const appWindow = useMemo(() => isTauri() ? getCurrentWindow() : null, []);
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem(themeStorageKey);
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [editorFontSize, setEditorFontSize] = useState(() => {
    const savedFontSizeValue = window.localStorage.getItem(fontSizeStorageKey);
    const savedFontSize = Number(savedFontSizeValue);
    const shouldMigratePreviousDefault = savedFontSizeValue === "13"
      && window.localStorage.getItem(fontSizeDefaultVersionStorageKey) !== fontSizeDefaultVersion;
    if (shouldMigratePreviousDefault) {
      return defaultEditorFontSize;
    }
    return Number.isInteger(savedFontSize) && savedFontSize >= minEditorFontSize && savedFontSize <= maxEditorFontSize
      ? savedFontSize
      : defaultEditorFontSize;
  });
  const [documents, setDocuments] = useState<JsonDocument[]>(() => [createJsonDocument("未命名.json")]);
  const [activeDocumentId, setActiveDocumentId] = useState(() => documents[0].id);
  const [jsonPath, setJsonPath] = useState("");
  const [indentSize, setIndentSize] = useState<2 | 4>(2);
  const [liveSync, setLiveSync] = useState(true);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const nextUntitledNumberRef = useRef(2);

  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? documents[0];
  const { source, result, resultView, name: currentFile } = activeDocument;

  const parsedSource = useMemo(() => parseJson(source), [source]);
  const parsedResult = useMemo(() => parseJson(result), [result]);
  const sourceStats = useMemo(() => getJsonStats(source), [source]);
  const resultStats = useMemo(() => getJsonStats(result), [result]);
  const jsonPathQuery = useMemo<JsonPathQueryState>(() => {
    if (!jsonPath.trim()) {
      return { status: "idle" };
    }
    try {
      const queryResult = queryJsonPath(source, jsonPath);
      return {
        status: "success",
        result: JSON.stringify(queryResult, null, indentSize),
        count: queryResult.length,
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "JSONPath 查询失败",
      };
    }
  }, [indentSize, jsonPath, source]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#fdf6e3" : "#002b36");
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
    window.localStorage.setItem(fontSizeStorageKey, String(editorFontSize));
    window.localStorage.setItem(fontSizeDefaultVersionStorageKey, fontSizeDefaultVersion);
  }, [editorFontSize]);

  useEffect(() => {
    if (!appWindow) {
      return;
    }

    let active = true;
    let unlisten: (() => void) | undefined;
    const syncMaximizedState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (active) {
          setIsWindowMaximized(maximized);
        }
      } catch {
        // Keep the last known state if the window manager cannot report it.
      }
    };

    void syncMaximizedState();
    void appWindow.onResized(() => void syncMaximizedState()).then((stopListening) => {
      if (active) {
        unlisten = stopListening;
      } else {
        stopListening();
      }
    }).catch(() => undefined);

    return () => {
      active = false;
      unlisten?.();
    };
  }, [appWindow]);

  useEffect(() => {
    if (!jsonPath.trim() && !liveSync) {
      return;
    }
    const nextResult = jsonPath.trim()
      ? jsonPathQuery.status === "success" ? jsonPathQuery.result : ""
      : source;
    setDocuments((currentDocuments) => currentDocuments.map((document) => {
      if (document.id !== activeDocumentId || document.source !== source) {
        return document;
      }
      if (document.result === nextResult && document.resultView === "text") {
        return document;
      }
      return { ...document, result: nextResult, resultView: "text" };
    }));
  }, [activeDocumentId, jsonPath, jsonPathQuery, liveSync, source]);

  function updateDocument(documentId: string, updater: (document: JsonDocument) => JsonDocument) {
    setDocuments((currentDocuments) => currentDocuments.map((document) => (
      document.id === documentId ? updater(document) : document
    )));
  }

  function updateActiveDocument(updater: (document: JsonDocument) => JsonDocument) {
    updateDocument(activeDocumentId, updater);
  }

  function addDocument(name?: string, content = "") {
    const documentName = name ?? `未命名-${nextUntitledNumberRef.current++}.json`;
    const newDocument = createJsonDocument(documentName, content);
    setDocuments((currentDocuments) => [...currentDocuments, newDocument]);
    setActiveDocumentId(newDocument.id);
  }

  function closeDocument(documentId: string) {
    const closingIndex = documents.findIndex((document) => document.id === documentId);
    if (closingIndex < 0) {
      return;
    }
    if (documents.length === 1) {
      const replacement = createJsonDocument(`未命名-${nextUntitledNumberRef.current++}.json`);
      setDocuments([replacement]);
      setActiveDocumentId(replacement.id);
      return;
    }
    const remainingDocuments = documents.filter((document) => document.id !== documentId);
    setDocuments(remainingDocuments);
    if (documentId === activeDocumentId) {
      setActiveDocumentId(remainingDocuments[Math.min(closingIndex, remainingDocuments.length - 1)].id);
    }
  }

  function showToast(message: string, tone: ToastTone = "success") {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }

  async function runWindowAction(action: WindowAction) {
    if (!appWindow) {
      return;
    }
    try {
      await appWindow[action]();
      if (action === "toggleMaximize") {
        setIsWindowMaximized(await appWindow.isMaximized());
      }
    } catch {
      showToast("窗口操作失败", "error");
    }
  }

  function startWindowResize(direction: ResizeDirection, event: MouseEvent<HTMLDivElement>) {
    if (!appWindow || event.button !== 0) {
      return;
    }
    event.preventDefault();
    void appWindow.startResizeDragging(direction).catch(() => showToast("窗口缩放失败", "error"));
  }

  function runTransform(transform: (input: string) => string, successMessage: string) {
    try {
      const transformedResult = transform(source);
      updateActiveDocument((document) => ({ ...document, result: transformedResult, resultView: "text" }));
      showToast(successMessage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "处理失败", "error");
    }
  }

  async function copyTransformedResult(transform: (input: string) => string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(transform(source));
      showToast(successMessage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "复制失败", "error");
    }
  }

  function updateSource(value: string) {
    updateActiveDocument((document) => ({
      ...document,
      source: value,
      ...(liveSync && !jsonPath.trim() ? { result: value, resultView: "text" as const } : {}),
    }));
  }

  function updateResult(value: string) {
    updateActiveDocument((document) => ({
      ...document,
      result: value,
      ...(liveSync ? { source: value } : {}),
    }));
  }

  function toggleLiveSync() {
    const nextValue = !liveSync;
    setLiveSync(nextValue);
    if (nextValue && !jsonPath.trim()) {
      updateActiveDocument((document) => ({ ...document, result: document.source, resultView: "text" }));
      showToast("实时双向同步已开启");
    } else if (nextValue) {
      showToast("实时双向同步已开启，JSONPath 查询优先");
    } else {
      showToast("实时双向同步已关闭");
    }
  }

  function handleFormat() {
    runTransform((input) => formatJson(input, indentSize), "JSON 已格式化");
  }

  function applyResultToSource() {
    if (!result) {
      showToast("当前没有可应用的结果", "error");
      return;
    }
    updateActiveDocument((document) => ({ ...document, source: result }));
    showToast("结果已应用到输入区");
  }

  async function copyResult() {
    if (!result) {
      showToast("当前没有可复制的结果", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(result);
      showToast("结果已复制");
    } catch {
      showToast("无法访问剪贴板", "error");
    }
  }

  async function openFile() {
    try {
      if (isTauri()) {
        const selectedPath = await open({
          multiple: false,
          filters: [{ name: "JSON 或文本", extensions: ["json", "jsonl", "txt"] }],
        });
        if (typeof selectedPath === "string") {
          const fileContent = await readTextFile(selectedPath);
          addDocument(selectedPath.split(/[\\/]/).pop() ?? "未命名.json", fileContent);
          showToast("文件已打开");
        }
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "文件打开失败", "error");
    }
  }

  async function handleBrowserFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }
    addDocument(selectedFile.name, await selectedFile.text());
    event.target.value = "";
    showToast("文件已打开");
  }

  async function saveResult() {
    const content = result || source;
    const documentId = activeDocument.id;
    const documentName = currentFile;
    try {
      if (isTauri()) {
        const selectedPath = await save({
          defaultPath: documentName,
          filters: [{ name: "JSON", extensions: ["json"] }, { name: "文本", extensions: ["txt"] }],
        });
        if (selectedPath) {
          await writeTextFile(selectedPath, content);
          const savedName = selectedPath.split(/[\\/]/).pop() ?? documentName;
          updateDocument(documentId, (document) => ({ ...document, name: savedName }));
          showToast("文件已保存");
        }
      } else {
        const blobUrl = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
        const downloadLink = document.createElement("a");
        downloadLink.href = blobUrl;
        downloadLink.download = documentName;
        downloadLink.click();
        URL.revokeObjectURL(blobUrl);
        showToast("文件已下载");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "文件保存失败", "error");
    }
  }

  function clearWorkspace() {
    updateActiveDocument((document) => ({
      ...document,
      name: document.name.startsWith("未命名") ? document.name : `未命名-${nextUntitledNumberRef.current++}.json`,
      source: "",
      result: "",
      resultView: "text",
    }));
    showToast("工作区已清空");
  }

  function handleShortcut(event: KeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    const shortcutKey = event.key.toLowerCase();
    if (!event.shiftKey && shortcutKey === "n") {
      event.preventDefault();
      addDocument();
    }
    if (!event.shiftKey && shortcutKey === "w") {
      event.preventDefault();
      closeDocument(activeDocumentId);
    }
    if (event.shiftKey && shortcutKey === "f") {
      event.preventDefault();
      handleFormat();
    }
    if (shortcutKey === "s") {
      event.preventDefault();
      void saveResult();
    }
    if (shortcutKey === "o") {
      event.preventDefault();
      void openFile();
    }
  }

  return (
    <main className="app-shell" onKeyDown={handleShortcut}>
      <section className={`document-tabs-bar ${appWindow ? "tauri-titlebar" : ""}`}>
        <div className="document-tabs" role="tablist" aria-label="JSON 文件标签页">
          {documents.map((document) => (
            <div className={`document-tab ${document.id === activeDocumentId ? "active" : ""}`} key={document.id}>
              <button
                className="document-tab-select"
                role="tab"
                aria-selected={document.id === activeDocumentId}
                title={document.name}
                onClick={() => setActiveDocumentId(document.id)}
              >
                <span className="document-tab-icon" aria-hidden="true">{'{ }'}</span>
                <span className="document-tab-name">{document.name}</span>
              </button>
              <button
                className="document-tab-close"
                aria-label={`关闭 ${document.name}`}
                title="关闭标签页（Ctrl+W 关闭当前页）"
                onClick={() => closeDocument(document.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="new-document-button" title="新建 JSON 标签页（Ctrl+N）" onClick={() => addDocument()}>
          <span aria-hidden="true">＋</span>
          新建
        </button>
        {appWindow && (
          <>
            <div
              className="window-drag-region"
              data-tauri-drag-region
              title="拖动窗口"
              onDoubleClick={() => void runWindowAction("toggleMaximize")}
            />
            <div className="window-controls" aria-label="窗口控制">
              <button
                className="window-control-button"
                aria-label="最小化窗口"
                title="最小化"
                onClick={() => void runWindowAction("minimize")}
              >
                <span aria-hidden="true">−</span>
              </button>
              <button
                className="window-control-button"
                aria-label={isWindowMaximized ? "还原窗口" : "最大化窗口"}
                title={isWindowMaximized ? "还原" : "最大化"}
                onClick={() => void runWindowAction("toggleMaximize")}
              >
                <span
                  className={`window-state-icon ${isWindowMaximized ? "restore" : "maximize"}`}
                  aria-hidden="true"
                />
              </button>
              <button
                className="window-control-button close-window-button"
                aria-label="关闭窗口"
                title="关闭"
                onClick={() => void runWindowAction("close")}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </>
        )}
      </section>

      <section className="toolbar">
        <div className="toolbar-group">
          <button onClick={handleFormat}>格式化</button>
          <button onClick={() => void copyTransformedResult(minifyJson, "压缩结果已复制")}>压缩并复制</button>
          <button onClick={() => void copyTransformedResult(minifyAndEscapeJson, "压缩转义结果已复制")}>压缩转义并复制</button>
          <button onClick={() => runTransform((input) => sortJsonKeys(input, indentSize), "键名已排序")}>键排序</button>
          <label className="indent-control">
            缩进
            <select value={indentSize} onChange={(event) => setIndentSize(Number(event.target.value) as 2 | 4)}>
              <option value={2}>2 空格</option>
              <option value={4}>4 空格</option>
            </select>
          </label>
        </div>
        <div className="toolbar-group toolbar-right">
          <input ref={fileInputRef} type="file" accept=".json,.jsonl,.txt,application/json,text/plain" hidden onChange={handleBrowserFile} />
          <div className="font-size-control" role="group" aria-label="编辑区字号">
            <span className="font-size-label">字号</span>
            <button
              aria-label="减小编辑区字号"
              title="减小字号"
              disabled={editorFontSize <= minEditorFontSize}
              onClick={() => setEditorFontSize((fontSize) => Math.max(minEditorFontSize, fontSize - 1))}
            >
              A−
            </button>
            <output aria-live="polite">{editorFontSize}px</output>
            <button
              aria-label="增大编辑区字号"
              title="增大字号"
              disabled={editorFontSize >= maxEditorFontSize}
              onClick={() => setEditorFontSize((fontSize) => Math.min(maxEditorFontSize, fontSize + 1))}
            >
              A+
            </button>
          </div>
          <button onClick={() => updateSource(sampleJson)}>载入示例</button>
          <button onClick={clearWorkspace}>清空</button>
          <button
            className="theme-toggle"
            aria-label={`切换到${theme === "light" ? "深色" : "浅色"}主题`}
            title={`切换到 Solarized ${theme === "light" ? "Dark" : "Light"}`}
            onClick={() => setTheme((currentTheme) => currentTheme === "light" ? "dark" : "light")}
          >
            <span className="theme-icon" aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
            <span className="theme-label">{theme === "light" ? "深色" : "浅色"}</span>
          </button>
          <button className="ghost-button" onClick={() => void openFile()}>打开</button>
          <button className="primary-button" onClick={() => void saveResult()}>保存结果</button>
        </div>
      </section>

      <section className="workspace">
        <article className="editor-panel input-panel">
          <div className="panel-header">
            <div>
              <span className="panel-title">输入</span>
              <span className="file-name">{currentFile}</span>
            </div>
            <div className={`validation-badge ${parsedSource.ok ? "valid" : "invalid"}`}>
              <span className="status-dot" />
              {parsedSource.ok ? "JSON 有效" : "JSON 无效"}
            </div>
          </div>
          <textarea
            className="code-editor"
            value={source}
            onChange={(event) => updateSource(event.target.value)}
            placeholder="在这里粘贴 JSON，或打开本地文件…"
            spellCheck={false}
          />
          <div className={`inline-jsonpath ${jsonPathQuery.status === "error" ? "invalid" : ""}`}>
            <label htmlFor="jsonpath-input">JSONPath</label>
            <input
              id="jsonpath-input"
              value={jsonPath}
              aria-invalid={jsonPathQuery.status === "error"}
              onChange={(event) => setJsonPath(event.target.value)}
              placeholder="输入路径后自动查询，例如 $.store.book[*].title"
              spellCheck={false}
            />
            <span
              className={`jsonpath-status ${jsonPathQuery.status}`}
              title={jsonPathQuery.status === "error" ? jsonPathQuery.message : undefined}
            >
              {jsonPathQuery.status === "success" && `${jsonPathQuery.count} 项`}
              {jsonPathQuery.status === "error" && "路径错误"}
              {jsonPathQuery.status === "idle" && "自动查询"}
            </span>
          </div>
          <footer className="panel-footer">
            <span>{sourceStats.lines} 行</span>
            <span>{sourceStats.characters.toLocaleString()} 字符</span>
            <span>{sourceStats.bytesLabel}</span>
            {!parsedSource.ok && <span className="error-location">{parsedSource.error.message}</span>}
          </footer>
        </article>

        <div className="panel-divider">
          <button title="将结果应用到输入区" onClick={applyResultToSource}>←</button>
        </div>

        <article className="editor-panel result-panel">
          <div className="panel-header">
            <div className="result-heading">
              <span className="panel-title">结果</span>
              <div className="view-switcher">
                <button
                  className={resultView === "text" ? "active" : ""}
                  onClick={() => updateActiveDocument((document) => ({ ...document, resultView: "text" }))}
                >
                  文本
                </button>
                <button
                  className={resultView === "tree" ? "active" : ""}
                  disabled={!parsedResult.ok}
                  onClick={() => updateActiveDocument((document) => ({ ...document, resultView: "tree" }))}
                >
                  树形
                </button>
              </div>
            </div>
            <div className="result-actions">
              <label className="sync-toggle" title="手动编辑任一侧时同步到另一侧">
                <input type="checkbox" checked={liveSync} onChange={toggleLiveSync} />
                <span className="switch-track" />
                双向同步
              </label>
              <button className="copy-button" onClick={() => void copyResult()}>复制</button>
            </div>
          </div>
          {resultView === "tree" && parsedResult.ok ? (
            <div className="tree-view"><JsonTreeNode value={parsedResult.value} /></div>
          ) : (
            <textarea className="code-editor result-editor" value={result} onChange={(event) => updateResult(event.target.value)} placeholder="处理结果会显示在这里…" spellCheck={false} />
          )}
          <footer className="panel-footer">
            <span>{resultStats.lines} 行</span>
            <span>{resultStats.characters.toLocaleString()} 字符</span>
            <span>{resultStats.bytesLabel}</span>
          </footer>
        </article>
      </section>

      <footer className="app-footer">
        <span>所有数据仅在本机处理</span>
        <span>快捷键：Ctrl+N 新建 · Ctrl+W 关闭 · Ctrl+Shift+F 格式化 · Ctrl+O 打开 · Ctrl+S 保存</span>
      </footer>

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}

      {appWindow && resizeHandles.map(({ direction, position }) => (
        <div
          className={`window-resize-handle ${position}`}
          key={direction}
          aria-hidden="true"
          onMouseDown={(event) => startWindowResize(direction, event)}
        />
      ))}
    </main>
  );
}

export default App;
