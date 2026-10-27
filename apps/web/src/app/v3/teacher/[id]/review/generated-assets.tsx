"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { compactButton as button } from "@/components/ui";
import { MediaCredit } from "@/components/play/v3/media-credit";
import { CHARACTERS } from "@/lib/play/appearance";
import type { V3Edit } from "@/lib/v3/edit/commands";
import type { ReviewAsset } from "@/lib/v3/review-assets";
import type { MediaCandidate } from "@/lib/v3/media/repository";
import type { ProviderImage } from "@/lib/v3/media/providers";
import {
  loadMediaAction,
  uploadMediaAction,
  createMediaAction,
  searchImagesAction,
} from "../media-actions";
import { AssetUpload } from "./asset-upload";
import { PortraitStanceActions } from "./portrait-stance-actions";
import { SpriteReview } from "./sprite-review";

type EditAsset = (command: V3Edit, candidate?: MediaCandidate) => void;
function AssetImage({
  url,
  alt,
  stage = false,
}: {
  url: string | null;
  alt: string;
  stage?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(!!url);
  useEffect(() => {
    setFailed(false);
    setLoading(!!url);
  }, [url]);
  return (
    <div className="space-y-2">
      <div
        className={`relative grid place-items-center overflow-hidden rounded bg-sunken ${stage ? "aspect-video" : "aspect-square"}`}
      >
        {url && !failed ? (
          <Image
            key={`${url}:${attempt}`}
            unoptimized
            fill
            src={url}
            alt={alt}
            className="object-contain"
            onLoad={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
          />
        ) : (
          <p className="p-4 text-center text-sm text-muted">
            {url ? "Image not available." : "No image selected."}
          </p>
        )}
        {loading && !failed ? (
          <p role="status" className="relative text-sm text-muted">
            Loading image…
          </p>
        ) : null}
      </div>
      {url ? (
        <a
          className="text-sm underline"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open full image
        </a>
      ) : null}
      {url && failed ? (
        <button
          type="button"
          className={button.subtle}
          onClick={() => {
            setFailed(false);
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
        >
          Retry loading
        </button>
      ) : null}
    </div>
  );
}
function CandidateCard({
  item,
  onEdit,
  selected = false,
  stanceActions,
}: {
  item: MediaCandidate;
  onEdit: EditAsset;
  selected?: boolean;
  stanceActions?: React.ReactNode;
}) {
  const [reviewed, setReviewed] = useState(false);
  const sprite =
    item.target.kind === "playerSprite" ||
    item.target.kind === "characterSprite";
  return (
    <article
      className="space-y-3 rounded border border-line bg-paper/50 p-3"
      aria-label="Asset candidate"
    >
      <p className="text-xs font-bold">
        {item.origin === "ai" ? "AI-generated illustration" : item.origin} ·{" "}
        {item.state} ·{" "}
        {selected ? "Selected candidate" : "Unselected candidate"}
      </p>
      {item.failure ? (
        <p role="alert" className="text-sm">
          {item.failure}
        </p>
      ) : null}
      {item.snapshot ? (
        <>
          {sprite ? (
            <SpriteReview url={item.snapshot.url} label={item.snapshot.alt} />
          ) : (
            <AssetImage
              url={item.snapshot.url}
              alt={item.snapshot.alt}
              stage={item.target.kind === "stage"}
            />
          )}
          <MediaCredit media={item.snapshot} caption />
          {sprite ? (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed all four labelled directions and animation frames.
            </label>
          ) : null}
          <button
            type="button"
            className={button.primary}
            disabled={selected || (sprite && !reviewed)}
            onClick={() =>
              onEdit(
                sprite
                  ? {
                      type: "walkingSprite",
                      targetKey: item.target.key,
                      selection: {
                        kind: "candidate",
                        id: item.id,
                        reviewed: true,
                      },
                    }
                  : {
                      type:
                        item.target.kind === "stage"
                          ? "stageImage"
                          : "portraitImage",
                      targetKey: item.target.key,
                      candidateId: item.id,
                    },
                item,
              )
            }
          >
            {selected ? "Selected" : sprite ? "Use sheet" : "Use image"}
          </button>
          {stanceActions}
        </>
      ) : item.state === "pending" ? (
        <p role="status" className="text-sm">
          Candidate is being prepared. Your selection stays in place.
        </p>
      ) : null}
    </article>
  );
}
function SlotActions({
  asset,
  adventureId,
  version,
  onEdit,
  onCandidate,
}: {
  asset: ReviewAsset;
  adventureId: string;
  version: number;
  onEdit: EditAsset;
  onCandidate: (item: MediaCandidate) => void;
}) {
  const [mode, setMode] = useState<"upload" | "find" | "ai" | "bundled" | null>(
      null,
    ),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const [caption, setCaption] = useState(asset.title),
    [alt, setAlt] = useState(asset.title),
    [credit, setCredit] = useState(""),
    [appearance, setAppearance] = useState("");
  const [provider, setProvider] = useState<"commons" | "loc" | "un">("commons"),
    [query, setQuery] = useState(
      `${asset.title} ${asset.description}`.slice(0, 300),
    ),
    [page, setPage] = useState(1),
    [nextPage, setNextPage] = useState<number | null>(null),
    [results, setResults] = useState<ProviderImage[]>([]);
  const [imageUrl, setImageUrl] = useState(""),
    [recordUrl, setRecordUrl] = useState(""),
    [basis, setBasis] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const sprite = asset.kind === "sprite";
  const base = () => ({
    target: asset.target!,
    version,
    key: crypto.randomUUID(),
    caption,
    alt,
    credit,
  });
  // Keep the same reservation key when a response is lost; a received candidate ends the request.
  const requests = useRef(new Map<string, string>());
  async function submitCandidate<T extends { key: string }>(input: T) {
    const fingerprint = JSON.stringify({ ...input, key: "" });
    const key = requests.current.get(fingerprint) ?? input.key;
    requests.current.set(fingerprint, key);
    const result = await createMediaAction(adventureId, { ...input, key });
    if (result.item) requests.current.delete(fingerprint);
    return result;
  }
  async function run(
    work: () => Promise<{ item?: MediaCandidate; error?: string }>,
  ) {
    setPending(true);
    setMessage("");
    try {
      const result = await work();
      if (result.item) {
        onCandidate(result.item);
        setMessage("Candidate ready. Review it, then use it to save your selection.");
      } else setMessage(result.error ?? "Could not create candidate.");
    } catch {
      setMessage("Could not create candidate. Try again.");
    } finally {
      setPending(false);
    }
  }
  async function search(next: number) {
    if (provider === "un") return;
    setPending(true);
    setMessage("");
    try {
      const result = await searchImagesAction(adventureId, {
        provider,
        query,
        page: next,
      });
      if ("error" in result) setMessage(result.error);
      else {
        setResults(result.items);
        setPage(next);
        setNextPage(result.nextPage);
        if (!result.items.length)
          setMessage(
            "No eligible images on this page. Try another query or upload an image.",
          );
      }
    } catch {
      setMessage("Image search unavailable. Try another provider or upload.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap gap-2">
        {sprite ? (
          <button
            type="button"
            className={button.subtle}
            onClick={() => setMode("bundled")}
          >
            Choose bundled sprite
          </button>
        ) : (
          <button
            type="button"
            className={button.subtle}
            onClick={() => setMode("find")}
          >
            Find image
          </button>
        )}
        <button
          type="button"
          className={button.subtle}
          onClick={() => setMode("upload")}
        >
          {sprite ? "Upload sheet" : "Upload"}
        </button>
        <button
          type="button"
          className={button.subtle}
          onClick={() => setMode("ai")}
        >
          Generate with AI
        </button>
        <button
          type="button"
          className={button.subtle}
          onClick={() =>
            onEdit(
              sprite
                ? {
                    type: "walkingSprite",
                    targetKey: asset.id,
                    selection: { kind: "default" },
                  }
                : {
                    type:
                      asset.kind === "stage" ? "stageImage" : "portraitImage",
                    targetKey: asset.id,
                    candidateId: null,
                  },
            )
          }
        >
          {sprite ? "Reset to default" : "Remove"}
        </button>
      </div>
      {mode ? (
        <section
          className="space-y-3 border-t border-line pt-3"
          aria-label={`${asset.title} asset controls`}
        >
          <button
            type="button"
            className={button.subtle}
            onClick={() => setMode(null)}
          >
            Close controls
          </button>
          {mode === "bundled" ? (
            <div className="grid grid-cols-2 gap-2">
              {CHARACTERS.map((id) => (
                <button
                  type="button"
                  key={id}
                  className={button.subtle}
                  onClick={() =>
                    onEdit({
                      type: "walkingSprite",
                      targetKey: asset.id,
                      selection: { kind: "bundled", id },
                    })
                  }
                >
                  {id}
                </button>
              ))}
            </div>
          ) : (
            <>
              <label className="block text-sm">
                Caption
                <input
                  className="block w-full rounded border border-line bg-surface p-2"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={2000}
                  required
                />
              </label>
              <label className="block text-sm">
                Alternative text
                <input
                  className="block w-full rounded border border-line bg-surface p-2"
                  value={alt}
                  onChange={(e) => setAlt(e.target.value)}
                  maxLength={1000}
                  required
                />
              </label>
              {mode === "upload" || (provider === "un" && mode === "find") ? (
                <label className="block text-sm">
                  Credit
                  <input
                    className="block w-full rounded border border-line bg-surface p-2"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    maxLength={2000}
                  />
                </label>
              ) : null}
              {mode === "upload" ? (
                <>
                  <p className="text-sm text-muted">
                    {sprite
                      ? "Static PNG or WebP, 64–2048 pixels square. Four columns: down, up, left, right. Four animation rows. Transparent background in every cell."
                      : "JPEG, PNG or WebP, up to 10 MB and 40 megapixels."}
                  </p>
                  <AssetUpload
                    sprite={sprite}
                    disabled={pending || !caption.trim() || !alt.trim()}
                    onUpload={file => {
                      const data = new FormData();
                      data.set("file", file);
                      data.set("input", JSON.stringify(base()));
                      return run(() => uploadMediaAction(adventureId, data));
                    }}
                  />
                </>
              ) : null}
              {mode === "ai" ? (
                <>
                  <label className="block text-sm">
                    Appearance description
                    <textarea
                      className="block w-full rounded border border-line bg-surface p-2"
                      value={appearance}
                      onChange={(e) => setAppearance(e.target.value)}
                      maxLength={2000}
                    />
                  </label>
                  <p className="text-sm text-muted">
                    Creates a paid AI illustration candidate for this slot.
                    Review it before selecting.
                  </p>
                  <button
                    type="button"
                    className={button.primary}
                    disabled={
                      pending ||
                      !caption.trim() ||
                      !alt.trim() ||
                      !appearance.trim()
                    }
                    onClick={() =>
                      void run(() =>
                        submitCandidate({
                          ...base(),
                          origin: "ai",
                          appearance,
                        }),
                      )
                    }
                  >
                    Generate candidate
                  </button>
                </>
              ) : null}
              {mode === "find" ? (
                <>
                  <label className="block text-sm">
                    Provider
                    <select
                      className="block w-full rounded border border-line bg-surface p-2"
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value as typeof provider);
                        setResults([]);
                        setNextPage(null);
                      }}
                    >
                      <option value="commons">Wikimedia Commons</option>
                      <option value="loc">Library of Congress</option>
                      <option value="un">UN hosted image link</option>
                    </select>
                  </label>
                  {provider === "un" ? (
                    <>
                      <label className="block text-sm">
                        UN image URL
                        <input
                          type="url"
                          className="block w-full rounded border border-line p-2"
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        Original UN record URL
                        <input
                          type="url"
                          className="block w-full rounded border border-line p-2"
                          value={recordUrl}
                          onChange={(e) => setRecordUrl(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        Permission reference or reuse basis
                        <textarea
                          className="block w-full rounded border border-line p-2"
                          value={basis}
                          onChange={(e) => setBasis(e.target.value)}
                        />
                      </label>
                      <label className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I confirm permission or an applicable reuse basis for
                        this image.
                      </label>
                      <button
                        type="button"
                        className={button.primary}
                        disabled={
                          pending ||
                          !confirmed ||
                          !imageUrl ||
                          !recordUrl ||
                          !basis.trim() ||
                          !credit.trim()
                        }
                        onClick={() =>
                          void run(() =>
                            submitCandidate({
                              ...base(),
                              origin: "un",
                              imageUrl,
                              recordUrl,
                              basis,
                              confirmed: true,
                            }),
                          )
                        }
                      >
                        Add UN candidate
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="block text-sm">
                        Image search
                        <input
                          className="block w-full rounded border border-line p-2"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          maxLength={300}
                        />
                      </label>
                      <button
                        type="button"
                        className={button.quiet}
                        disabled={pending || !query.trim()}
                        onClick={() => void search(1)}
                      >
                        Search images
                      </button>
                      {results.map((item) => (
                        <article
                          className="space-y-2 rounded border border-line p-2"
                          key={`${item.provider}:${item.itemId}`}
                        >
                          <AssetImage url={item.thumbnail} alt={item.title} />
                          <p className="text-sm">{item.title}</p>
                          <p className="text-xs">
                            {item.date} · {item.width} × {item.height} ·{" "}
                            {item.credit} · {item.licence.label}
                          </p>
                          <a
                            className="text-sm underline"
                            href={item.recordUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Original record
                          </a>
                          <button
                            type="button"
                            className={button.quiet}
                            disabled={pending || !caption.trim() || !alt.trim()}
                            onClick={() =>
                              void run(() =>
                                submitCandidate({
                                  ...base(),
                                  origin: item.provider,
                                  itemId: item.itemId,
                                }),
                              )
                            }
                          >
                            Import candidate
                          </button>
                        </article>
                      ))}
                      <div className="flex gap-2">
                        {page > 1 ? (
                          <button
                            type="button"
                            className={button.subtle}
                            disabled={pending}
                            onClick={() => void search(page - 1)}
                          >
                            Previous images
                          </button>
                        ) : null}
                        {nextPage ? (
                          <button
                            type="button"
                            className={button.subtle}
                            disabled={pending}
                            onClick={() => void search(nextPage)}
                          >
                            Next images
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
export function GeneratedAssets({
  assets,
  version,
  adventureId,
  savedAssets = assets,
  onEdit,
}: {
  assets: ReviewAsset[];
  version: number;
  adventureId?: string;
  savedAssets?: ReviewAsset[];
  onEdit?: EditAsset;
}) {
  const [items, setItems] = useState<MediaCandidate[]>([]),
    [error, setError] = useState(""),
    [owner, setOwner] = useState("all"),
    [origin, setOrigin] = useState("all"),
    [availability, setAvailability] = useState("all");
  const loading = items.some((item) => item.state === "pending");
  useEffect(() => {
    if (!adventureId) return;
    let alive = true;
    const load = async () => {
      try {
        const result = await loadMediaAction(adventureId);
        if (!alive) return;
        if (result.items) {
          setItems(result.items);
          setError("");
        } else setError(result.error ?? "Could not load candidates.");
      } catch {
        if (alive) setError("Could not load candidates.");
      }
    };
    void load();
    const timer = loading ? setInterval(() => void load(), 3000) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [adventureId, loading]);
  const onCandidate = (item: MediaCandidate) => setItems(current => [item, ...current.filter(c => c.id !== item.id)]);
  const visible = assets.filter(
    (asset) =>
      (owner === "all" || asset.ownerKey === owner) &&
      (origin === "all" ||
        asset.origin === origin ||
        items.some(
          (item) =>
            item.target.kind === asset.target?.kind &&
            item.target.key === asset.id &&
            item.origin === origin,
        )) &&
      (availability === "all" ||
        (availability === "missing"
          ? !asset.url
          : availability === "ready"
            ? !!asset.url
            : items.some(
                (item) =>
                  item.target.kind === asset.target?.kind &&
                  item.target.key === asset.id &&
                  item.state === availability,
              ))),
  );
  return (
    <section aria-label="Assets" className="space-y-6 pb-28">
      <header className="space-y-2">
        <h2 className="text-xl font-bold">Assets</h2>
        <p className="text-sm text-muted">
          Saved version {version}. Select images, then press Save to save your changes together. Publish
          separately. Image selection does not add historical
          evidence.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Stage or character
          <select
            className="ml-2 rounded border border-line bg-surface p-2"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="all">All slots</option>
            {[
              ...new Map(
                assets.map((a) => [a.ownerKey ?? a.id, a.title]),
              ).entries(),
            ].map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Origin
          <select
            className="ml-2 rounded border border-line bg-surface p-2"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            {[
              "all",
              "upload",
              "commons",
              "loc",
              "un",
              "ai",
              "bundled",
              "legacy",
            ].map((value) => (
              <option key={value} value={value}>
                {value === "all" ? "All origins" : value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Availability
          <select
            className="ml-2 rounded border border-line bg-surface p-2"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="all">All</option>
            <option value="ready">Available</option>
            <option value="missing">Missing</option>
            <option value="pending">Pending candidates</option>
            <option value="failed">Failed candidates</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className={button.subtle}
            onClick={async () => {
              if (adventureId) {
                const result = await loadMediaAction(adventureId);
                if (result.items) {
                  setItems(result.items);
                  setError("");
                }
              }
            }}
          >
            Retry loading
          </button>
        </p>
      ) : null}
      {(
        [
          ["stage", "Stage openings"],
          ["portrait", "Character portraits"],
          ["sprite", "Walking sprites"],
        ] as const
      ).map(([kind, title]) => (
        <section key={kind} className="space-y-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <div
            className={`grid min-w-0 gap-5 ${kind === "stage" ? "lg:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-3"}`}
          >
            {visible
              .filter((asset) => asset.kind === kind)
              .map((asset) => {
                const saved = savedAssets.find(
                    (a) => a.kind === asset.kind && a.id === asset.id,
                  ),
                  unsaved =
                    saved?.url !== asset.url ||
                    (saved?.selection === "legacy" ? "default" : saved?.selection) !==
                      (asset.selection === "legacy" ? "default" : asset.selection);
                const candidates = items.filter(
                  (item) =>
                    item.target.kind === asset.target?.kind &&
                    item.target.key === asset.id,
                );
                return (
                  <article
                    id={`asset-${asset.kind}-${asset.id}`}
                    key={`${asset.kind}:${asset.id}`}
                    className="min-w-0 space-y-3 rounded-surface border border-line bg-surface p-4"
                  >
                    <h4 className="font-bold">{asset.title}</h4>
                    <p className="text-sm text-muted">{asset.description}</p>
                    <p className="text-xs font-bold">
                      {unsaved ? "Unsaved selection" : "Saved selection"} ·{" "}
                      {asset.selection === "default" ||
                      asset.selection === "legacy" ||
                      asset.selection === "fallback"
                        ? "Default / fallback"
                        : "Override"}
                      {asset.version !== null
                        ? ` · From version ${asset.version}`
                        : ""}
                      {asset.origin ? ` · ${asset.origin}` : ""}
                    </p>
                    {asset.kind === "sprite" && asset.url ? (
                      <SpriteReview
                        key={asset.url}
                        url={asset.url}
                        label={asset.title}
                      />
                    ) : (
                      <AssetImage
                        url={asset.url}
                        alt={asset.metadata?.alt ?? asset.title}
                        stage={asset.kind === "stage"}
                      />
                    )}
                    <MediaCredit media={asset.metadata} caption />
                    {onEdit && adventureId && asset.target ? (
                      <SlotActions
                        asset={asset}
                        adventureId={adventureId}
                        version={version}
                        onEdit={onEdit}
                        onCandidate={onCandidate}
                      />
                    ) : null}
                    {onEdit
                      ? candidates.map((item) => (
                          <CandidateCard
                            key={item.id}
                            item={item}
                            onEdit={onEdit}
                            selected={asset.metadata?.candidateId === item.id}
                            stanceActions={asset.kind === "portrait" && adventureId ? <PortraitStanceActions
                              item={item}
                              targets={assets.filter(a => a.kind === "portrait" && a.ownerKey === asset.ownerKey).map(a => ({ key: a.id, label: `${a.title}: ${a.description}` }))}
                              adventureId={adventureId}
                              version={version}
                              onEdit={onEdit}
                              onCandidate={onCandidate}
                            /> : undefined}
                          />
                        ))
                      : null}
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </section>
  );
}
