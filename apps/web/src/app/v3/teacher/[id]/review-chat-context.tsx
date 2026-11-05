"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ReviewChatProposal,
  ReviewChatInput,
} from "@/lib/v3/review-chat/types";

export type ReviewChatTarget = {
  key: string;
  revision: string;
  pending: boolean;
  input: ReviewChatInput;
  apply(proposal: ReviewChatProposal): void;
};
type RegisteredTarget = Pick<
  ReviewChatTarget,
  "key" | "revision" | "pending"
> & {
  current(): ReviewChatTarget;
};
export type UpgradeChatTarget = {
  key: string;
  pending: boolean;
  active: boolean;
  route(message: string): Promise<string>;
};
const Context = createContext<{
  target: RegisteredTarget | null;
  register(target: RegisteredTarget | null): void;
  upgrade: UpgradeChatTarget | null;
  registerUpgrade(target: UpgradeChatTarget | null): void;
} | null>(null);
export function ReviewChatProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<RegisteredTarget | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeChatTarget | null>(null);
  const register = useCallback(
    (next: RegisteredTarget | null) => setTarget(next),
    [],
  );
  return (
    <Context.Provider value={{ target, register, upgrade, registerUpgrade: setUpgrade }}>{children}</Context.Provider>
  );
}
export function useReviewChat() {
  return useContext(Context);
}
/** Keep callbacks current without republishing a target on every render. */
export function useReviewChatTarget(target: ReviewChatTarget) {
  const context = useContext(Context);
  const register = context?.register;
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    if (!register) return;
    register({
      key: target.key,
      revision: target.revision,
      pending: target.pending,
      current: () => latest.current,
    });
    return () => register(null);
  }, [register, target.key, target.revision, target.pending]);
}
