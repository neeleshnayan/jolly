"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * The résumé dropzone. Attaches the upload to the given (signed-in) userId, then
 * refreshes so the server page re-renders into the editor. Used on the résumé
 * page's empty state — "add a résumé if you haven't yet".
 */
export default function UploadResume({ userId }: { userId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(false);
    setStatus("Reading your résumé…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("userId", userId);
    try {
      const res = await fetch("/api/resume", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Something went wrong");
      setStatus("Done — opening your résumé…");
      router.refresh();
    } catch (err) {
      setError(true);
      setStatus(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <div className="upload-card">
      <h1>Add your résumé</h1>
      <p className="sub">
        Drop it in and we&apos;ll turn it into a clean, editable version in
        seconds — the starting point your career agent builds on.
      </p>

      <div
        className={`dropzone${file ? " has-file" : ""}${dragging ? " dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {file ? (
          <>
            <div className="filename">{file.name}</div>
            <div className="hint">Click to choose a different file</div>
          </>
        ) : (
          <>
            <div className="filename">{dragging ? "Drop it here" : "Click or drag a file to upload"}</div>
            <div className="hint">PDF, DOCX, or TXT</div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,text/plain"
          style={{ display: "none" }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <button className="btn" disabled={!file || busy} onClick={submit}>
        {busy ? "Working…" : "Build my résumé"}
      </button>

      <div className={`status-line${error ? " error" : ""}`}>{status}</div>
    </div>
  );
}
