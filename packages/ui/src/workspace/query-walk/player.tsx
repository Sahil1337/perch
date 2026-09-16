"use client";

// The player: where the walk is (station, phase), whether it is moving, and how fast. Paused, the
// scene holds at its position and any in-flight motion simply finishes; play resumes from there.
// Stepping crosses station boundaries, skipping stations the query does not use or that failed.

import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import { Kbd } from "../../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import type { SourceRef } from "./clauses";
import { HOLD_MS, phasesFor, sentenceFor } from "./narration";
import { Narrator } from "./narrator";
import { Rail } from "./rail";
import { buildScene, countAt, errorOf, inputCount, sampleId } from "./scenes";
import { Stage } from "./stage";
import { stationState, type WalkData } from "./use-walk";
import { SpeedContext } from "./walk-motion";

type Pos = { station: number; phase: number };

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

export function WalkPlayer({
  walk,
  onWalk,
}: {
  walk: WalkData;
  onWalk: (source: SourceRef) => void;
}): React.ReactElement {
  const { stations, results } = walk;
  const states = React.useMemo(
    () => stations.map((station, i) => stationState(station, results[i])),
    [stations, results],
  );
  const playable = React.useCallback(
    (i: number): boolean => states[i] === "ready" || states[i] === "loading",
    [states],
  );
  const nextPlayable = React.useCallback(
    (i: number): number | null => {
      for (let k = i + 1; k < stations.length; k++) if (playable(k)) return k;
      return null;
    },
    [playable, stations.length],
  );
  const prevPlayable = React.useCallback(
    (i: number): number | null => {
      for (let k = i - 1; k >= 0; k--) if (playable(k)) return k;
      return null;
    },
    [playable],
  );

  const [pos, setPos] = React.useState<Pos>({ station: 0, phase: 0 });
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const touched = React.useRef(false);

  const station = stations[pos.station]!;
  const state = states[pos.station] ?? "loading";
  const stationPhases = React.useMemo(() => phasesFor(pos.station, walk, state), [pos.station, walk, state]);
  const lastPhase = stationPhases.length - 1;
  const phase = Math.min(pos.phase, lastPhase);
  const atEnd = nextPlayable(pos.station) === null && phase === lastPhase;

  const goto = React.useCallback((index: number) => {
    touched.current = true;
    setPos({ station: index, phase: 0 });
  }, []);
  const stepForward = React.useCallback(() => {
    touched.current = true;
    if (phase < lastPhase) {
      setPos({ station: pos.station, phase: phase + 1 });
      return;
    }
    const next = nextPlayable(pos.station);
    if (next !== null) setPos({ station: next, phase: 0 });
  }, [phase, lastPhase, nextPlayable, pos.station]);
  const stepBack = React.useCallback(() => {
    touched.current = true;
    if (phase > 0) {
      setPos({ station: pos.station, phase: phase - 1 });
      return;
    }
    const prev = prevPlayable(pos.station);
    if (prev !== null) {
      setPos({ station: prev, phase: phasesFor(prev, walk, states[prev] ?? "loading").length - 1 });
    }
  }, [phase, pos.station, prevPlayable, states, walk]);
  const canForward = phase < lastPhase || nextPlayable(pos.station) !== null;
  const canBack = phase > 0 || prevPlayable(pos.station) !== null;
  const togglePlay = React.useCallback(() => {
    touched.current = true;
    if (!playing && atEnd) setPos({ station: 0, phase: 0 });
    setPlaying((p) => !p);
  }, [playing, atEnd]);

  // Auto-play a beat after the first station lands, unless the reader has already taken the controls.
  const firstReady = states[0] === "ready";
  React.useEffect(() => {
    if (!firstReady) return;
    const id = setTimeout(() => {
      if (!touched.current) setPlaying(true);
    }, 1000);
    return () => clearTimeout(id);
  }, [firstReady]);

  // The schedule only runs while playing, and only once the station's data is there: a station
  // still loading holds the player until its results land, then this effect re-runs.
  React.useEffect(() => {
    if (!playing || state !== "ready") return;
    const ms = (stationPhases[phase]?.ms ?? 800) / speed;
    if (phase < lastPhase) {
      const id = setTimeout(() => setPos({ station: pos.station, phase: phase + 1 }), ms);
      return () => clearTimeout(id);
    }
    const next = nextPlayable(pos.station);
    if (next === null) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setPos({ station: next, phase: 0 }), ms + HOLD_MS / speed);
    return () => clearTimeout(id);
  }, [playing, state, stationPhases, phase, lastPhase, speed, nextPlayable, pos.station]);

  // Bound only while the walk is mounted, which is only while the dialog is open. The dialog is
  // modal, so the editor never sees these; typing targets inside it still keep their keys. Capture
  // phase, because a focused control inside the dialog (a rail dot after a click) stops arrow keys
  // from bubbling, and the arrows must step the walk wherever focus happens to sit.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
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

  const scene = React.useMemo(() => buildScene(pos.station, phase, walk), [pos.station, phase, walk]);
  const sentence = React.useMemo(() => sentenceFor(pos.station, walk), [pos.station, walk]);
  const input = inputCount(walk, pos.station);
  const count = phase === 0 && station.id !== "from" ? (scene.count ?? countAt(walk, pos.station)) : scene.count;
  const error = errorOf(results[pos.station], sampleId(station));

  return (
    <SpeedContext.Provider value={speed}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start gap-4">
          <Rail active={pos.station} onJump={goto} states={states} stations={stations} />
          <div aria-label="Playback" className="ms-auto flex shrink-0 items-center gap-1" role="toolbar">
            <Control disabled={!canBack} hint="←" label="Step back" onClick={stepBack}>
              <SkipBackIcon />
            </Control>
            <Control hint="space" label={playing ? "Pause" : "Play"} onClick={togglePlay} primary>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </Control>
            <Control disabled={!canForward} hint="→" label="Step forward" onClick={stepForward}>
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

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-3">
          <div className="flex min-h-0 min-w-0 flex-col md:col-span-2">
            <Stage error={error} onWalk={onWalk} scene={scene} state={state} />
          </div>
          <Narrator
            count={count}
            input={input}
            phase={phase}
            phases={stationPhases}
            result={results[pos.station]}
            sentence={sentence}
            sql={walk.parsed.text}
            station={station}
          />
        </div>
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
