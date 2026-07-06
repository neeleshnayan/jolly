"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { useEffect, useRef, useState } from "react";
import type { FocusEvent, MouseEvent } from "react";

// resume-friendly font choices
const FONTS = [
  { label: "Default", value: "" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Garamond", value: "Garamond, 'EB Garamond', serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Calibri", value: "Calibri, 'Segoe UI', sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Mono", value: "'Courier New', monospace" },
];

/**
 * A bullet list you can format (bold/italic/link, text color, font) and store as
 * HTML. Toolbar shows while focus is anywhere inside the editor or its controls,
 * so opening the color picker / font dropdown doesn't dismiss it.
 */
export function RichBullets({
  value,
  onSave,
}: {
  value: string;
  onSave: (html: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TextStyleKit, // TextStyle + Color + FontFamily + FontSize
    ],
    content: value || "<ul><li></li></ul>",
    editorProps: { attributes: { class: "rich" } },
  });

  // show the toolbar on editor focus (fires reliably on real clicks); hiding is
  // handled by the wrapper's blur so the color/font pickers don't dismiss it
  useEffect(() => {
    if (!editor) return;
    const onFocus = () => setFocused(true);
    editor.on("focus", onFocus);
    return () => {
      editor.off("focus", onFocus);
    };
  }, [editor]);

  // sync ONLY genuine external changes (e.g. an accepted AI rewrite) into the
  // editor. Guard on the previous prop value so this never fires on mount (which
  // would fight TipTap's initial content and blank the bullets) and never
  // clobbers what the user is actively typing.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (!editor) return;
    if (value === lastValueRef.current) return; // prop didn't actually change
    lastValueRef.current = value;
    if (editor.isFocused) return;
    const next = value || "<ul><li></li></ul>";
    if (next !== editor.getHTML()) editor.commands.setContent(next, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") return void editor.chain().focus().unsetLink().run();
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const hold = (e: MouseEvent) => e.preventDefault();
  const onWrapBlur = (e: FocusEvent) => {
    // hide + save only when focus leaves the whole widget (not the toolbar)
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
      setFocused(false);
      saveRef.current(editor.getHTML());
    }
  };

  const curColor = (editor.getAttributes("textStyle").color as string) || "#1a1a1a";
  const curFont = (editor.getAttributes("textStyle").fontFamily as string) || "";
  const curSize = parseInt((editor.getAttributes("textStyle").fontSize as string) || "14", 10) || 14;
  const bumpSize = (delta: number) => {
    const next = Math.min(40, Math.max(8, curSize + delta));
    editor.chain().focus().setFontSize(`${next}px`).run();
  };

  return (
    <div className="richwrap" ref={wrapRef} onFocusCapture={() => setFocused(true)} onBlur={onWrapBlur}>
      {focused && (
        <div className="rich-toolbar">
          <button type="button" onMouseDown={hold} onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "on" : ""} title="Bold">B</button>
          <button type="button" onMouseDown={hold} onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive("italic") ? "on" : ""} title="Italic"><span style={{ fontStyle: "italic" }}>i</span></button>
          <button type="button" onMouseDown={hold} onClick={setLink} className={editor.isActive("link") ? "on" : ""} title="Add link">🔗</button>
          <span className="sep" />
          <label className="color-btn" title="Text color">
            <span className="A" style={{ borderBottomColor: curColor }}>A</span>
            <input
              type="color"
              value={curColor}
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            />
          </label>
          <select
            className="font-sel"
            value={curFont}
            onChange={(e) => {
              const v = e.target.value;
              if (v) editor.chain().focus().setFontFamily(v).run();
              else editor.chain().focus().unsetFontFamily().run();
            }}
            title="Font"
          >
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="sep" />
          <button type="button" onMouseDown={hold} onClick={() => bumpSize(-1)} title="Smaller text">A−</button>
          <span className="size-val">{curSize}</span>
          <button type="button" onMouseDown={hold} onClick={() => bumpSize(1)} title="Larger text">A+</button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
