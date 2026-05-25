export function upsertById<T extends { id: string }>(items: T[], item: T) {
  const nextItems = items.filter((candidate) => candidate.id !== item.id);
  return [item, ...nextItems];
}

export function ensureById<T extends { id: string }>(items: T[], item: T) {
  return items.some((candidate) => candidate.id === item.id)
    ? items
    : [item, ...items];
}
