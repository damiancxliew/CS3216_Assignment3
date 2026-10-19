"use client";
import { useState } from "react";
import { button } from "@/components/ui";
export function CopyStudentLink({ path }: { path: string }) {
  const [message, setMessage] = useState("");
  return (
    <div>
      <button
        type="button"
        className={button.quiet}
        onClick={async () => {
          const url = new URL(path, window.location.origin).href;
          try {
            await navigator.clipboard.writeText(url);
            setMessage("Student link copied.");
          } catch {
            setMessage(`Copy this link: ${url}`);
          }
        }}
      >
        Copy link
      </button>
      <p role="status" className="text-sm">
        {message}
      </p>
    </div>
  );
}
