import { describe, expect, it } from "vitest";
import {
  getCurrentPollModuleShellStyle,
  getCurrentPollPanelStyle,
  normalizeCurrentPollModuleWidth
} from "@/lib/current-poll-module";

describe("current poll module", () => {
  it("defaults module width to 100%", () => {
    expect(normalizeCurrentPollModuleWidth(undefined)).toBe("100");
    expect(normalizeCurrentPollModuleWidth("66")).toBe("100");
  });

  it("applies module width on the shell, not global poll content width", () => {
    const shell = getCurrentPollModuleShellStyle({ size: "75", alignment: "left" });
    expect(shell.width).toBe("75%");

    const panel = getCurrentPollPanelStyle(
      { size: "75" },
      {
        pods: {
          polls: {
            layout: {
              contentWidth: "67",
              gutterPx: "100",
              headerBackgroundColor: "#5acff9",
              headerFontColor: "#0c5f72",
              headerFontSize: "1.08",
              podBackgroundMode: "none",
              podBackgroundColor: "transparent",
              podBackgroundColor2: "#eaf4ff",
              podBackgroundImageUrl: "",
              podBackgroundStyleKey: "",
              podBorderRadius: 34,
              headerBorderRadius: 999,
              headerBorderSize: 0,
              headerBorderColor: "transparent",
              headerDropShadowEnabled: false,
              headerDropShadowX: 0,
              headerDropShadowY: 0,
              headerDropShadowBlur: 0,
              headerDropShadowColor: "transparent",
              backgroundImageFocus: "right"
            }
          },
          previous_results: { layout: { contentWidth: "100", gutterPx: "100", headerBackgroundColor: "#5acff9", headerFontColor: "#0c5f72", headerFontSize: "1.08", podBackgroundMode: "none", podBackgroundColor: "transparent", podBackgroundColor2: "#eaf4ff", podBackgroundImageUrl: "", podBackgroundStyleKey: "", podBorderRadius: 34, headerBorderRadius: 999, headerBorderSize: 0, headerBorderColor: "transparent", headerDropShadowEnabled: false, headerDropShadowX: 0, headerDropShadowY: 0, headerDropShadowBlur: 0, headerDropShadowColor: "transparent", backgroundImageFocus: "center" } },
          initial_page: { layout: { contentWidth: "100", gutterPx: "100", headerBackgroundColor: "#5acff9", headerFontColor: "#0c5f72", headerFontSize: "1.08", podBackgroundMode: "none", podBackgroundColor: "transparent", podBackgroundColor2: "#eaf4ff", podBackgroundImageUrl: "", podBackgroundStyleKey: "", podBorderRadius: 34, headerBorderRadius: 999, headerBorderSize: 0, headerBorderColor: "transparent", headerDropShadowEnabled: false, headerDropShadowX: 0, headerDropShadowY: 0, headerDropShadowBlur: 0, headerDropShadowColor: "transparent", backgroundImageFocus: "center" }, content: { headerLabel: "How It Works", contentHtml: "<p>Test</p>" } },
          interstitial: { layout: { contentWidth: "100", gutterPx: "100", headerBackgroundColor: "#5acff9", headerFontColor: "#0c5f72", headerFontSize: "1.08", podBackgroundMode: "none", podBackgroundColor: "transparent", podBackgroundColor2: "#eaf4ff", podBackgroundImageUrl: "", podBackgroundStyleKey: "", podBorderRadius: 34, headerBorderRadius: 999, headerBorderSize: 0, headerBorderColor: "transparent", headerDropShadowEnabled: false, headerDropShadowX: 0, headerDropShadowY: 0, headerDropShadowBlur: 0, headerDropShadowColor: "transparent", backgroundImageFocus: "center" }, content: { headerLabel: "Announcement", contentHtml: "<p>Test</p>" } }
        }
      }
    );

    expect(panel["--poll-content-width"]).toBe("100%");
  });
});
