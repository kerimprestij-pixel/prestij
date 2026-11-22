"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Eraser,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  type LucideIcon,
} from "lucide-react";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import { controlClass } from "@/components/panel/ui/styles";
import { cn } from "@/lib/utils";
import Field, { useFieldControl, useFieldLabelId } from "./Field";
import { hrefError } from "./href";
import LinkInput from "./LinkInput";
import { cleanRichHtml, plainTextToHtml, prettyHtml, toEditorHtml } from "./rich-text-clean";

/** Prose styles for the editable area (mirrors the storefront rich text). */
export const richProseClass =
  "text-[0.9375rem] leading-relaxed text-text [&_a]:text-gold-text [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:border-gold [&_blockquote]:ps-4 [&_blockquote]:italic [&_blockquote]:text-text-muted [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:leading-tight [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-heading [&_h3]:text-xl [&_hr]:my-5 [&_hr]:border-border [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-6 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

type BlockKind = "p" | "h2" | "h3" | "blockquote" | "ul" | "ol";
type ToolbarState = { bold: boolean; italic: boolean; link: boolean; block: BlockKind };
const IDLE: ToolbarState = { bold: false, italic: false, link: false, block: "p" };

export type RichTextEditorProps = {
  /** HTML string (sanitized on the server with sanitizeHtml when saved). */
  value: string | null | undefined;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Minimum height of the editable area in rem (default 10). */
  minHeight?: number;
  id?: string;
  lang?: string;
  dir?: "ltr" | "rtl";
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  className?: string;
};

function closestIn(root: HTMLElement, node: Node | null, selector: string): HTMLElement | null {
  let el: Node | null = node;
  while (el && el !== root) {
    if (el.nodeType === Node.ELEMENT_NODE && (el as HTMLElement).matches(selector)) return el as HTMLElement;
    el = el.parentNode;
  }
  return null;
}

