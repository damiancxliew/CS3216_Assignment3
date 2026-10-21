export { chapterTasks as waterfrontTasks } from "./chapter-progress";

export function atBoardingSteps(point: { x: number; y: number }) {
  return point.x >= 26 && point.x <= 28 && point.y === 18;
}
