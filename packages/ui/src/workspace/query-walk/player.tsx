"use client";

// The player: where the walk is (section, station, phase), whether it is moving, and how fast.
// Paused, the scene holds at its position and any in-flight motion simply finishes; play resumes
// from there. Stepping crosses station boundaries, skipping stations the query does not use or that
// failed — and it crosses SECTION boundaries the same way, so the last station of one chapter runs
// straight into the first station of the next. There is nothing to navigate back out of.

import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import type { SqlComment } from "@perch/sql";
import * as React from "react";
import { Button } from "../../ui/button";
import { Kbd } from "../../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { EvidenceContext, useEvidenceStore } from "./bound-evidence";
import { BoundSection } from "./bound-section";
import { Chapters } from "./chapters";
import type { SourceRef } from "./clauses";
import { BEAT, HOLD_MS, phasesFor, sentenceFor } from "./narration";
import { Narrator } from "./narrator";
import { projectionsIn, sectionForSource, type SectionId } from "./program";
import { Rail } from "./rail";
import { buildScene, countAt, errorOf, inputCount, sampleId } from "./scenes";
import { SectionHold } from "./section-hold";
import { SkippedNote } from "./skipped-note";
import { Stage } from "./stage";
import type { StationId } from "./steps";
import { buildTerminus } from "./terminus";
import { useAutoPlay, useBeat, useWalkKeys } from "./use-playback";
import { runsPerRow, stationState, type ProgramData, type StationState } from "./use-walk";
import { useWalk } from "./walk-context";
import { HOLD_PHASE, WalkCursor, walkOf, type Pos } from "./walk-cursor";
import { RowsMoveContext, SpeedContext } from "./walk-motion";

/**
 * Stations whose rows change POSITION rather than contents, and so the only ones whose rows are
 * worth animating from where they were: what survives a filter slides up into the gap the rejected
 * rows left, a sort re-orders the card, a cut drops the tail.
 *
 * Everywhere else a row's CELLS change — a projection, a window function, a grouping — which changes
 * the key it is drawn under, so the old row leaves and a new one arrives however the layout system
 * is configured. Tracking those rows anyway bought nothing and had every row on stage measured on
 * every frame of every transition. See `Row` in `stage.tsx`.
 */
const MOVING_STATIONS: ReadonlySet<StationId> = new Set<StationId>([
  "where",
  "having",
  "distinct",
  "order",
  "limit",
]);

