import { useCallback, useSyncExternalStore } from "react";

import {
  buildNumberSelectOptions,
  buildNumericSelectWidthStyle,
  getNumericSelectDigitCount
} from "./builder-inline-number-select";
import {
  CAROUSEL_IMAGE_FRAME_LIMITS,
  CAROUSEL_SHADOW_ANGLE_STEP,
  carouselShadowOffsets,
  carouselShadowOffsetSettings,
  carouselShadowPolar,
  carouselShadowPolarIsReachable,
  type CarouselShadowPolar
} from "@/lib/builder-carousel-image-frame";

/**
 * SHADOW ANGLE and SHADOW DISTANCE — the second view of Shadow X / Shadow Y.
 *
 * Operator, 2026-08-25: *"On dropshadow tools I've used before, there are
 * X/Y settings AND direction."* All four controls are live at once and edit
 * the same two stored numbers, so swinging a shadow round to the other side
 * of a picture at the same distance is one pick rather than two sums done by
 * hand.
 *
 * ONE component, used by the image module's schema-driven panel and by the
 * Carousel's hand-built Image Border column. The two panels already share a
 * shadow engine (`builder-carousel-image-frame.ts`); sharing the control is
 * what stops them growing two ideas of the same shadow.
 */

type Settings = Record<string, string | undefined>;

type PolarControlProps = {
  settings: Settings;
  /** WHOSE panel this is. The remembered pick is scoped to it — several
   *  module cards are expanded at once in the Builder, so a memory with no
   *  owner is one module's pick honoured on another's rows. */
  moduleId: string;
  /** Both keys in ONE update — an angle edit that wrote X and then Y would
   *  briefly describe a shadow at neither position. */
  onChange: (values: { imageShadowX: string; imageShadowY: string }) => void;
};

/**
 * WHAT THE OPERATOR PICKED, remembered until the offsets say otherwise.
 *
 * The shadow's direction lives ONLY in `imageShadowX` and `imageShadowY`
 * (nothing new is stored — the whole point of the design), and whole pixels
 * cannot hold it exactly. Three things went wrong for that one reason, all
 * found in the real panel on 2026-09-07:
 *
 *  1. Picking 15 left the box reading 16, on 16 of the dial's 24 positions.
 *     Re-deriving is honest for a value the panel READ and wrong for one the
 *     operator just CHOSE from a list of fifteens.
 *  2. Taking Distance to 0 and back turned the shadow a quarter turn: at
 *     `0, 0` there is no direction left in the offsets to come back to.
 *  3. At Distance 0 the Angle control accepted a pick and did nothing at all,
 *     with nothing said (landmine 17's shape).
 *
 * So the pair the operator picked is held in the CONTROL's own memory — not
 * stored, never written to the page. It is honoured only while the offsets
 * are still the ones that pick produced: edit Shadow X or Shadow Y directly
 * and the fingerprint stops matching, so the panel goes straight back to
 * describing what the page is actually drawing. That is the one thing this
 * must never get wrong.
 *
 * It lives outside React because the two controls are separate rows in the
 * panel's grid with no common ancestor to hang a `useState` on, and because
 * of case 3: a pick at distance 0 writes the offsets it already had, so
 * nothing in the settings changes and only a store of our own can bring the
 * two boxes back to say what was chosen.
 *
 * IT IS APP-LEVEL STATE, and several module cards are expanded at once in the
 * Builder — so it is ONE MEMORY PER MODULE, not one memory. Two rounds of the
 * same bug came out of getting that wrong, and they are different mistakes:
 *
 *  - Round 2: a memory keyed on the offsets alone was honoured by ANY module
 *    whose offsets happened to match. Picking Angle 15 on a Slideshow left a
 *    Card Slider hand-set to the same `6, -2` reading 15 when its own offsets
 *    derive to 18. Fixed by putting the module's id in the fingerprint, which
 *    settled who may READ a memory.
 *  - Round 3: the store was still one slot holding one pick, so the moment a
 *    second module picked, the first module's memory was gone and its rows
 *    re-derived — the Slideshow's box went from the 15 it was picked at back
 *    to 16, with its offsets never moving. That is round 1's symptom exactly,
 *    and it settled how long a memory SURVIVES.
 *
 * Hence the map below, keyed by module id: a pick belongs to the panel that
 * made it, outlives any number of picks made on other panels, and is honoured
 * only while the offsets it produced are still the ones the page stores. Every
 * other panel re-derives from the page as though no pick had happened at all.
 *
 * The fingerprint keeps its own `moduleId` check even though the map already
 * separates the modules. The two guards answer different questions — the map
 * decides which memory a panel is shown, the fingerprint decides whether that
 * memory still describes the page — and the pure functions below are tested
 * on their own, where no map is involved.
 *
 * (An earlier version of this comment said the memory "lives in the open
 * panel and is gone when it closes". It never did — it is module-level state
 * and it outlives every panel. A comment describing a safety property the
 * code does not have is the thing that gets believed later, which is why the
 * measurements above found the bugs and the comment did not.)
 */
