"use client";

import { useRef, useState } from "react";
import { compactButton as button } from "@/components/ui";

export function AssetUpload({ sprite, disabled, onUpload }: {
  sprite: boolean;
  disabled: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const accepted = sprite ? ["image/png", "image/webp"] : ["image/jpeg", "image/png", "image/webp"];
  async function upload(files: File[]) {
    setDragging(false);
    if (disabled || busy.current) return;
    setError("");
    if (files.length !== 1) { setError("Choose one image at a time."); return; }
    const file = files[0];
    if (!accepted.includes(file.type)) { setError(sprite ? "Choose a PNG or WebP walking sheet." : "Choose a JPEG, PNG or WebP image."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Choose an image up to 10 MB."); return; }
    busy.current = true;
    try { await onUpload(file); }
    finally { busy.current = false; }
  }
  return <div
    className={`space-y-3 rounded border-2 border-dashed p-4 text-center ${dragging ? "border-record bg-record-wash" : "border-line bg-paper/50"}`}
    onDragOver={event => { event.preventDefault(); if (!disabled) { event.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)); }}
  >
    <p className="text-sm text-muted">{sprite ? "Drop a walking sheet here" : "Drop an image here"}, or choose a file.</p>
    <button type="button" className={button.primary} disabled={disabled} onClick={() => input.current?.click()}>
      {sprite ? "Choose walking sheet" : "Choose image"}
    </button>
    <input ref={input} hidden aria-label={sprite ? "Choose walking sheet" : "Choose image"} type="file"
      accept={accepted.join(",")} disabled={disabled}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files); }} />
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
  </div>;
}
