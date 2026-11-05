/** Keep each excerpt in one shelf slot, with an unobstructed reading position. */
export const ARCHIVE_SHELVES = [
  { id: "shelf-choy", sourceId: "choy", title: "Elizabeth's civilian assistance", x: 4, approach: { x: 4, y: 5 } },
  { id: "shelf-food", sourceId: "food", title: "Food and survival", x: 10, approach: { x: 10, y: 5 } },
  { id: "shelf-ration", sourceId: "ration", title: "The rice purchasing card", x: 16, approach: { x: 16, y: 5 } },
] as const;
