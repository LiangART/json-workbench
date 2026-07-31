import { json } from "@codemirror/lang-json";
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorState, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type DecorationSet,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { buildJsonFoldIndex, getJsonFoldSummary, type JsonFoldRange, type JsonFoldSummary } from "../lib/jsonFold";
import { jsonIndentSize } from "../lib/jsonTools";

type ResultJsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
  searchRequest: number | null;
  onSearchRequestHandled: () => void;
};

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--syntax-key)", fontWeight: "700" },
  { tag: tags.string, color: "var(--syntax-string)", fontWeight: "700" },
  { tag: tags.number, color: "var(--syntax-number)", fontWeight: "700" },
  { tag: tags.bool, color: "var(--syntax-boolean)", fontWeight: "700" },
  { tag: tags.null, color: "var(--syntax-null)", fontWeight: "700" },
]);

const linkMatcher = new MatchDecorator({
  regexp: /"https?:(?:\\\/|\/){2}[^"\n]*"/gi,
  decoration: Decoration.mark({ class: "cm-json-link" }),
});

const linkHighlighting = ViewPlugin.fromClass(class {
  decorations = Decoration.none;

  constructor(view: EditorView) {
    this.decorations = linkMatcher.createDeco(view);
  }

  update(update: ViewUpdate) {
    this.decorations = linkMatcher.updateDeco(update, this.decorations);
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function createIndentGuideDecorations(view: EditorView): DecorationSet {
  const decorations = [];
  const decoratedLines = new Set<number>();

  for (const visibleRange of view.visibleRanges) {
    let position = visibleRange.from;
    while (position <= visibleRange.to) {
      const line = view.state.doc.lineAt(position);
      if (!decoratedLines.has(line.number)) {
        const leadingSpaceCount = line.text.match(/^ +/)?.[0].length ?? 0;
        for (let offset = 0; offset + jsonIndentSize <= leadingSpaceCount; offset += jsonIndentSize) {
          const level = offset / jsonIndentSize + 1;
          decorations.push(Decoration.mark({
            class: "cm-indent-guide",
            attributes: { "data-indent-level": String(level) },
          }).range(line.from + offset, line.from + offset + jsonIndentSize));
        }
        decoratedLines.add(line.number);
      }
      if (line.to >= visibleRange.to) {
        break;
      }
      position = line.to + 1;
    }
  }

  return Decoration.set(decorations, true);
}

const indentationGuides = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = createIndentGuideDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = createIndentGuideDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function createFoldMarker(isOpen: boolean) {
  const marker = document.createElement("span");
  marker.className = `json-fold-marker ${isOpen ? "expanded" : "collapsed"}`;
  marker.textContent = isOpen ? "−" : "+";
  marker.title = isOpen ? "收起" : "展开";
  marker.setAttribute("aria-label", marker.title);
  return marker;
}

const foldIndexCache = new WeakMap<Text, ReadonlyMap<number, JsonFoldRange>>();

function getJsonFoldRange(state: EditorState, lineStart: number): JsonFoldRange | null {
  let foldIndex = foldIndexCache.get(state.doc);
  if (!foldIndex) {
    foldIndex = buildJsonFoldIndex(state.doc.toString());
    foldIndexCache.set(state.doc, foldIndex);
  }
  return foldIndex.get(lineStart) ?? null;
}

const foldingExtensions = [
  foldService.of((state, lineStart) => getJsonFoldRange(state, lineStart)),
  foldGutter({ markerDOM: createFoldMarker }),
  codeFolding({
    preparePlaceholder(state, range) {
      return getJsonFoldSummary(state.doc.toString(), range.from, range.to);
    },
    placeholderDOM(_view, onClick, summary: JsonFoldSummary) {
      const marker = document.createElement("span");
      const summaryText = summary.type === "array" ? `${summary.count} 个对象` : `${summary.count} 行`;
      marker.className = "json-fold-placeholder";
      marker.textContent = `… ${summaryText} …`;
      marker.title = "展开";
      marker.setAttribute("aria-label", `展开隐藏的 ${summaryText}`);
      marker.addEventListener("click", onClick);
      return marker;
    },
  }),
  keymap.of(foldKeymap),
];

class ResultSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly matchCountField: HTMLOutputElement;
  private readonly caseField: HTMLInputElement;
  private readonly wordField: HTMLInputElement;
  private matchCountTimer: number | undefined;

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.searchField = document.createElement("input");
    this.searchField.className = "result-search-input";
    this.searchField.type = "search";
    this.searchField.value = this.query.search;
    this.searchField.placeholder = "在结果中查询";
    this.searchField.setAttribute("aria-label", "查询右侧 JSON 结果");
    this.searchField.setAttribute("main-field", "true");
    this.searchField.spellcheck = false;
    this.searchField.addEventListener("input", this.commit);

    this.matchCountField = document.createElement("output");
    this.matchCountField.className = "result-search-count";
    this.matchCountField.textContent = "0 项";
    this.matchCountField.setAttribute("aria-live", "polite");

    this.caseField = this.createOption("区分大小写", this.query.caseSensitive);
    this.wordField = this.createOption("全字匹配", this.query.wholeWord);

    this.dom = document.createElement("div");
    this.dom.className = "result-search-panel";
    this.dom.append(
      this.searchField,
      this.matchCountField,
      this.createButton("↑", "上一个匹配项", () => findPrevious(this.view)),
      this.createButton("↓", "下一个匹配项", () => findNext(this.view)),
      this.caseField.parentElement!,
      this.wordField.parentElement!,
      this.createButton("×", "关闭查询", () => closeSearchPanel(this.view), "result-search-close"),
    );
    this.dom.addEventListener("keydown", this.handleKeyDown);
    this.scheduleMatchCount();
  }

  mount() {
    this.searchField.select();
  }

  update(update: ViewUpdate) {
    const nextQuery = getSearchQuery(update.state);
    const queryChanged = !nextQuery.eq(this.query);
    if (queryChanged) {
      this.query = nextQuery;
      this.searchField.value = nextQuery.search;
      this.caseField.checked = nextQuery.caseSensitive;
      this.wordField.checked = nextQuery.wholeWord;
    }
    if (queryChanged || update.docChanged) {
      this.scheduleMatchCount();
    }
  }

  destroy() {
    window.clearTimeout(this.matchCountTimer);
    this.searchField.removeEventListener("input", this.commit);
    this.caseField.removeEventListener("change", this.commit);
    this.wordField.removeEventListener("change", this.commit);
    this.dom.removeEventListener("keydown", this.handleKeyDown);
  }

  private readonly commit = () => {
    const nextQuery = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      wholeWord: this.wordField.checked,
    });
    if (!nextQuery.eq(this.query)) {
      this.query = nextQuery;
      this.view.dispatch({ effects: setSearchQuery.of(nextQuery) });
      this.scheduleMatchCount();
    }
  };

  private scheduleMatchCount() {
    window.clearTimeout(this.matchCountTimer);
    if (!this.query.valid) {
      this.matchCountField.textContent = "0 项";
      return;
    }

    this.matchCountField.textContent = "统计中…";
    const query = this.query;
    const state = this.view.state;
    this.matchCountTimer = window.setTimeout(() => {
      if (!query.eq(this.query) || state.doc !== this.view.state.doc) {
        return;
      }
      const matches = query.getCursor(state);
      let count = 0;
      while (!matches.next().done) {
        count += 1;
      }
      this.matchCountField.textContent = `${count.toLocaleString()} 项`;
    }, 80);
  }

  private readonly handleKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(this.view);
      return;
    }
    if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    }
  };

  private createOption(labelText: string, checked: boolean) {
    const label = document.createElement("label");
    label.className = "result-search-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", this.commit);
    label.append(input, labelText);
    return input;
  }

  private createButton(label: string, title: string, command: () => boolean, className = "") {
    const button = document.createElement("button");
    button.className = `result-search-button ${className}`.trim();
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => {
      command();
      if (title !== "关闭查询") {
        this.searchField.focus();
      }
    });
    return button;
  }
}

