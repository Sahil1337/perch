"use client";

// The player: where the walk is (section, station, phase), whether it is moving, and how fast.
// Paused, the scene holds at its position and any in-flight motion simply finishes; play resumes
// from there. Stepping crosses station boundaries, skipping stations the query does not use or that
// failed — and it crosses SECTION boundaries the same way, so the last station of one chapter runs
// straight into the first station of the next. There is nothing to navigate back out of.

import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import { Kbd } from "../../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { BoundSection } from "./bound-section";
import { Chapters } from "./chapters";
import type { SourceRef } from "./clauses";
import { HOLD_MS, phasesFor, sentenceFor, type Phase } from "./narration";
import { Narrator } from "./narrator";
import { sectionForSource, type SectionId } from "./program";
import { Rail } from "./rail";
import { buildScene, countAt, errorOf, inputCount, sampleId } from "./scenes";
import { SectionHold } from "./section-hold";
import { SkippedNote } from "./skipped-note";
import { Stage } from "./stage";
import {
  runsPerRow,
  stationState,
  type ProgramData,
  type Probe,
  type SectionRun,
  type StationState,
} from "./use-walk";
import { SpeedContext } from "./walk-motion";

type Pos = { section: number; station: number; phase: number };

/**
 * A section with no station walk still gets a beat of playback. Skipping past it silently would say
 * it is not part of the query, which is the one thing the placeholder it shows exists to deny.
 *
 * A `per-row` section is the exception and is NOT on this clock: it has a timeline of its own, one
 * beat per outer row, and it says when it is finished by calling `onDone`. Marching past it after
 * 2.2 seconds would cut it off in the middle of the only thing it exists to show.
 */
const HOLD_PHASE: readonly Phase[] = [{ ms: 2200, label: "not run" }];

const NO_STATES: readonly StationState[] = [];

/** The walk to step through, or null when the section holds a placeholder instead of running. */
function walkOf(run: SectionRun | undefined): SectionRun["walk"] {
  return run && !runsPerRow(run.status) ? run.walk : null;
}

