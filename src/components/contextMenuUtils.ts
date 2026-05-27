import type { ReactNode } from "react";

export type ContextMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export type ContextMenuPosition = {
  x: number;
  y: number;
};

export function getContextMenuPosition({
  preferredX,
  preferredY,
  width,
  height,
  gap = 8,
  boundaryRight = window.innerWidth,
  fallbackRight,
}: {
  preferredX: number;
  preferredY: number;
  width: number;
  height: number;
  gap?: number;
  boundaryRight?: number;
  fallbackRight?: number;
}) {
  const hasRightSpace = preferredX + width + gap <= boundaryRight;
  const hasLeftSpace = preferredX - width - gap >= 0;
  const x = hasRightSpace
    ? preferredX
    : hasLeftSpace
      ? (fallbackRight ?? preferredX) - width
      : Math.max(gap, boundaryRight - width);
  const y =
    preferredY + height + gap <= window.innerHeight
      ? preferredY
      : Math.max(gap, window.innerHeight - height - gap);

  return { x, y };
}