export function WalkPlayer({
  data,
  comments,
}: {
  data: ProgramData;
  /** Stripped out of the statement before the program was built, and carried through to the
   *  narrator's Notes tab — the one place in the walk that still shows them. */
  comments: readonly SqlComment[];
}): React.ReactElement {
  const { program } = useWalk();
  const { sections } = data;
  // What the bound chapters measured, held for the whole program so the last station can explain an
  // empty result out of numbers that have already been fetched.
  const store = useEvidenceStore(program);

  const statesOf = React.useMemo(
    () =>
      sections.map((run): readonly StationState[] => {
        const walk = walkOf(run);
        return walk ? walk.stations.map((station, i) => stationState(station, walk.results[i])) : [];
      }),
    [sections],
  );
  // One object rebuilt when either of its two inputs changes, rather than seven `useCallback`s
  // chained into each other's dependency arrays over exactly those two values.
  const cursor = React.useMemo(() => new WalkCursor(sections, statesOf), [sections, statesOf]);

  const [pos, setPos] = React.useState<Pos>({ section: 0, station: 0, phase: 0 });
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const touched = React.useRef(false);

  // The position clamped to what actually exists, so every read below goes through the clamped
  // values rather than through the raw state.
  const { section: sectionIndex, station: stationIndex, phase } = cursor.clamp(pos);
  const run = cursor.runAt(sectionIndex);
  const walk = cursor.walkAt(sectionIndex);
  const states = cursor.statesAt(sectionIndex);
  const station = walk?.stations[stationIndex] ?? null;
  const state = states[stationIndex] ?? "loading";
  // Memoised because its IDENTITY is a dependency of the beat below: a fresh array every render
  // would restart the station's timer every render.
  const stationPhases = React.useMemo(
    () => (walk && station ? phasesFor(stationIndex, walk, state) : HOLD_PHASE),
    [stationIndex, state, station, walk],
  );
  const lastPhase = stationPhases.length - 1;
  /** The section has nothing to run: the stage shows why instead of a walk. */
  const holding = walk === null || station === null;
  /** The section hands its stage to `BoundSection` rather than to the station walk. */
  const boundView = run !== undefined && runsPerRow(run.status);
  /**
   * …and it has rows to step through, so it owns the clock as well as the stage.
   *
   * A `held` section is deliberately NOT included: it shows a note and nothing else, so it keeps the
   * ordinary 2.2-second hold. Letting it take the clock would stall playback there for good, because
   * a note has no last row to finish on and would never say it was done.
   */
  const perRow = run?.status === "per-row";

  // Built from the clamped numbers rather than from a `Pos` object, so the dependency array says
  // everything these two read. They are the dependency of every control and of the key bindings.
  const next = React.useMemo(
    () => cursor.ahead({ section: sectionIndex, station: stationIndex, phase }),
    [cursor, phase, sectionIndex, stationIndex],
  );
  const previous = React.useMemo(
    () => cursor.behind({ section: sectionIndex, station: stationIndex, phase }),
    [cursor, phase, sectionIndex, stationIndex],
  );

  const goto = React.useCallback(
    (index: number) => {
      touched.current = true;
      setPos({ section: sectionIndex, station: index, phase: 0 });
    },
    [sectionIndex],
  );
  const gotoPhase = React.useCallback(
    (index: number) => {
      touched.current = true;
      setPos({ section: sectionIndex, station: stationIndex, phase: index });
    },
    [sectionIndex, stationIndex],
  );
  const gotoSection = React.useCallback(
    (index: number) => {
      touched.current = true;
      setPos(cursor.enter(index, "start"));
    },
    [cursor],
  );
  const openSection = React.useCallback(
    (id: SectionId) => {
      const index = sections.findIndex((entry) => entry.section.id === id);
      if (index >= 0) gotoSection(index);
    },
    [gotoSection, sections],
  );
  const stepForward = React.useCallback(() => {
    touched.current = true;
    if (next) setPos(next);
  }, [next]);
  const stepBack = React.useCallback(() => {
    touched.current = true;
    if (previous) setPos(previous);
  }, [previous]);
  const togglePlay = React.useCallback(() => {
    touched.current = true;
    if (!playing && next === null) setPos(cursor.enter(0, "start"));
    setPlaying((p) => !p);
  }, [cursor, next, playing]);
  /** The bound section's scrubber was grabbed: stop where we are, and stay stopped. */
  const pause = React.useCallback(() => {
    touched.current = true;
    setPlaying(false);
  }, []);


  // `next` through a ref, so the callback a per-row section holds for the whole time it is on screen
  // never has to be rebuilt — a new identity would restart its row timer on every render. This is
  // the textbook case for `useEffectEvent`: a stable function that always sees the latest value.
  // Written by hand until that is out of experimental, and the ref IS what the hook compiles to.
  const nextRef = React.useRef(next);
  React.useEffect(() => {
    nextRef.current = next;
  }, [next]);
  const advance = React.useCallback(() => {
    const target = nextRef.current;
    if (target) setPos(target);
    else setPlaying(false);
  }, []);

  const settled = holding || state === "ready";
  const dwell = holding ? HOLD_PHASE[0].ms : (stationPhases[phase]?.ms ?? 800);
  // Leaving a station — or a whole chapter — rests on its settled state before moving on.
  const rest = phase === lastPhase ? HOLD_MS : 0;

  const startPlaying = React.useCallback(() => setPlaying(true), []);
  const stopPlaying = React.useCallback(() => setPlaying(false), []);
  useAutoPlay(settled, touched, startPlaying);
  useBeat({
    delayMs: ((dwell + rest) * BEAT) / speed,
    next,
    onEnd: stopPlaying,
    onMove: setPos,
    perRow,
    playing,
    settled,
  });
  useWalkKeys({ stepBack, stepForward, togglePlay });

  const built = React.useMemo(
    () => (walk ? buildScene(stationIndex, phase, walk) : null),
    [phase, stationIndex, walk],
  );
  // The nearest-miss card, and only on the MAIN chapter: an empty CTE is an intermediate result and
  // the query around it may well want it empty, where an empty final result is the answer itself.
  const terminus = React.useMemo(
    () =>
      walk && run?.section.id === program.mainId
        ? buildTerminus({
            walk,
            index: stationIndex,
            dialect: program.dialect,
            evidence: store.evidence,
          })
        : null,
    [program.dialect, program.mainId, run?.section.id, stationIndex, store.evidence, walk],
  );
  // The card explaining the emptiness, and the line on the empty card that introduces it. The line
  // replaces `No rows.`, which is true and says nothing about which test emptied them.
  const scene = React.useMemo(() => {
    if (built === null || terminus === null || built.kind !== "tables") return built;
    return {
      ...built,
      terminus,
      tables: built.tables.map((view, at) => (at === 0 ? { ...view, empty: terminus.why } : view)),
    };
  }, [built, terminus]);
  // A column whose value comes from a subquery is not computed at the SELECT station — it has a
  // chapter of its own — and the station's sentence is the only place that can say so.
  const projections = React.useMemo(
    () =>
      run
        ? projectionsIn(program, run.section).map((child) => ({
            label: child.label,
            perRow: child.binding.kind === "bound",
          }))
        : [],
    [program, run],
  );
  const sentence = React.useMemo(
    () => (walk ? sentenceFor(stationIndex, walk, projections) : ""),
    [projections, stationIndex, walk],
  );

  // A FROM card whose source became a section of its own points AT that section rather than
  // offering to walk into it: the rows it shows were computed there, once, and are still on the
  // strip one click away.
  const sourceLink = React.useCallback(
    (source: SourceRef) => {
      const found = run ? sectionForSource(program, run.section, source) : null;
      return found ? { label: found.label, onJump: () => openSection(found.id) } : null;
    },
    [openSection, program, run],
  );

  const input = walk ? inputCount(walk, stationIndex) : null;
  const count =
    walk && station
      ? phase === 0 && station.id !== "from"
        ? (scene?.count ?? countAt(walk, stationIndex))
        : (scene?.count ?? null)
      : null;
  const error = station ? errorOf(walk?.results[stationIndex], sampleId(station)) : null;
  const strip = sections.length > 1 || program.skipped.length > 0;

  return (
    <SpeedContext.Provider value={speed}>
      <EvidenceContext.Provider value={store}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {strip && (
            <div className="flex min-w-0 shrink-0 flex-col gap-0.5 border-b pb-2">
              {sections.length > 1 && (
                <Chapters
                  active={sectionIndex}
                  onJump={gotoSection}
                  sections={sections}
                  writtenOrder={program.setOp !== null}
                />
              )}
              {program.skipped.length > 0 && <SkippedNote parts={program.skipped} />}
            </div>
          )}

          <div className="flex min-w-0 items-start gap-4">
            {walk && (
              <Rail active={stationIndex} onJump={goto} states={states} stations={walk.stations} />
            )}
            <div
              aria-label="Playback"
              className="ms-auto flex shrink-0 items-center gap-1"
              role="toolbar"
            >
              <Control disabled={previous === null} hint="←" label="Step back" onClick={stepBack}>
                <SkipBackIcon />
              </Control>
              <Control hint="space" label={playing ? "Pause" : "Play"} onClick={togglePlay} primary>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </Control>
              <Control disabled={next === null} hint="→" label="Step forward" onClick={stepForward}>
                <SkipForwardIcon />
              </Control>
              <div aria-hidden className="mx-1 h-4 w-px bg-border" />
              <Button
                aria-label={`Speed ${speed}x, click to change`}
                onClick={() => setSpeed((s) => (s === 1 ? 0.5 : 1))}
                size="xs"
                variant="outline"
              >
                <span className="font-mono tabular-nums">{speed === 1 ? "1×" : "0.5×"}</span>
              </Button>
            </div>
          </div>

          {walk && station && scene ? (
            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-3">
              <div className="flex min-h-0 min-w-0 flex-col md:col-span-2">
                <RowsMoveContext.Provider value={MOVING_STATIONS.has(station.id)}>
                  <Stage
                    scene={scene}
                    sceneKey={run?.section.id ?? ""}
                    sourceLink={sourceLink}
                    state={state}
                  />
                </RowsMoveContext.Provider>
              </div>
              <Narrator
                comments={comments}
                count={count}
                error={error}
                input={input}
                onPhase={gotoPhase}
                phase={phase}
                phases={stationPhases}
                result={walk.results[stationIndex]}
                root={program.text}
                section={run?.section ?? null}
                sentence={terminus === null ? sentence : `${sentence} ${terminus.sentence}`}
                sql={walk.text}
                state={state}
                station={station}
              />
            </div>
          ) : run && boundView ? (
            <BoundSection
              onDone={advance}
              onOpenSection={openSection}
              onPause={pause}
              playing={playing}
              section={run.section}
            />
          ) : run ? (
            <SectionHold section={run.section} />
          ) : null}
        </div>
      </EvidenceContext.Provider>
    </SpeedContext.Provider>
  );
}

function Control({
  label,
  hint,
  onClick,
  disabled,
  primary,
  children,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            size="icon-sm"
            variant={primary ? "default" : "ghost"}
          >
            {children}
          </Button>
        }
      />
      <TooltipPopup>
        {label} <Kbd>{hint}</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
