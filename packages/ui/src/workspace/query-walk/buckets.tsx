"use client";

// GROUP BY's middle: every row gathered into the bucket its keys put it in, then each bucket
// squashed to the one row the grouped query produced for it.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { formatCell } from "../results-grid";
import type { BucketView, Col, Scene } from "./scenes";
import { TickNumber } from "./tick-number";
import { collapseAfter, staggerDelay, useT } from "./walk-motion";

export function BucketsScene({
  scene,
}: {
  scene: Extract<Scene, { kind: "buckets" }>;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex flex-wrap items-start gap-3"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      {scene.buckets.map((bucket, i) => (
        <Bucket
          bucket={bucket}
          index={i}
          key={bucket.key}
          memberCols={scene.memberCols}
          squash={scene.squash}
        />
      ))}
    </motion.div>
  );
}

function Bucket({
  bucket,
  memberCols,
  squash,
  index,
}: {
  bucket: BucketView;
  memberCols: readonly Col[];
  squash: boolean;
  index: number;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="w-44 shrink-0 overflow-hidden rounded-lg border bg-card shadow-sm/5"
      initial={{ opacity: 0, y: 10 }}
      // Position only: a bucket's height is already moving under it as the members fold away, and
      // scaling the card on top of that animates the same height twice. See `Table` in `stage.tsx`.
      layout="position"
      transition={{ ...t.spring, delay: t.reduced ? 0 : index * 0.05 }}
    >
      <div className="flex h-8 items-center gap-2 border-b bg-info/10 px-2.5 font-medium text-info-foreground text-xs">
        <span className="truncate" title={bucket.title}>
          {bucket.title}
        </span>
        <span className="ms-auto shrink-0 font-mono text-xs tabular-nums opacity-80">
          <TickNumber value={bucket.count} /> {bucket.count === 1 ? "row" : "rows"}
        </span>
      </div>
      <div className="flex flex-col bg-muted/40 p-1.5">
        <AnimatePresence initial={false}>
          {!squash &&
            bucket.members.map((member, i) => (
              <motion.div
                animate={{ opacity: 1 }}
                className="mb-1 flex h-7 items-center gap-2 overflow-hidden rounded-md border bg-card px-2 font-mono text-xs tabular-nums last:mb-0"
                exit={{
                  height: 0,
                  opacity: 0,
                  marginBottom: 0,
                  transition: collapseAfter(t, staggerDelay(i, bucket.members.length, 0.06)),
                }}
                initial={{ opacity: 0 }}
                key={member.key}
                layout="position"
                layoutId={member.key}
                transition={{ layout: t.spring, default: t.fade }}
              >
                {/* A bucket's members are the same columns over and over, so they have to sit in
                    the same places over and over. Laid out by content — first column left, last
                    column shoved to the far edge — a long value moved that member's middle column
                    and nothing else's, and three rows of one column read as three unrelated lines.
                    Each column takes the share of the row its measured width asks for, out of the
                    same `Col` the stage sizes its cards from, and they shrink in proportion when
                    they want more than a bucket is wide.

                    Which end of that share a value sits against is `col.num` and nothing else: the
                    server said the column is a number, and a count that is flush right on the card
                    beside this one cannot be flush left here. */}
                {memberCols.map((col, at) => {
                  const value = member.cells[col.id] ?? null;
                  return (
                    <span
                      className={cn(
                        "min-w-0 grow basis-(--w) truncate",
                        col.num && "text-right",
                        at === 0 && "text-muted-foreground",
                        value === null && "text-muted-foreground italic",
                      )}
                      key={col.id}
                      style={{ "--w": `${col.width}px` } as React.CSSProperties}
                    >
                      {formatCell(value)}
                    </span>
                  );
                })}
              </motion.div>
            ))}
          {squash && (
            <motion.div
              animate={{ opacity: 1 }}
              className="flex flex-col gap-0.5 overflow-hidden rounded-md border bg-card px-2 py-1 font-mono text-xs tabular-nums"
              initial={{ opacity: 0 }}
              key="summary"
              layout="position"
              layoutId={bucket.key}
              transition={{ layout: t.spring, default: { ...t.fade, delay: t.reduced ? 0 : 0.2 } }}
            >
              {bucket.summary ? (
                bucket.summary.map((entry) => {
                  const n = typeof entry.value === "number" ? entry.value : Number(entry.value);
                  return (
                    <span className="flex items-center gap-2" key={entry.label}>
                      <span className="truncate text-muted-foreground">{entry.label}</span>
                      <span className="ms-auto truncate text-info-foreground">
                        {entry.num && Number.isFinite(n) ? (
                          <TickNumber duration={0.9} from={0} value={n} />
                        ) : (
                          formatCell(entry.value)
                        )}
                      </span>
                    </span>
                  );
                })
              ) : (
                <span className="text-muted-foreground italic">not in the sample</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