/**
 * Rich text without dependencies: contenteditable + toolbar (bold, italic, link, H2/H3, lists, quote,
 * line, clear) and an HTML source view. Pasted content is reduced to the allowed subset. Emits clean HTML.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Metni buraya yazın…",
  disabled = false,
  invalid,
  minHeight = 10,
  id,
  lang,
  dir,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
  className,
}: RichTextEditorProps) {
  const fieldLabelId = useFieldLabelId();
  const control = useFieldControl({ id, invalid: invalid ?? Boolean(ariaInvalid), describedBy });
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [state, setState] = useState<ToolbarState>(IDLE);
  const [source, setSource] = useState<string | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ href: string; editing: boolean } | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const html = value ?? "";
  const empty = !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() && !/<hr/i.test(html);

  // Load external values (initial, reset, locale switch) into the editable area.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || source !== null) return;
    if (html === lastEmitted.current) return;
    editor.innerHTML = toEditorHtml(html);
    lastEmitted.current = html;
  }, [html, source]);

  const emit = (next: string) => {
    lastEmitted.current = next;
    onChange(next);
  };

  const emitFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    emit(cleanRichHtml(editor.innerHTML));
  };

  const refreshState = () => {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) return;
    const node = selection.anchorNode;
    const block = closestIn(editor, node, "h2,h3,blockquote,ul,ol");
    const kind = (block?.tagName.toLowerCase() ?? "p") as BlockKind;
    let bold = false;
    let italic = false;
    try {
      bold = document.queryCommandState("bold");
      italic = document.queryCommandState("italic");
    } catch {
      // queryCommandState can throw in edge cases; the toolbar simply shows "off".
    }
    setState({ bold, italic, link: Boolean(closestIn(editor, node, "a")), block: kind });
  };

  useEffect(() => {
    const onSelection = () => refreshState();
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  });

  const exec = (command: string, arg?: string) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.focus();
    try {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand(command, false, arg);
    } catch {
      return;
    }
    emitFromEditor();
    refreshState();
  };

  const toggleBlock = (tag: "h2" | "h3" | "blockquote") => {
    // Leave a list first, otherwise browsers nest the heading inside the list item.
    if (state.block === "ul") exec("insertUnorderedList");
    else if (state.block === "ol") exec("insertOrderedList");
    exec("formatBlock", state.block === tag ? "<p>" : `<${tag}>`);
  };

  const toggleList = (kind: "ul" | "ol") => {
    // Browsers put a list inside a heading or quote; turn the block into a paragraph first.
    if (state.block === "h2" || state.block === "h3" || state.block === "blockquote") exec("formatBlock", "<p>");
    exec(kind === "ul" ? "insertUnorderedList" : "insertOrderedList");
  };

  const saveSelection = () => {
    const selection = document.getSelection();
    const editor = editorRef.current;
    if (selection && selection.rangeCount > 0 && editor?.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    } else {
      savedRange.current = null;
    }
  };

  const restoreSelection = () => {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection) return;
    editor.focus();
    selection.removeAllRanges();
    if (savedRange.current) selection.addRange(savedRange.current);
    else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.addRange(range);
    }
  };

  const openLinkDialog = () => {
    if (disabled) return;
    saveSelection();
    const editor = editorRef.current;
    const anchor = editor && savedRange.current ? closestIn(editor, savedRange.current.startContainer, "a") : null;
    setLinkDialog({ href: anchor?.getAttribute("href") ?? "", editing: Boolean(anchor) });
  };

  /** Runs after the link dialog has closed: while a modal dialog is open the editor is inert. */
  const afterDialog = (run: () => void) => {
    setLinkDialog(null);
    setTimeout(run, 0);
  };

  const applyLink = (href: string | null) => afterDialog(() => insertLink(href));

  const insertLink = (href: string | null) => {
    restoreSelection();
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection) return;
    const anchor = selection.anchorNode ? closestIn(editor, selection.anchorNode, "a") : null;
    if (anchor) {
      const range = document.createRange();
      range.selectNodeContents(anchor);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!href) {
      exec("unlink");
      return;
    }
    if (selection.isCollapsed && !anchor) {
      const safe = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      exec("insertHTML", `<a href="${safe}">${safe}</a>`);
    } else {
      exec("createLink", href);
    }
  };

  const toggleSource = () => {
    if (source === null) {
      setSource(prettyHtml(cleanRichHtml(editorRef.current?.innerHTML ?? toEditorHtml(html))));
    } else {
      const cleaned = cleanRichHtml(source);
      setSource(null);
      // The layout effect reloads the editor because the value differs from what it last loaded.
      lastEmitted.current = null;
      onChange(cleaned);
    }
  };

  type ToolKey = "bold" | "italic" | "link" | "h2" | "h3" | "ul" | "ol" | "quote" | "hr" | "clear";
  type Tool = { key: ToolKey; label: string; icon: LucideIcon; active?: boolean; shortcut?: string };
  const tools: (Tool | "sep")[] = [
    { key: "bold", label: "Kalın", icon: Bold, active: state.bold, shortcut: "Ctrl+B" },
    { key: "italic", label: "İtalik", icon: Italic, active: state.italic, shortcut: "Ctrl+I" },
    { key: "link", label: "Bağlantı", icon: Link2, active: state.link, shortcut: "Ctrl+K" },
    "sep",
    { key: "h2", label: "Başlık", icon: Heading2, active: state.block === "h2" },
    { key: "h3", label: "Alt başlık", icon: Heading3, active: state.block === "h3" },
    { key: "ul", label: "Madde işaretli liste", icon: List, active: state.block === "ul" },
    { key: "ol", label: "Numaralı liste", icon: ListOrdered, active: state.block === "ol" },
    { key: "quote", label: "Alıntı", icon: Quote, active: state.block === "blockquote" },
    { key: "hr", label: "Ayırıcı çizgi", icon: Minus },
    "sep",
    { key: "clear", label: "Biçimi temizle", icon: Eraser },
  ];
  const runTool = (key: ToolKey) => {
    switch (key) {
      case "bold":
      case "italic":
        exec(key);
        break;
      case "link":
        openLinkDialog();
        break;
      case "h2":
      case "h3":
        toggleBlock(key);
        break;
      case "quote":
        toggleBlock("blockquote");
        break;
      case "ul":
      case "ol":
        toggleList(key);
        break;
      case "hr":
        exec("insertHorizontalRule");
        break;
      case "clear":
        exec("removeFormat");
        exec("formatBlock", "<p>");
        break;
    }
  };
  const buttons = tools.filter((t): t is Tool => t !== "sep");
  const sourceMode = source !== null;

  const onToolbarKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    const all = Array.from(toolbarRef.current?.querySelectorAll<HTMLButtonElement>("button[data-tool]:not(:disabled)") ?? []);
    if (all.length === 0) return;
    event.preventDefault();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
    setFocusIndex(Number(all[next]?.dataset.tool ?? 0));
  };

  const ariaLabelledBy = labelledBy ?? fieldLabelId;

  return (
    <div
      className={cn(
        controlClass,
        "overflow-hidden p-0 focus-within:border-brand focus-within:ring-4 focus-within:ring-gold/20",
        control["aria-invalid"] && "border-[#B3261E] focus-within:ring-[#B3261E]/15 dark:border-[#F28B82]",
        disabled && "bg-surface-2",
        className,
      )}
    >
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Biçimlendirme"
        aria-controls={control.id}
        onKeyDown={onToolbarKey}
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2/50 px-1.5 py-1"
      >
        {tools.map((tool, i) =>
          tool === "sep" ? (
            <span key={`sep-${i}`} aria-hidden className="mx-1 h-5 w-px bg-border" />
          ) : (
            <button
              key={tool.key}
              type="button"
              data-tool={buttons.indexOf(tool)}
              tabIndex={buttons.indexOf(tool) === focusIndex ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setFocusIndex(buttons.indexOf(tool));
                runTool(tool.key);
              }}
              disabled={disabled || sourceMode}
              aria-pressed={tool.active === undefined ? undefined : tool.active}
              title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              className={cn(
                "grid size-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
                tool.active && "bg-surface text-text shadow-[0_1px_2px_rgb(3_38_95/0.1)]",
              )}
            >
              <tool.icon aria-hidden className="size-4" strokeWidth={tool.active ? 2.25 : 1.75} />
              <span className="sr-only">{tool.label}</span>
            </button>
          ),
        )}
        <button
          type="button"
          onClick={toggleSource}
          disabled={disabled}
          aria-pressed={sourceMode}
          className={cn(
            "ms-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:opacity-40",
            sourceMode && "bg-surface text-text shadow-[0_1px_2px_rgb(3_38_95/0.1)]",
          )}
        >
          <Code aria-hidden className="size-4" />
          HTML
        </button>
      </div>

      <div className="relative">
        {sourceMode ? (
          <textarea
            id={control.id}
            value={source ?? ""}
            onChange={(event) => {
              setSource(event.target.value);
              emit(cleanRichHtml(event.target.value));
            }}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={control["aria-describedby"]}
            aria-invalid={control["aria-invalid"]}
            spellCheck={false}
            dir="ltr"
            className="block w-full resize-y bg-transparent px-3.5 py-3 font-mono text-xs leading-relaxed text-text focus:outline-none"
            style={{ minHeight: `${minHeight}rem` }}
          />
        ) : null}
        <div
          ref={editorRef}
          id={sourceMode ? undefined : control.id}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={ariaLabelledBy}
          aria-describedby={control["aria-describedby"]}
          aria-invalid={control["aria-invalid"]}
          aria-required={control["aria-required"]}
          aria-disabled={disabled || undefined}
          contentEditable={!disabled && !sourceMode}
          suppressContentEditableWarning
          spellCheck
          lang={lang}
          dir={dir}
          hidden={sourceMode}
          onFocus={() => {
            try {
              document.execCommand("defaultParagraphSeparator", false, "p");
            } catch {
              // Older engines: Enter may create <div>, which the clean-up turns into <p>.
            }
          }}
          onInput={emitFromEditor}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
              event.preventDefault();
              openLinkDialog();
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const pastedHtml = event.clipboardData.getData("text/html");
            const text = event.clipboardData.getData("text/plain");
            const clean = pastedHtml ? cleanRichHtml(pastedHtml) : plainTextToHtml(text);
            if (clean) exec("insertHTML", clean);
          }}
          onDrop={(event) => {
            // No images or files in rich text: use the media fields instead.
            if (event.dataTransfer.files.length > 0) event.preventDefault();
          }}
          className={cn("max-h-[32rem] overflow-y-auto px-3.5 py-3 outline-none", richProseClass)}
          style={{ minHeight: `${minHeight}rem` }}
        />
        {!sourceMode && empty ? (
          <p aria-hidden className="pointer-events-none absolute inset-x-3.5 top-3 truncate text-[0.9375rem] text-text-muted/70" dir={dir}>
            {placeholder}
          </p>
        ) : null}
      </div>

      <LinkDialog
        state={linkDialog}
        onCancel={() => afterDialog(restoreSelection)}
        onApply={applyLink}
      />
    </div>
  );
}

