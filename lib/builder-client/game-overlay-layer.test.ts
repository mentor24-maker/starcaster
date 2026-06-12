import { describe, expect, it } from "vitest";
import {
  PLAYER_GAME_EVENT_BACKDROP_Z_INDEX,
  PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX,
  PLAYER_GAME_OVERLAY_CONTENT_Z_INDEX_MIN,
  PLAYER_GAME_OVERLAY_HOST_Z_INDEX,
  PLAYER_GAME_PAGE_MAIN_Z_INDEX,
  PLAYER_GAME_SPEECH_BUBBLE_LAYER_Z_INDEX,
  resolveGameOverlayContentZIndex
} from "./game-overlay-layer";

describe("game overlay layer", () => {
  it("uses a fixed page ladder instead of viewport-max host stacking", () => {
    expect(PLAYER_GAME_PAGE_MAIN_Z_INDEX).toBe(1);
    expect(PLAYER_GAME_EVENT_BACKDROP_Z_INDEX).toBe(5);
    expect(PLAYER_GAME_FLOATING_IMAGE_LAYER_Z_INDEX).toBe(40);
    expect(PLAYER_GAME_SPEECH_BUBBLE_LAYER_Z_INDEX).toBe(45);
    expect(PLAYER_GAME_OVERLAY_HOST_Z_INDEX).toBe(PLAYER_GAME_SPEECH_BUBBLE_LAYER_Z_INDEX);
    expect(PLAYER_GAME_OVERLAY_CONTENT_Z_INDEX_MIN).toBe(10);
  });

  it("never places overlay content below the in-host floor", () => {
    expect(resolveGameOverlayContentZIndex({ zIndex: "1" })).toBe(10);
    expect(resolveGameOverlayContentZIndex({ zIndex: "1000" })).toBe(1000);
  });
});
