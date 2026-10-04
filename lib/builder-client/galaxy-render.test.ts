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
  buildGalaxyFlareSprite,
  drawGalaxyFrame,
  galaxyCoreGlowRadiusPx,
  galaxyFlareAlpha,
  galaxyFlarePixel,
  galaxyFlareReachPx,
  galaxyTwinkle,
  GALAXY_FLARE_REACH,
  GALAXY_PRESET_OPTIONS,
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

    // …plus the flare streak's two (one horizontal, one vertical).
    expect(built).toBe(5 * GALAXY_SIZE_CLASSES.length + 2);
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

    // The last STAR sprite — the two flare canvases are built after the stars.
    const lastStar = 5 * GALAXY_SIZE_CLASSES.length - 1;
    expect(sizes[lastStar]).toBeGreaterThan(at1[lastStar] * 1.9);
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

// ---------------------------------------------------------------------------
// Galaxy module 5/6 (task 86bc7f5hm): the look
// ---------------------------------------------------------------------------

/** A canvas whose context can make ImageData, so the flare sprite can be painted. */
function pixelCanvas(width: number, height: number): GalaxySpriteCanvas & { painted?: ImageData } {
  const canvas: GalaxySpriteCanvas & { painted?: ImageData } = { width, height, getContext: () => ctx };
  const ctx = {
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => undefined,
    fillStyle: "",
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: ImageData) => {
      canvas.painted = image;
    }
  };
  return canvas;
}

/** A recorder that notes which image each drawImage call drew, and how big. */
function imageRecorder() {
  const draws: { image: unknown; w: number; h: number; composite: string }[] = [];
  const gradients: { r1: number; stops: string[] }[] = [];
  const fills: number[][] = [];
  let composite = "source-over";
  const ctx = {
    fillStyle: "" as unknown,
    globalAlpha: 1,
    get globalCompositeOperation() {
      return composite;
    },
    set globalCompositeOperation(value: string) {
      composite = value;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      fills.push([x, y, w, h]);
    },
    drawImage: (image: unknown, _x: number, _y: number, w: number, h: number) => {
      draws.push({ image, w, h, composite });
    },
    createRadialGradient: (_x0: number, _y0: number, _r0: number, _x1: number, _y1: number, r1: number) => {
      const entry = { r1, stops: [] as string[] };
      gradients.push(entry);
      return { addColorStop: (_at: number, colour: string) => entry.stops.push(colour) };
    }
  };
  return { ctx: ctx as unknown as GalaxyDrawContext, draws, gradients, fills };
}

function lookFrame(bag: Record<string, string>, width = 1440, height = 900) {
  const settings = readGalaxySettings(bag);
  const field = generateGalaxyField(settings);
  const projection = projectGalaxyField(field, 0, 0, width, height, createGalaxyProjection(field.count));
  const look = readGalaxyLook(bag);
  const colourOf = assignGalaxyColours(field.count, look.weights, settings.seed, settings.flareStars);
  const sprites = buildGalaxySprites(look, 1, pixelCanvas);
  return { input: { field, projection, colourOf, width, height }, look, sprites, settings };
}

