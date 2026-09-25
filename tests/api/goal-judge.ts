import type { LlmClient } from "@adventure/orchestration";

/**
 * Answers the independent goal check without spending a test's scripted replies: every other call
 * goes to the wrapped client. `met` decides each verdict (default: approve every claim).
 */
export function withGoalJudge(client: LlmClient, met: (claim: { goal: string; question: string; reply: string }) => boolean = () => true): LlmClient & { judged: number } {
  const wrapped = {
    judged: 0,
    async complete(request: Parameters<LlmClient["complete"]>[0]) {
      if (request.schemaName !== "goal_check") return client.complete(request);
      wrapped.judged += 1;
      const claims = (JSON.parse(request.user) as { claims: { index: number; goal: string; question: string; reply: string }[] }).claims;
      const content = JSON.stringify({ verdicts: claims.map((claim) => ({ index: claim.index, met: met(claim) })) });
      return { content, usage: { promptTokens: 10, completionTokens: 10 } };
    },
  };
  return wrapped;
}
