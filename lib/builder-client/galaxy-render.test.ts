import { describe, expect, it } from "vitest";
import {
  createGalaxyProjection,
  generateGalaxyField,
  GALAXY_DEFAULT_PALETTE,
  projectGalaxyField,
  readGalaxySettings
} from "./galaxy-field";
import {
  assignGalaxyColours,
  buildGalaxySprites,
  drawGalaxyFrame,
  GALAXY_PRESETS,
  GALAXY_SIZE_CLASSES,
  matchGalaxyPreset,
  parseHexColour,
  readGalaxyLook,
  type GalaxyDrawContext,
  type GalaxySpriteCanvas
} from "./galaxy-render";

/** A canvas with a context that records nothing but accepts every call. */
function fakeCanvas(width: number, height: number): GalaxySpriteCanvas {
  const gradient = { addColorStop: () => undefined };
  const ctx = { createRadialGradient: () => gradient, fillRect: () => undefined, fillStyle: "" };
  return { width, height, getContext: () => ctx };
}

/** A 2D context that records how a frame was drawn. */
function recorder() {
  const calls = { drawImage: 0, fillRect: 0, composites: [] as string[], alphas: [] as number[] };
  const ctx = {
    fillStyle: "" as unknown,
    _alpha: 1,
    _composite: "source-over",
    get globalAlpha() {
      return this._alpha;
    },
    set globalAlpha(value: number) {
      this._alpha = value;
    },
    get globalCompositeOperation() {
      return this._composite;
    },
    set globalCompositeOperation(value: string) {
      this._composite = value;
      calls.composites.push(value);
    },
    fillRect: () => {
      calls.fillRect += 1;
    },
    drawImage: () => {
      calls.drawImage += 1;
      calls.alphas.push(ctx._alpha);
    },
    createRadialGradient: () => ({ addColorStop: () => undefined })
  };
  return { ctx: ctx as unknown as GalaxyDrawContext, calls };
}

function frameFor(count: number, width = 800, height = 600) {
  const settings = readGalaxySettings({ particleCount: String(count) });
  const field = generateGalaxyField(settings);
  const projection = projectGalaxyField(field, 0, 0, width, height, createGalaxyProjection(field.count));
  const look = readGalaxyLook({});
  const colourOf = assignGalaxyColours(field.count, look.weights, settings.seed, settings.flareStars);
  return { field, projection, colourOf, width, height, look, sprites: buildGalaxySprites(look, 1, fakeCanvas) };
}

describe("readGalaxyLook", () => {
  it("an empty colour slot is the reference colour for that slot, not black", () => {
    const look = readGalaxyLook({ c2: "", c4: "not a colour" });

    expect(look.colours[1]).toEqual(parseHexColour(GALAXY_DEFAULT_PALETTE[1].hex));
    expect(look.colours[3]).toEqual(parseHexColour(GALAXY_DEFAULT_PALETTE[3].hex));
  });

  it("reads a set colour and clamps the percentages into 0..1", () => {
    const look = readGalaxyLook({ c1: "#ff0000", glow: "250", opacity: "-4", hazeStrength: "55" });

    expect(look.colours[0]).toEqual([255, 0, 0]);
    expect(look.glow).toBe(1);
    expect(look.opacity).toBe(0);
    expect(look.hazeStrength).toBeCloseTo(0.55);
  });
});

