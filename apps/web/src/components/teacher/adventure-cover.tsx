"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Compass } from "lucide-react";

/** A decorative atlas also covers missing, still-generating, and broken image URLs. */
export function AdventureCover({ src, kind = "portrait" }: { src: string | null; kind?: "portrait" | "landmark" | "prop" }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const gridId = useId();
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // An image can fail before hydration attaches onError to the server-rendered element.
    if (src && imageRef.current?.complete && imageRef.current.naturalWidth === 0) setFailedSrc(src);
  }, [src]);
  const imageProps = { ref: imageRef, src: src ?? "", alt: "", loading: "lazy" as const, decoding: "async" as const, onError: () => setFailedSrc(src) };
  return (
    <div className="absolute inset-0 overflow-hidden bg-record-wash" aria-hidden="true">
      <svg viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" className="h-full w-full text-record">
        <defs>
          <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity=".12" /></pattern>
        </defs>
        <path fill="var(--world-wash)" stroke="var(--world)" strokeOpacity=".25" strokeWidth="2" d="M-30 45 95 18 170 68 152 132 233 164 208 248 128 260 75 355-30 380ZM390-30 485 50 455 108 510 165 650 190 640-30ZM330 220 399 198 465 242 426 323 340 340 305 275Z" />
        <path fill={`url(#${gridId})`} d="M0 0H600V360H0Z" />
        <path d="M124 202C186 85 378 103 365 254" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="7 9" strokeLinecap="round" opacity=".55" />
        <circle cx="124" cy="202" r="9" fill="var(--signal)" stroke="var(--surface)" strokeWidth="4" />
        <circle cx="365" cy="254" r="9" fill="var(--signal)" stroke="var(--surface)" strokeWidth="4" />
      </svg>
      <Compass className="absolute right-6 top-6 h-16 w-16 rotate-12 text-record/30" strokeWidth={1} />
      {src && failedSrc !== src ? (
        // Dynamic public storage URLs are already generated assets; avoid a second image processing service.
        kind === "portrait" ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img {...imageProps} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-[15%]">
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img {...imageProps} className="h-full w-full object-contain [image-rendering:pixelated] drop-shadow-[0_4px_8px_color-mix(in_srgb,var(--shadow)_35%,transparent)] transition-transform duration-700 motion-safe:group-hover:scale-105" />
          </div>
        )
      ) : null}
    </div>
  );
}
