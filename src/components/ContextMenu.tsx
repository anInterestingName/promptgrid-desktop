import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuItem, ContextMenuPosition } from "./contextMenuUtils";

type ContextMenuProps = {
  ariaLabel: string;
  items: ContextMenuItem[];
  position: ContextMenuPosition;
  onClose: () => void;
  className?: string;
};

export function ContextMenu({
  ariaLabel,
  items,
  position,
  onClose,
  className = "",
}: ContextMenuProps) {
  useEffect(() => {
    function closeFromPointer(event: PointerEvent) {
      if (!(event.target as Element).closest(".context-menu")) {
        onClose();
      }
    }

    function closeFromKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function closeFromBlur() {
      onClose();
    }

    document.addEventListener("pointerdown", closeFromPointer, true);
    document.addEventListener("keydown", closeFromKey, true);
    window.addEventListener("blur", closeFromBlur);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer, true);
      document.removeEventListener("keydown", closeFromKey, true);
      window.removeEventListener("blur", closeFromBlur);
    };
  }, [onClose]);

  const menu = (
    <div
      aria-label={ariaLabel}
      className={`context-menu${className ? ` ${className}` : ""}`}
      role="menu"
      style={{
        "--context-menu-x": `${position.x}px`,
        "--context-menu-y": `${position.y}px`,
      } as CSSProperties}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          className={item.danger ? "danger" : undefined}
          disabled={item.disabled}
          key={item.key}
          role="menuitem"
          type="button"
          onClick={() => {
            if (item.disabled) {
              return;
            }
            item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}
