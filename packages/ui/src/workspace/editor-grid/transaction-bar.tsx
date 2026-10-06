import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { minuteOf } from "../../lib/format";
import { useCollapse } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { useWorkspace } from "../context";
import { sessionKeyOf, type Buffer } from "../types";

type Ending = "commit" | "rollback";

/**
 * The tab's runs left a transaction open, and its next run continues it. Easy to forget between
 * runs, and it holds its locks all the while, so it is said above the editor with both ways out.
 * They go through `execute`: recorded in History, without taking the results pane away from what
 * was being read.
 */
export function TransactionBar({ buffer }: { buffer: Buffer }): React.ReactElement {
  const { execute, transactionFor } = useWorkspace();
  const collapse = useCollapse();
  const transaction = transactionFor(buffer.id);
  const [ending, setEnding] = React.useState<Ending | null>(null);
  /** Keyed by the transaction it happened to, so a later one does not inherit the message. */
  const [failure, setFailure] = React.useState<{ since: string; message: string } | null>(null);

  async function end(how: Ending, since: string): Promise<void> {
    setEnding(how);
    setFailure(null);
    const record = await execute(how === "commit" ? "COMMIT;" : "ROLLBACK;", {
      sessionKey: sessionKeyOf(buffer),
    });
    setEnding(null);
    if (record.status !== "done") {
      setFailure({ since, message: record.error?.message ?? "It did not finish." });
    }
  }

  const failed = transaction?.state === "failed";
  const busy = ending !== null || (transaction?.running ?? false);

  return (
    <AnimatePresence initial={false}>
      {transaction && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="shrink-0 overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          key="transaction"
          transition={collapse}
        >
          <div
            className={cn(
              "flex h-8 items-center gap-2 border-b px-3 text-xs",
              failed ? "border-destructive/24 bg-destructive/8" : "border-info/24 bg-info/8",
            )}
            role="status"
          >
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-info")}
            />
            <span className="shrink-0 font-medium">
              {failed ? "Transaction failed" : "Transaction open"}
            </span>
            <span className="min-w-0 truncate text-muted-foreground">
              {failed
                ? "· only a rollback will run"
                : `· since ${minuteOf(transaction.since)}`}
            </span>
            {failure?.since === transaction.since && (
              <span className="min-w-0 truncate text-destructive-foreground">
                {failure.message}
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {!failed && (
                <Button
                  disabled={busy}
                  loading={ending === "commit"}
                  onClick={() => void end("commit", transaction.since)}
                  size="xs"
                  variant="outline"
                >
                  Commit
                </Button>
              )}
              <Button
                disabled={busy}
                loading={ending === "rollback"}
                onClick={() => void end("rollback", transaction.since)}
                size="xs"
                variant="outline"
              >
                Roll back
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
