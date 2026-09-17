"use client";

import type { Cell, ResultColumn } from "@perch/protocol";
import * as React from "react";
import { ROW_HEIGHT } from "./grid-sizing";

const COPIED_MS = 900;

export type CellRef = { readonly row: number; readonly col: number };

export type GridSelection = {
  readonly selected: CellRef | null;
  readonly copied: CellRef | null;
  readonly select: (ref: CellRef) => void;
  readonly copy: (ref: CellRef, value: Cell) => void;
  readonly onFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/**
 * Which cell is selected, which one just said "Copied", and the keyboard that moves between them.
 *
 * Only a windowed grid needs `scrollToIndex`: arrow keys can walk off the rendered window, so the
 * selection has to drag the viewport after it before the cell it names exists in the DOM.
 */
export function useGridSelection({
  rows,
  columns,
  scrollRef,
  scrollToIndex,
}: {
  rows: readonly (readonly Cell[])[];
  columns: readonly ResultColumn[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  scrollToIndex: (index: number) => void;
}): GridSelection {
  const [selected, setSelected] = React.useState<CellRef | null>(null);
  const [copied, setCopied] = React.useState<CellRef | null>(null);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when navigation moved the selection, so focus follows a row that may not be rendered yet.
  const chasingFocus = React.useRef(false);

  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = React.useCallback((ref: CellRef, value: Cell): void => {
    void navigator.clipboard?.writeText(value === null ? "" : String(value));
    setCopied(ref);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
  }, []);

  // Scrolling a row into view only queues a render, so the target cell exists a tick later.
  React.useEffect(() => {
    if (!chasingFocus.current || !selected) return;
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-cell="${selected.row}:${selected.col}"]`,
    );
    if (!target) return;
    chasingFocus.current = false;
    target.focus();
  });

  const move = (from: CellRef, rowDelta: number, colDelta: number): void => {
    const row = clamp(from.row + rowDelta, 0, rows.length - 1);
    const col = clamp(from.col + colDelta, 0, columns.length - 1);
    if (row === from.row && col === from.col) return;
    setSelected({ row, col });
    chasingFocus.current = true;
    scrollToIndex(row);
  };

  const onFocus = (event: React.FocusEvent<HTMLDivElement>): void => {
    // Tabbing onto the grid parks on the first cell; focus inside it is left alone.
    if (event.target !== event.currentTarget) return;
    if (!selected && rows.length > 0 && columns.length > 0) {
      setSelected({ row: 0, col: 0 });
      chasingFocus.current = true;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0 || columns.length === 0) return;
    const from = selected ?? { row: 0, col: 0 };
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1);

    switch (event.key) {
      case "ArrowDown":
        move(from, 1, 0);
        break;
      case "ArrowUp":
        move(from, -1, 0);
        break;
      case "ArrowRight":
        move(from, 0, 1);
        break;
      case "ArrowLeft":
        move(from, 0, -1);
        break;
      case "PageDown":
        move(from, page, 0);
        break;
      case "PageUp":
        move(from, -page, 0);
        break;
      case "Home":
        move(from, event.ctrlKey || event.metaKey ? -rows.length : 0, -columns.length);
        break;
      case "End":
        move(from, event.ctrlKey || event.metaKey ? rows.length : 0, columns.length);
        break;
      case "Enter":
        if (selected) copy(selected, rows[selected.row]?.[selected.col] ?? null);
        break;
      case "c":
        if (!event.metaKey && !event.ctrlKey) return;
        if (selected) copy(selected, rows[selected.row]?.[selected.col] ?? null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return { selected, copied, select: setSelected, copy, onFocus, onKeyDown };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