export type ShadowPolarMemory =
  | { moduleId: string; angle: number; distance: number; x: number; y: number }
  | null;

const pickedPolar = new Map<string, ShadowPolarMemory>();
const pickedPolarListeners = new Set<() => void>();

function readPickedPolarFor(moduleId: string): ShadowPolarMemory {
  return pickedPolar.get(moduleId) ?? null;
}

function writePickedPolarFor(moduleId: string, next: ShadowPolarMemory): void {
  if (next) pickedPolar.set(moduleId, next);
  else pickedPolar.delete(moduleId);
  pickedPolarListeners.forEach((listener) => listener());
}

function subscribePickedPolar(listener: () => void): () => void {
  pickedPolarListeners.add(listener);
  return () => {
    pickedPolarListeners.delete(listener);
  };
}

/** Forget every pick. Tests use it; nothing in the app needs to, because the
 *  fingerprint below already refuses a memory that has gone stale. */
export function clearShadowPolarMemory(): void {
  pickedPolar.clear();
  pickedPolarListeners.forEach((listener) => listener());
}

/**
 * The snapshot is ONE MODULE'S memory, never the map.
 *
 * That is what makes the store safe to write in place: `useSyncExternalStore`
 * re-renders on a snapshot that is not `Object.is`-equal to the last one, so a
 * snapshot of the map would compare equal after a `set` and the panel would
 * never update — while a per-module snapshot is the memory object itself,
 * which is replaced on write and left alone for every module that did not
 * pick. Every listener is notified on every write and each one re-reads its
 * own module; the ones that did not change get the identical object back and
 * React does nothing. If this is ever changed to hand out the map, it has to
 * become copy-on-write in the same edit.
 */
function usePickedPolar(moduleId: string): ShadowPolarMemory {
  const getSnapshot = useCallback(() => readPickedPolarFor(moduleId), [moduleId]);
  return useSyncExternalStore(subscribePickedPolar, getSnapshot, getSnapshot);
}

/**
 * What the two boxes SHOW: the remembered pick while it still describes the
 * stored offsets of the module that made it, and the offsets themselves the
 * moment it does not.
 *
 * The fingerprint is the whole guard, and it has three parts. A remembered
 * angle is at most the rounding of one pixel away from the offsets it
 * produced, so honouring it can never put the panel and the page on different
 * sides of the picture — but only for the module it was picked on, and only
 * while those offsets are still what the page stores. Anything else
 * re-derives.
 */
export function shadowPolarShown(
  settings: Settings,
  memory: ShadowPolarMemory,
  moduleId: string
): CarouselShadowPolar {
  const { x, y } = carouselShadowOffsets(settings);
  if (memory && memory.moduleId === moduleId && memory.x === x && memory.y === y) {
    return { angle: memory.angle, distance: memory.distance };
  }
  return carouselShadowPolar(settings);
}

/**
 * The options to offer, with the CURRENT value added when it is off the grid.
 *
 * `BuilderNumberSelectControl` snaps an off-grid value to the next one down
 * and WRITES that back as it mounts (the operator's 2026-08-12 call, so the
 * lists stay clean). That behaviour is right for a stored setting and wrong
 * here, because these two controls do not own a key: snapping a derived angle
 * would rewrite X and Y, which is a shadow moving on a live page because
 * somebody opened a panel and touched nothing. So this control never writes
 * unless it is picked, and shows the true value even when the grid has no
 * such option — the panel agreeing with the page outranks a tidy list.
 */
