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

    // ── Type scale (inboil --fs-*) ─────────────────────────────────
    constexpr float fsSm = 9.0f;   // group legends
    constexpr float fsMd = 10.0f;  // control labels
    constexpr float fsLg = 11.0f;  // values, primary labels

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
    // Sized smaller than inboil to fit a 3-octave keyboard inside the
    // host plugin window without a viewport scroll. Black-key offsets
    // are inboil's BLACK_KEY_OFFSETS multiplied by WK_W at draw time.
    constexpr int kbdOctLo = 3;
    constexpr int kbdOctHi = 5;
    constexpr int kbdWhiteW = 26;
    constexpr int kbdWhiteH = 86;
    constexpr int kbdBlackW = 16;
    constexpr int kbdBlackH = 52;
    constexpr int kbdPadTop = 6;
}