/**
 * Whether the focused control wants the arrow keys for itself.
 *
 * The walk binds them on `window` in the capture phase, which is what lets them step the scene from
 * wherever focus happens to sit — and which also means a control that steers with arrows cannot get
 * them back by stopping propagation. A text field never wanted them; neither does the bound
 * section's scrubber, which is a slider and moves by one row per press.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

function ownsArrowKeys(target: EventTarget | null): boolean {
  if (isTypingTarget(target)) return true;
  const element = target as HTMLElement | null;
  return (
    element !== null &&
    typeof element.closest === "function" &&
    element.closest('[role="slider"]') !== null
  );
}

export function WalkPlayer({ data, probe }: { data: ProgramData; probe: Probe }): React.ReactElement {
  const { program, sections } = data;

  // Every section's station states, not just the open one: stepping out of the end of a chapter
  // has to know which station the next chapter starts on before it gets there.
  const statesOf = React.useMemo(
    () =>
      sections.map((run): readonly StationState[] => {
        const walk = walkOf(run);
        return walk ? walk.stations.map((station, i) => stationState(station, walk.results[i])) : [];
      }),
    [sections],
  );

  const playable = React.useCallback(
    (section: number, station: number): boolean => {
      const state = statesOf[section]?.[station];
      return state === "ready" || state === "loading";
    },
    [statesOf],
  );
  const edgePlayable = React.useCallback(
    (section: number, from: "first" | "last"): number | null => {
      const n = statesOf[section]?.length ?? 0;
      for (let k = 0; k < n; k++) {
        const i = from === "first" ? k : n - 1 - k;
        if (playable(section, i)) return i;
      }
      return null;
    },
    [playable, statesOf],
  );
  const stepPlayable = React.useCallback(
    (section: number, from: number, delta: 1 | -1): number | null => {
      const n = statesOf[section]?.length ?? 0;
      for (let k = from + delta; k >= 0 && k < n; k += delta) if (playable(section, k)) return k;
      return null;
    },
    [playable, statesOf],
  );
  const phaseCount = React.useCallback(
    (section: number, station: number): number => {
      const walk = walkOf(sections[section]);
      if (!walk || !walk.stations[station]) return HOLD_PHASE.length;
      return phasesFor(station, walk, statesOf[section]?.[station] ?? "loading").length;
    },
    [sections, statesOf],
  );

  /** Where playback lands when it enters a chapter from either end. */
  const enter = React.useCallback(
    (section: number, edge: "start" | "end"): Pos => {
      if (edge === "start") return { section, station: edgePlayable(section, "first") ?? 0, phase: 0 };
      const station = edgePlayable(section, "last");
      if (station === null) return { section, station: 0, phase: 0 };
      return { section, station, phase: phaseCount(section, station) - 1 };
    },
    [edgePlayable, phaseCount],
  );

  const ahead = React.useCallback(
    (at: Pos): Pos | null => {
      if (at.phase < phaseCount(at.section, at.station) - 1) return { ...at, phase: at.phase + 1 };
      const next = stepPlayable(at.section, at.station, 1);
      if (next !== null) return { section: at.section, station: next, phase: 0 };
      // The chapter is finished. This is the section boundary: the next one opens at its first
      // playable station, and the program's order guarantees its inputs already ran.
      return at.section + 1 < sections.length ? enter(at.section + 1, "start") : null;
    },
    [enter, phaseCount, sections.length, stepPlayable],
  );
  const behind = React.useCallback(
    (at: Pos): Pos | null => {
      if (at.phase > 0) return { ...at, phase: at.phase - 1 };
      const prev = stepPlayable(at.section, at.station, -1);
      if (prev !== null) {
        return { section: at.section, station: prev, phase: phaseCount(at.section, prev) - 1 };
      }
      return at.section > 0 ? enter(at.section - 1, "end") : null;
    },
    [enter, phaseCount, stepPlayable],
  );

  const [pos, setPos] = React.useState<Pos>({ section: 0, station: 0, phase: 0 });
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const touched = React.useRef(false);

  // The position clamped to what actually exists. A section's walk can be shorter than the one
  // before it, and a station's phase count changes the moment its results land, so every read below
  // goes through `at` rather than through the raw state.
  const sectionIndex = Math.min(pos.section, sections.length - 1);
  const run = sections[sectionIndex];
  const walk = walkOf(run);
  const states = statesOf[sectionIndex] ?? NO_STATES;
  const stationIndex = Math.min(pos.station, Math.max(0, (walk?.stations.length ?? 0) - 1));
  const station = walk?.stations[stationIndex] ?? null;
  const state = states[stationIndex] ?? "loading";
  const stationPhases = React.useMemo(
    () => (walk && station ? phasesFor(stationIndex, walk, state) : HOLD_PHASE),
    [stationIndex, state, station, walk],
  );
  const lastPhase = stationPhases.length - 1;
  const phase = Math.min(pos.phase, lastPhase);
  const at: Pos = { section: sectionIndex, station: stationIndex, phase };
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

  // Memoised on the position's parts rather than on `at`, which is a fresh object every render:
  // these two are the dependency of every control and of the key bindings.
  const next = React.useMemo(() => ahead(at), [ahead, at.section, at.station, at.phase]);
  const previous = React.useMemo(() => behind(at), [behind, at.section, at.station, at.phase]);

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
      setPos(enter(index, "start"));
    },
    [enter],
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
    if (!playing && next === null) setPos(enter(0, "start"));
    setPlaying((p) => !p);
  }, [enter, next, playing]);
  /** The bound section's scrubber was grabbed: stop where we are, and stay stopped. */
  const pause = React.useCallback(() => {
    touched.current = true;
    setPlaying(false);
  }, []);

  // `next` through a ref, so the callback a per-row section holds for the whole time it is on screen
  // never has to be rebuilt — a new identity would restart its row timer on every render.
  const nextRef = React.useRef(next);
  React.useEffect(() => {
    nextRef.current = next;
  }, [next]);
  const advance = React.useCallback(() => {
    const target = nextRef.current;
    if (target) setPos(target);
    else setPlaying(false);
  }, []);

  // Auto-play a beat after there is something to show, unless the reader took the controls first.
  // A program whose first chapter cannot run counts as settled straight away: its placeholder is
  // already on screen and waiting for a probe that will never be sent would strand playback.
  const settled = holding || state === "ready";
  React.useEffect(() => {
    if (!settled) return;
    const id = setTimeout(() => {
      if (!touched.current) setPlaying(true);
    }, 1000);
    return () => clearTimeout(id);
  }, [settled]);

  // The schedule only runs while playing, and only once the station's data is there: a station
  // still loading holds the player until its results land, then this effect re-runs.
  React.useEffect(() => {
    if (!playing || !settled) return;
    // A per-row section keeps its own time — one beat per outer row — and calls `advance` when it
    // has shown the last one. Its chapter would otherwise end after a single 2.2-second hold.
    if (perRow) return;
    if (next === null) {
      setPlaying(false);
      return;
    }
    const dwell = holding ? HOLD_PHASE[0]!.ms : (stationPhases[phase]?.ms ?? 800);
    // Leaving a station — or a whole chapter — rests on its settled state before moving on.
    const rest = phase === lastPhase ? HOLD_MS : 0;
    const id = setTimeout(() => setPos(next), (dwell + rest) / speed);
    return () => clearTimeout(id);
  }, [holding, lastPhase, next, perRow, phase, playing, settled, speed, stationPhases]);

  // Bound only while the walk is mounted, which is only while the dialog is open. The dialog is
  // modal, so the editor never sees these; typing targets inside it still keep their keys. Capture
  // phase, because a focused control inside the dialog (a rail dot after a click) stops arrow keys
  // from bubbling, and the arrows must step the walk wherever focus happens to sit.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        togglePlay();
      } else if (ownsArrowKeys(event.target)) {
        return;
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepForward();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepBack();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [togglePlay, stepForward, stepBack]);

  const scene = React.useMemo(
    () => (walk ? buildScene(stationIndex, phase, walk) : null),
    [phase, stationIndex, walk],
  );
  const sentence = React.useMemo(
    () => (walk ? sentenceFor(stationIndex, walk) : ""),
    [stationIndex, walk],
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
          <div aria-label="Playback" className="ms-auto flex shrink-0 items-center gap-1" role="toolbar">
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
              <Stage scene={scene} sourceLink={sourceLink} state={state} />
            </div>
            <Narrator
              count={count}
              error={error}
              input={input}
              onPhase={gotoPhase}
              phase={phase}
              phases={stationPhases}
              result={walk.results[stationIndex]}
              sentence={sentence}
              sql={walk.parsed.text}
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
            probe={probe}
            program={program}
            section={run.section}
          />
        ) : run ? (
          <SectionHold section={run.section} />
        ) : null}
      </div>
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