describe("assignGalaxyColours", () => {
  it("follows the panel's weights — a slot weighted 0 gets no stars at all", () => {
    const colourOf = assignGalaxyColours(4000, [0, 0, 100, 0, 0], 27);

    expect(new Set(colourOf)).toEqual(new Set([2]));
  });

  it("splits roughly in proportion to the weights", () => {
    const colourOf = assignGalaxyColours(10000, [50, 50, 0, 0, 0], 27);
    const firstShare = colourOf.filter((slot) => slot === 0).length / colourOf.length;

    expect(firstShare).toBeGreaterThan(0.45);
    expect(firstShare).toBeLessThan(0.55);
  });

  it("keeps flare stars on the near-white slot whatever the weights say", () => {
    const colourOf = assignGalaxyColours(100, [0, 0, 0, 0, 100], 27, 7);

    expect(Array.from(colourOf.slice(0, 7))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(colourOf[7]).toBe(4);
  });

  it("is the same on every load for the same seed, and reads all-zero weights as the reference mix", () => {
    expect(assignGalaxyColours(500, [1, 2, 3, 4, 5], 9)).toEqual(assignGalaxyColours(500, [1, 2, 3, 4, 5], 9));
    expect(new Set(assignGalaxyColours(2000, [0, 0, 0, 0, 0], 9)).size).toBe(5);
  });
});

describe("presets", () => {
  it("each preset is recognised once its values are written, and moving a slider reads as Custom", () => {
    for (const name of Object.keys(GALAXY_PRESETS)) {
      const settings = { ...GALAXY_PRESETS[name] };
      expect(matchGalaxyPreset(settings)).toBe(name);
      expect(matchGalaxyPreset({ ...settings, turns: "3.9" })).toBe("custom");
    }
  });

  it("matches the palette entry's defaults as Astra, so a new module opens on a named preset", () => {
    expect(matchGalaxyPreset({ ...GALAXY_PRESETS.astra, particleCount: "4000.0", c1: "#f5f6fb" })).toBe("astra");
  });
});

describe("buildGalaxySprites", () => {
  it("builds one sprite per colour × size class, never one per star", () => {
    let built = 0;
    const sprites = buildGalaxySprites(readGalaxyLook({}), 2, (w, h) => {
      built += 1;
      return fakeCanvas(w, h);
    });

    expect(built).toBe(5 * GALAXY_SIZE_CLASSES.length);
    expect(sprites.canvases.every((row) => row.every(Boolean))).toBe(true);
  });

  it("paints the sprites at the device pixel ratio, so a Retina star is not upscaled", () => {
    const sizes: number[] = [];
    buildGalaxySprites(readGalaxyLook({ glow: "0" }), 2, (w, h) => {
      sizes.push(w);
      return fakeCanvas(w, h);
    });
    const at1: number[] = [];
    buildGalaxySprites(readGalaxyLook({ glow: "0" }), 1, (w, h) => {
      at1.push(w);
      return fakeCanvas(w, h);
    });

    expect(sizes[sizes.length - 1]).toBeGreaterThan(at1[at1.length - 1] * 1.9);
  });
});

describe("drawGalaxyFrame", () => {
  it("draws every on-screen star as a sprite with additive blending", () => {
    const frame = frameFor(1200);
    const { ctx, calls } = recorder();
    const drawn = drawGalaxyFrame(ctx, frame, frame.look, frame.sprites);

    expect(drawn).toBe(1200);
    expect(calls.drawImage).toBe(1200);
    expect(calls.composites).toContain("lighter");
    // Left back in the ordinary mode, so anything drawn after it is not lightened.
    expect(calls.composites[calls.composites.length - 1]).toBe("source-over");
  });

  it("skips stars that are entirely off the canvas", () => {
    const frame = frameFor(1200);
    const { ctx } = recorder();
    // Pushed a whole canvas width to the right, nothing remains on it.
    const drawn = drawGalaxyFrame(ctx, { ...frame, offsetX: 5000 }, frame.look, frame.sprites);

    expect(drawn).toBe(0);
  });

  it("draws no star at all at opacity 0, and dims every star at opacity 50", () => {
    const frame = frameFor(600);
    const off = recorder();
    expect(drawGalaxyFrame(off.ctx, frame, readGalaxyLook({ opacity: "0" }), frame.sprites)).toBe(0);
    expect(off.calls.drawImage).toBe(0);

    const half = recorder();
    drawGalaxyFrame(half.ctx, frame, readGalaxyLook({ opacity: "50" }), frame.sprites);
    expect(Math.max(...half.calls.alphas)).toBeLessThanOrEqual(0.5);
  });

  it("loops to the projection's count, not the buffer's length", () => {
    const frame = frameFor(800);
    const { ctx } = recorder();
    const drawn = drawGalaxyFrame(ctx, { ...frame, projection: { ...frame.projection, count: 300 } }, frame.look, frame.sprites);

    expect(drawn).toBe(300);
  });
});

// A context whose gradient methods EXIST and do not work is the shape jsdom
// has, and the shape any degraded 2D context has. Before the guard in
// galaxyRadialGradient, both call sites read `.addColorStop` off the
// `undefined` these return and threw — which, inside the runtime's effect,
// unmounts the React tree the module sits in and leaves a visitor on a
// published tenant page looking at a blank screen.
describe("a 2D context that cannot actually make a gradient", () => {
  /** `createRadialGradient` is a function and returns nothing, like jsdom's. */
  function gradientlessCanvas(width: number, height: number): GalaxySpriteCanvas {
    const ctx = {
      createRadialGradient: () => undefined,
      fillRect: () => undefined,
      fillStyle: ""
    };
    return { width, height, getContext: () => ctx };
  }

  it("builds no sprites instead of throwing", () => {
    expect(() => buildGalaxySprites(readGalaxyLook({}), 2, gradientlessCanvas)).not.toThrow();
    const sprites = buildGalaxySprites(readGalaxyLook({}), 2, gradientlessCanvas);
    expect(sprites.canvases.flat().every((c) => c === null)).toBe(true);
    // The reach is still reported, so a caller can lay out without a sprite.
    expect(sprites.reach).toBeGreaterThan(0);
  });

  it("still draws a frame — it skips the haze and reports 0 stars drawn", () => {
    const frame = frameFor(600);
    const sprites = buildGalaxySprites(frame.look, 2, gradientlessCanvas);
    const calls: string[] = [];
    const ctx = {
      createRadialGradient: () => undefined,
      fillRect: () => calls.push("fillRect"),
      drawImage: () => calls.push("drawImage"),
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over"
    } as unknown as GalaxyDrawContext;

    let drawn = -1;
    expect(() => {
      drawn = drawGalaxyFrame(ctx, frame, frame.look, sprites);
    }).not.toThrow();
    // No sprite could be built, so no star is drawn — but the backdrop was.
    expect(drawn).toBe(0);
    expect(calls).toContain("fillRect");
    expect(calls).not.toContain("drawImage");
  });

  it("rejects a truthy value that is not a gradient", () => {
    // A stub can return an object rather than nothing. `!gradient` is false
    // for `{}`, so only the addColorStop check in galaxyRadialGradient
    // catches this one.
    const stubbed = (width: number, height: number): GalaxySpriteCanvas => ({
      width,
      height,
      getContext: () => ({
        createRadialGradient: () => ({}),
        fillRect: () => undefined,
        fillStyle: ""
      })
    });
    expect(() => buildGalaxySprites(readGalaxyLook({}), 2, stubbed)).not.toThrow();
    const sprites = buildGalaxySprites(readGalaxyLook({}), 2, stubbed);
    expect(sprites.canvases.flat().every((c) => c === null)).toBe(true);
  });

  it("throws nothing when createRadialGradient itself throws", () => {
    const throwing = (width: number, height: number): GalaxySpriteCanvas => ({
      width,
      height,
      getContext: () => ({
        createRadialGradient: () => {
          throw new Error("context lost");
        },
        fillRect: () => undefined,
        fillStyle: ""
      })
    });
    expect(() => buildGalaxySprites(readGalaxyLook({}), 2, throwing)).not.toThrow();
  });
});
