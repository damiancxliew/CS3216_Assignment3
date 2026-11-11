import { PocketLogo } from "@/components/play/v3/pocket-ui";
import { pixelFont } from "@/components/play/v3/pixel-font";

/** Shown while the attempt and its spec load, so the wait after "Enter the adventure" is never a blank page. */
export default function Loading() {
  return (
    <main role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-content-center justify-items-center gap-8 bg-[#1f2433] px-6 text-center">
      <style>{`
        @keyframes pocket-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
        @keyframes pocket-dot { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
        .pocket-load-logo { animation: pocket-bob 1.6s steps(4, end) infinite; }
        .pocket-load-dot { animation: pocket-dot 1.2s steps(2, end) infinite; }
        @media (prefers-reduced-motion: reduce) { .pocket-load-logo, .pocket-load-dot { animation: none; } }
      `}</style>
      <div className="pocket-load-logo"><PocketLogo width={280} /></div>
      <p className={`${pixelFont.className} rounded-lg border-[3px] border-[#1f2433] bg-[#fff1c7] px-5 py-3 text-xl font-bold text-[#1f2433] shadow-[0_4px_0_#d85f35]`}>
        Loading your adventure
        <span aria-hidden>
          <span className="pocket-load-dot">.</span>
          <span className="pocket-load-dot" style={{ animationDelay: "0.2s" }}>.</span>
          <span className="pocket-load-dot" style={{ animationDelay: "0.4s" }}>.</span>
        </span>
      </p>
    </main>
  );
}
