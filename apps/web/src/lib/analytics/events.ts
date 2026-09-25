/**
 * The event vocabulary for M19. Names are frozen here rather than typed at the
 * call site so that the funnel (landing → sign-in → publish → play → ending)
 * stays comparable across the week.
 */
export const ANALYTICS_EVENTS = {
  landingViewed: "landing_viewed",
  signInStarted: "sign_in_started",
  signInCompleted: "sign_in_completed",
  adventureCreated: "adventure_created",
  sourceUploaded: "source_uploaded",
  generationStarted: "generation_started",
  generationCompleted: "generation_completed",
  adventurePublished: "adventure_published",
  shareLinkCopied: "share_link_copied",
  attemptStarted: "attempt_started",
  attemptResumed: "attempt_resumed",
  roomEntered: "room_entered",
  messageSent: "message_sent",
  decisionCommitted: "decision_committed",
  stageTimerExpired: "stage_timer_expired",
  stageAdvanced: "stage_advanced",
  endingReached: "ending_reached",
  debriefViewed: "debrief_viewed",
  debriefShared: "debrief_shared",
  pricingCtaClicked: "pricing_cta_clicked",
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
