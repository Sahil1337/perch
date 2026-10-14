import { Slip } from "../../../materials";

/**
 * "Copied", on a slip that slides out from under the return key, as the first view's rows come out
 * of its return key, and tucks back in. Always laid out, so showing it moves nothing.
 */
export function CopiedSlip({ shown }: { shown: boolean }) {
  return (
    <Slip
      aria-hidden
      tilt={1}
      data-shown={shown || undefined}
      className="pointer-events-none absolute top-full right-1 mt-2 -translate-y-2 px-2 py-1 text-xs leading-4 opacity-0 transition duration-300 ease-out data-shown:translate-y-0 data-shown:opacity-100 motion-reduce:transition-none lg:px-2.5 lg:text-sm lg:leading-5"
    >
      Copied
    </Slip>
  );
}