describe("colour weights are honoured exactly", () => {
  it("bins 10,000 stars and every colour's share is within 2% of its weight", () => {
    const weights = GALAXY_DEFAULT_PALETTE.map((entry) => entry.weight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    const colourOf = assignGalaxyColours(10000, weights, 27);
    const bins = [0, 0, 0, 0, 0];
    for (const slot of colourOf) bins[slot] += 1;

    weights.forEach((weight, slot) => {
      const share = bins[slot] / colourOf.length;
      expect(Math.abs(share - weight / total), `slot ${slot + 1}: ${share} against ${weight / total}`).toBeLessThanOrEqual(0.02);
    });
  });

  it("holds for the panel's weights too, not just the reference ones", () => {
    const weights = [10, 40, 0, 30, 20];
    const colourOf = assignGalaxyColours(10000, weights, 4);
    const bins = [0, 0, 0, 0, 0];
    for (const slot of colourOf) bins[slot] += 1;

    weights.forEach((weight, slot) => {
      expect(Math.abs(bins[slot] / 10000 - weight / 100), `slot ${slot + 1}`).toBeLessThanOrEqual(0.02);
    });
  });
});

describe("twinkle", () => {
  it("is base × (1 − twinkle × 0.5 × (1 + sin(phase)))", () => {
    expect(galaxyTwinkle(0.6, -Math.PI / 2)).toBeCloseTo(1);
    expect(galaxyTwinkle(0.6, Math.PI / 2)).toBeCloseTo(0.4);
    expect(galaxyTwinkle(0.6, 0)).toBeCloseTo(0.7);
  });

  it("Twinkle 0 is a still sky — every phase is full brightness", () => {
    for (const phase of [0, 1, 2, 3, 4, 5, 6]) expect(galaxyTwinkle(0, phase)).toBe(1);
  });

  it("the frame reads the look's twinkle — at Twinkle 0 no star is dimmed by its phase", () => {
    const still = lookFrame({ particleCount: "500", twinkle: "0", flareStars: "0" });
    const alphas: number[] = [];
    const ctx = {
      ...imageRecorder().ctx,
      fillRect: () => undefined,
      drawImage: function (this: { globalAlpha: number }) {
        alphas.push(this.globalAlpha);
      },
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      createRadialGradient: () => ({ addColorStop: () => undefined })
    } as unknown as GalaxyDrawContext;
    drawGalaxyFrame(ctx, still.input, still.look, still.sprites);
    const brightness = Array.from(still.input.field.brightness);
    // Every round sprite's alpha is its star's own brightness, untouched.
    const starAlphas = alphas.slice(-brightness.length);
    starAlphas.forEach((alpha, i) => expect(alpha).toBeCloseTo(Math.min(1, brightness[i]), 5));
  });
});

describe("flare streaks", () => {
  it("each flare star gets a horizontal and a vertical streak, drawn just before its round sprite", () => {
    const frame = lookFrame({ particleCount: "800", flareStars: "7" });
    const rec = imageRecorder();
    drawGalaxyFrame(rec.ctx, frame.input, frame.look, frame.sprites);
    const flare = frame.sprites.flare!;
    const horizontals = rec.draws.filter((d) => d.image === flare.horizontal);
    const verticals = rec.draws.filter((d) => d.image === flare.vertical);

    expect(horizontals).toHaveLength(7);
    expect(verticals).toHaveLength(7);
    // Under the star: the streak pair comes first, then the round sprite.
    expect(rec.draws[0].image).toBe(flare.horizontal);
    expect(rec.draws[1].image).toBe(flare.vertical);
    expect(rec.draws[2].image).not.toBe(flare.horizontal);
    // Blended as light, like the stars.
    expect(horizontals.every((d) => d.composite === "lighter")).toBe(true);
  });

  it("Flare Stars 0 draws no streak at all", () => {
    const frame = lookFrame({ particleCount: "800", flareStars: "0" });
    const rec = imageRecorder();
    drawGalaxyFrame(rec.ctx, frame.input, frame.look, frame.sprites);
    const flare = frame.sprites.flare!;

    expect(rec.draws.some((d) => d.image === flare.horizontal || d.image === flare.vertical)).toBe(false);
  });

  it("twelve flare stars draw twelve pairs", () => {
    const frame = lookFrame({ particleCount: "800", flareStars: "12" });
    const rec = imageRecorder();
    drawGalaxyFrame(rec.ctx, frame.input, frame.look, frame.sprites);

    expect(rec.draws.filter((d) => d.image === frame.sprites.flare!.horizontal)).toHaveLength(12);
  });

  it("reaches 0.085 field radii at Flare Size 41, scales with the setting, and stays a hairline", () => {
    const frame = lookFrame({ particleCount: "800" });
    const rec = imageRecorder();
    drawGalaxyFrame(rec.ctx, frame.input, frame.look, frame.sprites);
    const streak = rec.draws.find((d) => d.image === frame.sprites.flare!.horizontal)!;
    const scale = frame.input.projection.scale;

    expect(streak.w).toBeCloseTo(2 * GALAXY_FLARE_REACH * scale, 5);
    expect(streak.h).toBeLessThan(6);
    expect(galaxyFlareReachPx(0.82, scale)).toBeCloseTo(2 * galaxyFlareReachPx(0.41, scale), 5);
    expect(galaxyFlareReachPx(0, scale)).toBe(0);
  });

  it("Flare Intensity sets the streak's opacity, and 0 draws none", () => {
    expect(galaxyFlareAlpha(0.28)).toBeCloseTo(0.7);
    expect(galaxyFlareAlpha(0)).toBe(0);
    expect(galaxyFlareAlpha(1)).toBe(1);
    const frame = lookFrame({ particleCount: "800", flareIntensity: "0" });
    const rec = imageRecorder();
    drawGalaxyFrame(rec.ctx, frame.input, frame.look, frame.sprites);
    expect(rec.draws.some((d) => d.image === frame.sprites.flare!.horizontal)).toBe(false);
  });

  it("the sprite is a thin gaussian line, brightest at the star and fading to nothing at both ends", () => {
    const sprite = buildGalaxyFlareSprite([255, 255, 255], 1, pixelCanvas) as {
      horizontal: GalaxySpriteCanvas & { painted?: ImageData };
    };
    const image = sprite.horizontal.painted!;
    const alphaAt = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];
    const mid = Math.floor(image.height / 2);
    const centre = Math.floor(image.width / 2);

    expect(image.height).toBeLessThanOrEqual(5);
    expect(alphaAt(centre, mid)).toBeGreaterThan(240);
    expect(alphaAt(0, mid)).toBe(0);
    expect(alphaAt(image.width - 1, mid)).toBe(0);
    expect(alphaAt(centre, 0)).toBeLessThan(alphaAt(centre, mid) / 4);
    expect(galaxyFlarePixel(0, 0)).toBe(1);
  });

  it("a context with no ImageData gives no flare sprite — flare stars stay round stars", () => {
    const sprites = buildGalaxySprites(readGalaxyLook({}), 1, fakeCanvas);
    expect(sprites.flare).toBeNull();
    const frame = frameFor(400);
    expect(() => drawGalaxyFrame(recorder().ctx, frame, frame.look, sprites)).not.toThrow();
  });
});

