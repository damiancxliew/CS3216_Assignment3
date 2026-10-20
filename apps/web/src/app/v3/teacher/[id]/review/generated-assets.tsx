"use client";

import Image from "next/image";
import { useState } from "react";
import { compactButton as button } from "@/components/ui";
import type { ReviewAsset } from "@/lib/v3/review-assets";

function AssetPreview({ asset }: { asset: ReviewAsset }) {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(asset.url ? "loading" : "unavailable");
  const [attempt, setAttempt] = useState(0);
  const source = asset.url && attempt ? `${asset.url}?retry=${attempt}` : asset.url;
  return (
    <figure className="min-w-0 overflow-hidden rounded-surface border border-line bg-surface">
      <div className={`relative grid place-items-center bg-sunken ${asset.kind === "stage" ? "aspect-video" : "aspect-square"}`}>
        {source && status !== "unavailable" ? (
          <Image
            key={source}
            src={source}
            alt={asset.title}
            fill
            unoptimized
            className="object-contain"
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("unavailable")}
          />
        ) : null}
        {status !== "ready" ? (
          <p role="status" className="p-4 text-center text-sm text-muted">
            {status === "loading" ? "Loading image…" : "Image not available for this version."}
          </p>
        ) : null}
      </div>
      <figcaption className="space-y-2 p-4">
        <h4 className="font-bold">{asset.title}</h4>
        <p className="text-sm text-muted">{asset.description}</p>
        {asset.version !== null ? <p className="text-xs text-muted">From version {asset.version}</p> : null}
        {status === "ready" && asset.url ? (
          <a className="text-sm underline" href={asset.url} target="_blank" rel="noopener noreferrer">Open full image</a>
        ) : status === "unavailable" && asset.url ? (
          <button type="button" className={button.subtle} onClick={() => {
            setStatus("loading");
            setAttempt((current) => current + 1);
          }}>Retry loading</button>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function GeneratedAssets({ assets, version }: { assets: ReviewAsset[]; version: number }) {
  return (
    <section aria-label="Generated assets" className="space-y-6 pb-28">
      <header className="space-y-2">
        <h2 className="text-xl font-bold">Generated assets</h2>
        <p className="text-sm text-muted">Stage artwork and character portraits for saved version {version}. Unsaved story edits are not reflected here. Images may still be generating.</p>
      </header>
      {assets.length ? ([
        ["stage", "Stage artwork"],
        ["portrait", "Character portraits"],
      ] as const).map(([kind, title]) => (
        <section key={kind} className="space-y-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <div className={`grid min-w-0 gap-5 ${kind === "stage" ? "lg:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
            {assets.filter((asset) => asset.kind === kind).map((asset) => (
              <AssetPreview key={`${asset.id}:${asset.url}`} asset={asset} />
            ))}
          </div>
        </section>
      )) : <p className="text-sm text-muted">No generated images are available yet.</p>}
    </section>
  );
}
