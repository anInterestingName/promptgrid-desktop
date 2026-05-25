import type { GridCell } from "../../types";

export function getHighestRound(tasks: GridCell[]) {
  return tasks.reduce(
    (round, task) => Math.max(round, task.explorationRound),
    1,
  );
}