export function optionsIncluding(value: number, min: number, max: number, step: number): string[] {
  const options = buildNumberSelectOptions(min, max, step);
  const exact = String(value);
  if (options.includes(exact)) return options;
  return [...options, exact].sort((a, b) => Number(a) - Number(b));
}

function PolarSelect({
  value,
  min,
  max,
  step,
  ariaLabel,
  onPick
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  onPick: (next: number) => void;
}) {
  const options = optionsIncluding(value, min, max, step);
  return (
    <select
      aria-label={ariaLabel}
      className="builder-number-select-control"
      style={buildNumericSelectWidthStyle(getNumericSelectDigitCount(max, min))}
      value={String(value)}
      onChange={(event) => onPick(Number(event.target.value))}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** What a pick writes, and what the panel should remember of it. */
type ShadowPolarPick = {
  values: { imageShadowX: string; imageShadowY: string };
  memory: ShadowPolarMemory;
};

/**
 * The pair a pick asks for, turned into offsets and a memory.
 *
 * A pair the square CANNOT express is remembered as nothing: distance 57 at
 * 0 degrees draws at 40, and a box still reading 57 would describe a shadow
 * that is not on the page. The panel then falls back to the offsets and shows
 * the honest 40 — which is what the ticket's acceptance criteria ask for.
 */
function polarPick(moduleId: string, angle: number, distance: number): ShadowPolarPick {
  const values = carouselShadowOffsetSettings(angle, distance);
  if (!carouselShadowPolarIsReachable(angle, distance)) {
    return { values, memory: null };
  }
  return {
    values,
    memory: {
      moduleId,
      angle,
      distance,
      x: Number(values.imageShadowX),
      y: Number(values.imageShadowY)
    }
  };
}

/**
 * What an Angle pick writes: the new direction, at the distance the shadow
 * ALREADY has — the SHOWN distance, not a re-derived one, or picking an angle
 * would quietly move the shadow in or out by the pixel the offsets rounded.
 */
export function shadowAnglePick(
  settings: Settings,
  memory: ShadowPolarMemory,
  moduleId: string,
  angle: number
): ShadowPolarPick {
  return polarPick(moduleId, angle, shadowPolarShown(settings, memory, moduleId).distance);
}

/** The mirror: a Distance pick keeps the direction the shadow already shows —
 *  including through 0, where the offsets no longer hold one. */
export function shadowDistancePick(
  settings: Settings,
  memory: ShadowPolarMemory,
  moduleId: string,
  distance: number
): ShadowPolarPick {
  return polarPick(moduleId, shadowPolarShown(settings, memory, moduleId).angle, distance);
}

/** Which way the shadow falls: 0 is right, 90 up, 180 left, 270 below. */
export function BuilderImageShadowAngleControl({ settings, moduleId, onChange }: PolarControlProps) {
  const memory = usePickedPolar(moduleId);
  const { angle } = shadowPolarShown(settings, memory, moduleId);
  const limits = CAROUSEL_IMAGE_FRAME_LIMITS.shadowAngle;
  return (
    <PolarSelect
      ariaLabel="Shadow angle in degrees"
      max={limits.max}
      min={limits.min}
      step={CAROUSEL_SHADOW_ANGLE_STEP}
      value={angle}
      onPick={(next) => {
        const pick = shadowAnglePick(settings, memory, moduleId, next);
        writePickedPolarFor(moduleId, pick.memory);
        onChange(pick.values);
      }}
    />
  );
}

/** How far from the picture it falls — 0 to the square's diagonal, 57. */
export function BuilderImageShadowDistanceControl({ settings, moduleId, onChange }: PolarControlProps) {
  const memory = usePickedPolar(moduleId);
  const { distance } = shadowPolarShown(settings, memory, moduleId);
  const limits = CAROUSEL_IMAGE_FRAME_LIMITS.shadowDistance;
  return (
    <PolarSelect
      ariaLabel="Shadow distance in pixels"
      max={limits.max}
      min={limits.min}
      step={1}
      value={distance}
      onPick={(next) => {
        const pick = shadowDistancePick(settings, memory, moduleId, next);
        writePickedPolarFor(moduleId, pick.memory);
        onChange(pick.values);
      }}
    />
  );
}
