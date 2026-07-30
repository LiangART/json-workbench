import { json } from "@codemirror/lang-json";
import { codeFolding, foldGutter, foldKeymap, HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, MatchDecorator, placeholder, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { getJsonFoldSummary, type JsonFoldSummary } from "../lib/jsonFold";
import { jsonIndentSize } from "../lib/jsonTools";

type ResultJsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
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

const foldingExtensions = [
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

export function ResultJsonEditor({ value, onChange }: ResultJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const isApplyingExternalValueRef = useRef(false);
  onChangeRef.current = onChange;

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

  return <div className="result-code-editor-shell" ref={containerRef} />;
}