describe("core glow", () => {
  it("is one radial gradient at the centre, sized by Core Size", () => {
    const small = lookFrame({ particleCount: "400", coreSize: "12", hazeStrength: "0" });
    const big = lookFrame({ particleCount: "400", coreSize: "40", hazeStrength: "0" });
    const a = imageRecorder();
    const b = imageRecorder();
    drawGalaxyFrame(a.ctx, small.input, small.look, small.sprites);
    drawGalaxyFrame(b.ctx, big.input, big.look, big.sprites);

    expect(a.gradients).toHaveLength(1);
    expect(a.gradients[0].r1).toBeCloseTo(galaxyCoreGlowRadiusPx(12, small.input.projection.scale));
    expect(b.gradients[0].r1).toBeGreaterThan(a.gradients[0].r1 * 3);
  });

  it("its brightness follows Core Stars, and Core Stars 0 draws none", () => {
    const strong = lookFrame({ particleCount: "400", coreStrength: "100", hazeStrength: "0" });
    const none = lookFrame({ particleCount: "400", coreStrength: "0", hazeStrength: "0" });
    const a = imageRecorder();
    const b = imageRecorder();
    drawGalaxyFrame(a.ctx, strong.input, strong.look, strong.sprites);
    drawGalaxyFrame(b.ctx, none.input, none.look, none.sprites);

    expect(a.gradients[0].stops[0]).toMatch(/,0\.850\)$/);
    expect(b.gradients).toHaveLength(0);
  });

  it("is drawn before any star, and fades in with the intro", () => {
    const frame = lookFrame({ particleCount: "400", hazeStrength: "0", coreStrength: "100" });
    const rec = imageRecorder();
    drawGalaxyFrame(rec.ctx, { ...frame.input, assembled: 0 }, frame.look, frame.sprites);
    // Nothing assembled, no core glow.
    expect(rec.gradients).toHaveLength(0);
    const half = imageRecorder();
    drawGalaxyFrame(half.ctx, { ...frame.input, assembled: 0.5 }, frame.look, frame.sprites);
    expect(half.gradients[0].stops[0]).toMatch(/,0\.425\)$/);
    // backdrop, then the core's own box — both before the first drawImage.
    expect(half.fills).toHaveLength(2);
  });
});

describe("the four presets (task 86bc7f5hm)", () => {
  it("follow the plan's brief for each", () => {
    expect(GALAXY_PRESETS.astra).toMatchObject({ arms: "2", particleCount: "4000", turns: "2.35" });
    expect(GALAXY_PRESETS.classic).toMatchObject({ arms: "3", particleCount: "5000", turns: "1.6", hazeStrength: "0" });
    expect(GALAXY_PRESETS.nebula).toMatchObject({
      arms: "2", particleCount: "3000", c1: "#B388FF", c2: "#7AB1FE", c3: "#F5F6FB", haze: "#1B1040"
    });
    expect(Number(GALAXY_PRESETS.nebula.armWidth)).toBeGreaterThan(Number(GALAXY_PRESETS.astra.armWidth));
    expect(Number(GALAXY_PRESETS.nebula.hazeStrength)).toBeGreaterThan(Number(GALAXY_PRESETS.astra.hazeStrength));
    expect(GALAXY_PRESETS.subtle).toMatchObject({ arms: "2", particleCount: "1500", glow: "40", opacity: "60" });
    expect(Number(GALAXY_PRESETS.subtle.spinSpeed)).toBeLessThan(Number(GALAXY_PRESETS.astra.spinSpeed));
  });

  it("Classic wears white and pale blue only", () => {
    const look = readGalaxyLook(GALAXY_PRESETS.classic);
    const used = new Set(assignGalaxyColours(5000, look.weights, 27));
    expect(used).toEqual(new Set([0, 1]));
  });

  it("every preset writes every key any other preset writes, so switching never leaves one behind", () => {
    const keys = (name: string) => Object.keys(GALAXY_PRESETS[name]).sort();
    for (const option of GALAXY_PRESET_OPTIONS) expect(keys(option.value)).toEqual(keys("astra"));
    expect(keys("astra")).toEqual(expect.arrayContaining(["flareSize", "flareIntensity"]));
  });

  it("a flare slider moved after a preset reads as Custom", () => {
    expect(matchGalaxyPreset({ ...GALAXY_PRESETS.nebula, flareSize: "60" })).toBe("custom");
  });
});
