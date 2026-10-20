/** Rules retain their authored order: the first unconditional outcome is the default;
 * later unconditional outcomes are alternatives when earlier endings are closed. */
export function unconditionalOutcomeIds(moment: { rules: readonly { actId: string; outcomeId: string; when?: unknown }[] }, actId: string): string[] {
  return moment.rules.filter((rule) => rule.actId === actId && rule.when === undefined).map((rule) => rule.outcomeId)
}
