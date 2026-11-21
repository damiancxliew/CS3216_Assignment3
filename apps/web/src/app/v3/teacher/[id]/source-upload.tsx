"use client";

import { FileText, LoaderCircle, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import type { BriefUploads } from "./use-brief-uploads";
import styles from "./source-upload.module.css";

export function SourceUpload({ uploads, disabled }: {
  uploads: BriefUploads;
  disabled: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"files" | "paste">("files");
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return <div className={styles.upload}>
    <div data-upload-box className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
      onDragEnter={(event) => { if (!disabled && event.dataTransfer.types.includes("Files")) { event.preventDefault(); depth.current++; setDragging(true); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; } }}
      onDragLeave={(event) => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); depth.current = 0; setDragging(false); if (!disabled) uploads.addFiles(Array.from(event.dataTransfer.files)); }}>
      <div className={styles.statusArea}>
        <div className={`${styles.intro} ${uploads.items.length ? styles.introHidden : ""}`} aria-hidden={uploads.items.length ? true : undefined}>
          <Upload size={19} aria-hidden />
          <p>Add source material</p>
          <span className={styles.hint}>Drop files here · PDF, TXT or MD · Up to 15 MB each</span>
        </div>
        {uploads.items.length ? <ul className={styles.queue} aria-label="Source upload queue" aria-live="polite">
          {uploads.items.map((item) => <li key={item.id} className={styles.queueItem}>
            {item.status === "uploading" ? <LoaderCircle className={styles.spinner} size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
            <div className={styles.itemText}><span className={styles.filename}>{item.name}</span><span className={item.error ? styles.error : styles.hint}>{item.status === "uploading" ? "Reading and saving…" : item.status === "queued" ? "Waiting to upload" : item.error}</span></div>
            {item.status === "failed" ? <button type="button" className={styles.textButton} disabled={disabled} onClick={() => uploads.retry(item.id)} aria-label={`Retry ${item.name}`}>Retry</button> : null}
            {item.status !== "uploading" ? <button type="button" className={styles.dismiss} disabled={disabled} onClick={() => uploads.dismiss(item.id)} aria-label={`Dismiss ${item.name}`}><X size={15} aria-hidden /></button> : null}
          </li>)}
        </ul> : null}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.choose} disabled={disabled} onClick={() => picker.current?.click()}>Choose files</button>
        <button type="button" className={styles.textButton} disabled={disabled} aria-expanded={mode === "paste"} onClick={() => setMode((current) => current === "paste" ? "files" : "paste")}>{mode === "paste" ? "Hide passage" : "Paste a passage"}</button>
      </div>
      <input ref={picker} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" multiple disabled={disabled} aria-label="Choose source files" className={styles.hiddenPicker} onChange={(event) => { uploads.addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
    </div>
    {mode === "paste" ? <form className={styles.paste} onSubmit={async (event) => { event.preventDefault(); if (disabled || uploads.busy || !text.trim()) return; if (await uploads.addText(text)) { setText(""); setMode("files"); } }}>
      <label htmlFor="brief-source-passage">Source passage</label>
      <textarea id="brief-source-passage" value={text} onChange={(event) => setText(event.target.value)} rows={3} disabled={disabled || uploads.busy} placeholder="Paste the material students will use…" />
      <button type="submit" className={styles.choose} disabled={disabled || uploads.busy || !text.trim()}>Add passage</button>
    </form> : null}
  </div>;
}
