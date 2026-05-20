// Editor palette + typography + layout tokens for ADR 003 Phase 3.
// Mirrors inboil's app.css :root tokens (cream / olive / dark) so the
// quantizer surface in Logic / Bitwig matches the original web product.
// Editor/* views must read colours and fonts from here — literal hex /
// px values in views are a review blocker.

#pragma once

#include <juce_graphics/juce_graphics.h>

namespace pointsman::editor::theme
{
    // ── Inboil palette (app.css :root) ──────────────────────────────
    inline const juce::Colour bg     = juce::Colour::fromRGB(0xED, 0xE8, 0xDC);
    inline const juce::Colour fg     = juce::Colour::fromRGB(0x1E, 0x20, 0x28);
    inline const juce::Colour olive  = juce::Colour::fromRGB(0x78, 0x78, 0x45);

    // Pulse-on-emit glow colour. Mirrors m4l/scaleKeyboard.jsui.js
    // COL_HIGHLIGHT = [0.95, 0.55, 0.40] (warm peach / coral) so the
    // emit animation reads identically across both targets.
    inline const juce::Colour pulseGlow = juce::Colour::fromRGB(0xF2, 0x8C, 0x66);

    // fg-on-bg overlays. Alpha values mirror inboil's --lz-* / --olive-bg
    // tuning; do not freely tweak — they were tuned in inboil and we
    // copy 1:1 so the quantizer reads identically.
    inline juce::Colour fgAlpha(float a)    { return fg.withAlpha(a); }
    inline juce::Colour oliveAlpha(float a) { return olive.withAlpha(a); }
    inline juce::Colour bgAlpha(float a)    { return bg.withAlpha(a); }

    inline const juce::Colour lzDivider     = fgAlpha(0.06f);
    inline const juce::Colour lzBgHover     = fgAlpha(0.06f);
    inline const juce::Colour lzBgActive    = fgAlpha(0.08f);
    inline const juce::Colour lzBorder      = fgAlpha(0.10f);
    inline const juce::Colour lzBorderMid   = fgAlpha(0.12f);
    inline const juce::Colour lzBorderStrong= fgAlpha(0.15f);
    inline const juce::Colour oliveBg       = oliveAlpha(0.15f);

    // Keyboard-specific overlays. Values are direct copies of inboil's
    // QuantizerSheet.svelte keyFill / keyStroke branches and must match
    // 1:1 — the keyboard is the most-recognisable inboil surface and any
    // alpha drift shows up as "looks similar but off."
    // White-key stroke matches im9-site's --color-mark-stroke
    // (rgba(20, 22, 26, 0.55)). Black keys get a softer stroke so the
    // 0.55-alpha rim does not look brighter than the dark key body
    // (the body's fgAlpha(0.85) fill renders ~rgb(61) on bg, and a
    // 0.55 stroke on top reads as a lighter ring around the key,
    // which made the black keys look washed-out in the initial port).
    inline const juce::Colour kbdKeyStroke      = fgAlpha(0.55f);
    inline const juce::Colour kbdBlackKeyStroke = fgAlpha(0.20f);
    inline const juce::Colour kbdWhiteOutScale  = bgAlpha(0.55f);
    inline const juce::Colour kbdWhiteInScale   = oliveAlpha(0.15f);
    inline const juce::Colour kbdBlackOutScale  = fgAlpha(0.85f);
    inline const juce::Colour kbdBlackInScale   = fgAlpha(0.70f);
    inline const juce::Colour kbdWhiteDot       = fgAlpha(0.35f);
    inline const juce::Colour kbdBlackDot       = bgAlpha(0.70f);

    // ── Type scale (inboil --fs-*) ─────────────────────────────────
    constexpr float fsSm = 9.0f;   // group legends
    constexpr float fsMd = 10.0f;  // control labels
    constexpr float fsLg = 11.0f;  // values, primary labels
    constexpr float fsXl = 14.0f;  // editor header title

    // JetBrains Mono if installed, monospace fallback otherwise.
    juce::Font dataFont(float pointSize, bool bold = false);

    // ── Layout tokens (right rail, header) ─────────────────────────
    constexpr int railWidth     = 280;
    constexpr int headerHeight  = 32;
    constexpr int rowHeight     = 22;
    constexpr int rowGap        = 4;
    constexpr int groupGap      = 8;
    constexpr int groupPadX     = 8;
    constexpr int groupPadY     = 6;
    constexpr int railPad       = 12;

    // ── Keyboard geometry (inboil QuantizerSheet WK_* / BK_*) ──────
    // Heights stay 1:1 with inboil/src/lib/components/QuantizerSheet.svelte.
    // Widths used to be fixed at 28 px (white) / 18 px (black) per the
    // inboil reference, but the editor now exposes a per-project keyboard
    // range slider (pid::kbdRangeLoNote / kbdRangeHiNote, default C3..B5).
    // So the keys fill their allocated horizontal column instead of an
    // intrinsic 588 px block — kbdWhiteW / kbdBlackW are derived at paint
    // time as `availableWidth / whiteKeyCount` (white) and the 18/28
    // ratio is preserved for blacks. kbdContentWidth below remains as the
    // editor's natural-size budget (= legacy 588 px); manual window
    // resize gives the user more breathing room when the range is wide.
    constexpr int kbdContentWidth = 21 * 28; // 21 white keys × 28 px
    constexpr int kbdWhiteH = 100;
    constexpr int kbdBlackH = 60;
    constexpr int kbdPadTop = 2;
    constexpr float kbdBlackToWhiteWidthRatio = 18.0f / 28.0f;
}
