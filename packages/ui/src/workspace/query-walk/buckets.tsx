"use client";

// GROUP BY's middle: every row gathered into the bucket its keys put it in, then each bucket
// squashed to the one row the grouped query produced for it.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { formatCell } from "../results-grid";
import type { BucketView, Col, Scene } from "./scenes";
import { TickNumber } from "./tick-number";
import { collapseAfter, useT } from "./walk-motion";

export function BucketsScene({
  scene,
}: {
  scene: Extract<Scene, { kind: "buckets" }>;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex items-start gap-3"
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
      layout
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
                exit={{ height: 0, opacity: 0, marginBottom: 0, transition: collapseAfter(t, i * 0.06) }}
                initial={{ opacity: 0 }}
                key={member.key}
                layout="position"
                layoutId={member.key}
                transition={{ layout: t.spring, default: t.fade }}
              >
                {memberCols.map((col, at) => {
                  const value = member.cells[col.id] ?? null;
                  return (
                    <span
                      className={cn(
                        "truncate",
                        at === 0 ? "text-muted-foreground" : at === memberCols.length - 1 && "ms-auto",
                        value === null && "text-muted-foreground italic",
                      )}
                      key={col.id}
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