function createResultSearchPanel(view: EditorView) {
  return new ResultSearchPanel(view);
}

export function ResultJsonEditor({
  value,
  onChange,
  searchRequest,
  onSearchRequestHandled,
}: ResultJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSearchRequestHandledRef = useRef(onSearchRequestHandled);
  const isApplyingExternalValueRef = useRef(false);
  onChangeRef.current = onChange;
  onSearchRequestHandledRef.current = onSearchRequestHandled;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const editor = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          minimalSetup,
          json(),
          EditorState.tabSize.of(jsonIndentSize),
          indentUnit.of(" ".repeat(jsonIndentSize)),
          ...foldingExtensions,
          search({ top: true, createPanel: createResultSearchPanel }),
          syntaxHighlighting(jsonHighlightStyle),
          indentationGuides,
          linkHighlighting,
          placeholder("处理结果会显示在这里…"),
          EditorView.contentAttributes.of({
            "aria-label": "JSON 处理结果",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isApplyingExternalValueRef.current) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.state.doc.toString() === value) {
      return;
    }

    isApplyingExternalValueRef.current = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
    isApplyingExternalValueRef.current = false;
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (searchRequest === null || !editor) {
      return;
    }
    openSearchPanel(editor);
    onSearchRequestHandledRef.current();
  }, [searchRequest]);

  return <div className="result-code-editor-shell" ref={containerRef} />;
}
