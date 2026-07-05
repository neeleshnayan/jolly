"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Wraps an entry with a drag handle. Only the handle carries the drag listeners,
 * so clicking the entry to edit never starts a drag.
 */
export function SortableItem({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className="sortable"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 5 : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <button
        className="drag-handle no-print"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        ⠿
      </button>
      {children}
    </div>
  );
}
