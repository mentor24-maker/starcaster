import {
  buildNumberSelectOptions,
  buildNumericSelectWidthStyle,
  getNumericSelectDigitCount
} from "./builder-inline-number-select";
import {
  CAROUSEL_IMAGE_FRAME_LIMITS,
  CAROUSEL_SHADOW_ANGLE_STEP,
  carouselShadowOffsetSettings,
  carouselShadowPolar
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
 * what stops them growing two ideas of the same pair.
 */

type Settings = Record<string, string | undefined>;

type PolarControlProps = {
  settings: Settings;
  /** Both keys in ONE update — an angle edit that wrote X and then Y would
   *  briefly describe a shadow at neither position. */
  onChange: (values: { imageShadowX: string; imageShadowY: string }) => void;
};

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

/**
 * What an Angle pick writes: the new direction, at the distance the shadow
 * ALREADY has. Pure and exported because that pairing is the one thing here
 * a static render cannot reach and the one thing worth getting wrong — an
 * angle that took the distance from anywhere else would move the shadow in
 * and out while the operator was only trying to swing it round.
 */
export function shadowAnglePick(settings: Settings, angle: number) {
  return carouselShadowOffsetSettings(angle, carouselShadowPolar(settings).distance);
}

/** The mirror: a Distance pick keeps the direction the shadow already has. */
export function shadowDistancePick(settings: Settings, distance: number) {
  return carouselShadowOffsetSettings(carouselShadowPolar(settings).angle, distance);
}

/** Which way the shadow falls: 0 is right, 90 up, 180 left, 270 below. */
export function BuilderImageShadowAngleControl({ settings, onChange }: PolarControlProps) {
  const { angle } = carouselShadowPolar(settings);
  const limits = CAROUSEL_IMAGE_FRAME_LIMITS.shadowAngle;
  return (
    <PolarSelect
      ariaLabel="Shadow angle in degrees"
      max={limits.max}
      min={limits.min}
      step={CAROUSEL_SHADOW_ANGLE_STEP}
      value={angle}
      onPick={(next) => onChange(shadowAnglePick(settings, next))}
    />
  );
}

/** How far from the picture it falls — 0 to the square's diagonal, 57. */
export function BuilderImageShadowDistanceControl({ settings, onChange }: PolarControlProps) {
  const { distance } = carouselShadowPolar(settings);
  const limits = CAROUSEL_IMAGE_FRAME_LIMITS.shadowDistance;
  return (
    <PolarSelect
      ariaLabel="Shadow distance in pixels"
      max={limits.max}
      min={limits.min}
      step={1}
      value={distance}
      onPick={(next) => onChange(shadowDistancePick(settings, next))}
    />
  );
}
