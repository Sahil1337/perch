import { Fragment, type Ref } from "react";
import { Slip } from "../../materials";
import { CELL_BREAK, CELLS, type Cell, FILE_NAME } from "./notebook";
import { ResultSlip } from "./result-slip";

/** The file's name on a tab of the same paper, tucked under the strip's top edge. */
function FileTab({ ref }: { ref: Ref<HTMLElement> }) {
  return (
    <span
      ref={ref}
      className="absolute bottom-full left-2 -z-10 block translate-y-1 rounded-t-sm bg-paper px-2.5 pt-1 pb-1 font-mono text-sm/5 text-paper-ink"
    >
      {FILE_NAME}
    </span>
  );
}

/** A `-- %%` line, printed as what it is to a notebook: a place to tear the file. */
function Perforation() {
  return (
    <div className="relative flex h-4 items-center px-1.5 lg:h-6">
      <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-paper-muted/60" />
      <span className="relative bg-paper px-1 text-sm/4 text-paper-muted">{CELL_BREAK}</span>
    </div>
  );
}

/**
 * One cell's SQL, as much as fits: a line under lg, filled to the edge as a printer would, and two
 * lines from lg, broken between words.
 */
function CellText({ cell, index }: { cell: Cell; index: number }) {
  return (
    <div className="relative px-2.5 py-0.5 lg:py-2">
      <div className="line-clamp-1 text-sm/5 break-all whitespace-pre-line lg:line-clamp-2 lg:break-normal">
        {cell.sql}
      </div>
      <ResultSlip cell={cell} index={index} />
    </div>
  );
}

/** The whole .sql file on one strip of receipt paper, its cells parted by perforations. */
export function Strip({ tabRef }: { tabRef: Ref<HTMLElement> }) {
  return (
    <div className="relative">
      <FileTab ref={tabRef} />
      <Slip className="py-1 lg:py-2">
        {CELLS.map((cell, index) => (
          <Fragment key={cell.sql}>
            {index > 0 ? <Perforation /> : null}
            <CellText cell={cell} index={index} />
          </Fragment>
        ))}
      </Slip>
    </div>
  );
}