function LinkDialog({
  state,
  onCancel,
  onApply,
}: {
  state: { href: string; editing: boolean } | null;
  onCancel: () => void;
  onApply: (href: string | null) => void;
}) {
  return (
    <Dialog open={state !== null} onClose={onCancel} title={state?.editing ? "Bağlantıyı düzenle" : "Bağlantı ekle"} size="sm">
      {state ? <LinkForm initial={state.href} editing={state.editing} onCancel={onCancel} onApply={onApply} /> : null}
    </Dialog>
  );
}

function LinkForm({
  initial,
  editing,
  onCancel,
  onApply,
}: {
  initial: string;
  editing: boolean;
  onCancel: () => void;
  onApply: (href: string | null) => void;
}) {
  const [href, setHref] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const error = submitted ? (href.trim() ? hrefError(href) : "Bir bağlantı girin veya sayfa seçin.") : null;
  const submit = () => {
    setSubmitted(true);
    if (href.trim() && !hrefError(href)) onApply(href.trim());
  };
  return (
    // Not a <form>: the editor usually sits inside the page's own form.
    <div
      className="space-y-5"
      onKeyDown={(event) => {
        // Enter in this dialog's own input (not in the nested page picker) applies the link.
        const ownInput =
          event.target instanceof HTMLInputElement && event.target.closest("dialog") === event.currentTarget.closest("dialog");
        if (event.key === "Enter" && ownInput) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <Field label="Bağlantı" error={error} help="Sitedeki bir sayfa için “Sayfa seç”i kullanın; dış adresler https:// ile başlar.">
        <LinkInput value={href} onChange={setHref} invalid={Boolean(error)} hideOpen />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <Button variant="danger-outline" className="me-auto" onClick={() => onApply(null)}>
            Bağlantıyı kaldır
          </Button>
        ) : null}
        <Button onClick={onCancel}>Vazgeç</Button>
        <Button variant="primary" onClick={submit}>
          {editing ? "Güncelle" : "Ekle"}
        </Button>
      </div>
    </div>
  );
}
