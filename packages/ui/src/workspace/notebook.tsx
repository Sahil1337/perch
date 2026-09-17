"use client";

// The notebook: the same file, shown as a column of cards. A notebook is a view, not a format —
// one plain `.sql` file, nothing new on the wire. `cells.ts` does the splitting; editing is the part
// that fights back, in two ways.
//
//   Cell identity. `Cell.id` is `index:hash(sql)`, so editing a card changes its id. That is what
//   results want (stale output drops itself) and what React keys do not (the editor would remount
//   on every keystroke), so cards are keyed by position and outputs by `Cell.id`.
//
//   Whitespace. `parseCells` returns trimmed spans, so writing a cell back and re-parsing does not
//   round-trip: a trailing space is trimmed away, the controlled editor sees text differing from its
//   own document, and the next keystroke writes past the span. So the cell being edited owns an
//   explicit span and the rest of the file is spliced around it untouched, byte for byte.
//
// Outputs are never written to the file: cached rows go stale the moment the data changes.

import { PlayIcon, PlusIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { plural } from "../lib/format";
import { useSpring } from "../lib/motion";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { appendCell, type Cell, deleteCell, dropAppendedCell, parseCells } from "./cells";
import { useWorkspace } from "./context";
import { CellOutcome, CellResult } from "./results-panel";
import { SqlEditor } from "./sql-editor";
import type { Run } from "./types";

/** The span of the file a cell currently occupies, tracked only while that cell is being typed in. */
type Editing = { index: number; offset: number; length: number; text: string };

export function Notebook({
  fileId,
  className,
}: {
  fileId: string;
  className?: string;
}): React.ReactElement {
  const { editBuffer, buffers, run, runs } = useWorkspace();
  const content = buffers.find((file) => file.id === fileId)?.content ?? "";

  const cells = React.useMemo(() => parseCells(content), [content]);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  /** Cell id → run id. Keyed by `Cell.id`, so an edited cell loses its output by construction. */
  const [outputs, setOutputs] = React.useState<Record<string, string>>({});

  /**
   * The empty card at the end, if asked for. `parseCells` cannot return an empty cell, so the card
   * is this component's business rather than the file's: keyed by the cell count when it was asked
   * for, it retires itself once what is typed parses as a cell.
   */
  const [pending, setPending] = React.useState<number | null>(null);

  React.useEffect(() => {
    setEditing(null);
    setOutputs({});
    setPending(null);
  }, [fileId]);

  const write = React.useCallback(
    (next: string) => {
      setEditing(null);
      editBuffer(fileId, next);
    },
    [editBuffer, fileId],
  );
  const runCell = React.useCallback(
    async (cell: Cell): Promise<void> => {
      const runId = await run(cell.sql);
      if (runId) setOutputs((previous) => ({ ...previous, [cell.id]: runId }));
    },
    [run],
  );

  const runAll = React.useCallback(async (): Promise<void> => {
    for (const cell of cells) {
      if (cell.sql.trim().length === 0) continue;
      await runCell(cell);
    }
  }, [cells, runCell]);

  const addCell = React.useCallback((): void => {
    setPending(cells.length);
    write(appendCell(content));
  }, [cells.length, content, write]);

  /** An empty file has no cells; the notebook still needs one card to type into. */
  const pendingIndex = pending !== null && cells.length <= pending ? cells.length : -1;
  const cards: readonly Cell[] =
    pendingIndex >= 0
      ? [...cells, { id: `${pendingIndex}:pending`, sql: "", offset: content.length }]
      : cells.length > 0
        ? cells
        : [{ id: "0:empty", sql: "", offset: 0 }];

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4">
          {/* Cards animate in and out, and `layout` on each card carries every other card to its
              new place — adding a cell, deleting one, or a result opening underneath one. */}
          <AnimatePresence initial={false}>
            {cards.map((cell, index) => (
              <NotebookCard
                cell={cell}
                editing={editing?.index === index ? editing : null}
                index={index}
                key={index}
                onDelete={
                  index === pendingIndex
                    ? () => {
                        setPending(null);
                        write(dropAppendedCell(content));
                      }
                    : cells.length > 1
                      ? () => write(deleteCell(content, cell))
                      : undefined
                }
                onEdit={(next) => {
                  // The span this cell owns: the one being typed in if it is this one, else the
                  // freshly parsed span. Splicing by span keeps the rest of the file byte-exact.
                  const span =
                    editing?.index === index
                      ? editing
                      : { offset: cell.offset, length: cell.sql.length };
                  const updated =
                    content.slice(0, span.offset) + next + content.slice(span.offset + span.length);
                  setEditing({ index, offset: span.offset, length: next.length, text: next });
                  editBuffer(fileId, updated);
                }}
                onRun={() => void runCell(cell)}
                run={findRun(runs, outputs[cell.id])}
              />
            ))}
          </AnimatePresence>

          <Button className="self-start" onClick={addCell} size="xs" variant="outline">
            <PlusIcon />
            Add cell
          </Button>
        </div>
      </div>

      <RunAllBar count={cards.length} onRunAll={() => void runAll()} />
    </div>
  );
}

function NotebookCard({
  cell,
  index,
  editing,
  run,
  onEdit,
  onRun,
  onDelete,
}: {
  cell: Cell;
  index: number;
  editing: Editing | null;
  run: Run | undefined;
  onEdit: (sql: string) => void;
  onRun: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  // While this cell is being typed in, its own text wins over the re-parsed (trimmed) span.
  const value = editing?.text ?? cell.sql;
  const reduced = useReducedMotion();
  const spring = useSpring();

  // Which statement this cell shows. Keyed by run id so a re-run never paints statement 5 of the
  // previous one for a frame, and held here rather than in the result because the badge reads it too.
  const [selection, setSelection] = React.useState<{ runId: string; index: number } | null>(null);
  const statements = run?.results ?? [];
  const statementIndex =
    selection && run && selection.runId === run.id
      ? Math.min(selection.index, Math.max(0, statements.length - 1))
      : 0;

  return (
    <motion.article
      aria-label={`Cell ${index + 1}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
      exit={reduced ? undefined : { opacity: 0, scale: 0.98 }}
      layout={!reduced}
      transition={spring}
    >
      {/* No rule and no fill under this row: the card's own border frames it, and the separator
          below the header belongs to the editor. */}
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5">
        <span className="font-mono text-muted-foreground text-xs">[{index + 1}]</span>
        <div className="flex-1" />
        <CellOutcome run={run} statement={statements[statementIndex]} />
        <Button aria-label={`Run cell ${index + 1}`} onClick={onRun} size="icon-xs" variant="ghost">
          <PlayIcon />
        </Button>
        {onDelete && (
          <Button
            aria-label={`Delete cell ${index + 1}`}
            onClick={onDelete}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        )}
      </div>

      <div className="shrink-0 border-border border-t">
        <SqlEditor minimal onChange={onEdit} onRunStatement={onRun} value={value} />
      </div>

      {/* No toolbar between the code and the answer: the result is welded straight to the editor,
          and its chrome hangs off the bottom. That join is what makes a cell read as a cell. */}
      {run && (
        <CellResult
          className="border-border border-t"
          index={statementIndex}
          onSelectStatement={(next) => setSelection({ runId: run.id, index: next })}
          run={run}
        />
      )}
    </motion.article>
  );
}

/** The notebook's footer: "Run all" instead of the topbar's per-file Run. */
function RunAllBar({
  count,
  onRunAll,
}: {
  count: number;
  onRunAll: () => void;
}): React.ReactElement {
  const { activeRun, cancelRun } = useWorkspace();
  const running = activeRun?.status === "running";

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-border border-t px-3">
      <span className="text-muted-foreground text-xs tabular-nums">{plural(count, "cell")}</span>
      <div className="ml-auto">
        {running && activeRun ? (
          <Button onClick={() => void cancelRun(activeRun.id)} size="sm" variant="destructive">
            Cancel
          </Button>
        ) : (
          <Button onClick={onRunAll} size="sm">
            <PlayIcon />
            Run all
          </Button>
        )}
      </div>
    </div>
  );
}

function findRun(runs: readonly Run[], runId: string | undefined): Run | undefined {
  return runId === undefined ? undefined : runs.find((record) => record.id === runId);
}
