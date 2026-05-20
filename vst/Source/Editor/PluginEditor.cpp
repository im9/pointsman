#include "Editor/PluginEditor.h"

#include "Editor/Theme.h"

PointsmanEditor::PointsmanEditor(PointsmanProcessor& p)
    : AudioProcessorEditor(&p),
      processor_(p),
      keyboard_(p),
      controls_(p)
{
    addAndMakeVisible(keyboard_);
    addAndMakeVisible(controls_);

    // Resizable, but with a minimum at the layout's natural size. The
    // keyboard and right-rail are both content-sized — at the minimum
    // size they fit exactly; beyond it the keyboard centres in its
    // column and the rail stays anchored right, so extra space appears
    // as bg-coloured padding. That matches what hosts that auto-resize
    // (Logic) do anyway, and lets users with a busier rack drag the
    // window taller to see all groups at once.
    //
    // Total height is the right-rail's intrinsic stack of group cards
    // plus header + body padding. The keyboard (104 px content) is
    // shorter and centres vertically in its left column, mirroring
    // inboil's flex `justify-content: center`. Earlier code added an
    // unjustified +360 px below the keyboard, which left the keyboard
    // pinned to the top of a too-tall body.
    using namespace pointsman::editor::theme;
    // Keyboard column reserves the legacy 21-white-key (=588 px) budget.
    // The keyboard's own paint scales its key widths to fill whatever
    // local bounds it ends up with (set in resized() below), so a wider
    // user-resized window simply gives the keys more breathing room
    // without forcing a host-window resize on every range-slider change.
    const int totalW           = kbdContentWidth + railPad * 2 + railWidth;
    // Worst-case rail content (sum of group heights + chrome) at the
    // current theme tokens, computed by walking ControlsView::resized():
    //
    //   pad×2(24) +
    //   SCALE   legend+2 + 2×row + gap          + groupGap = 71
    //   MODE    legend+2 + row+gap + legendH    + groupGap = 62
    //   HARMONY legend+2 + kHarmonyVoicesMax×row + (max-1)×gap + groupGap = 97
    //   HUMANIZE legend+2 + 5×(row+gap) + (groupGap-gap)     = 149
    //   ROUTING legend+2 + 4×row + 3×gap        + groupGap  = 123
    //   DISPLAY legend+2 + row                              = 37
    //                                                        ─────
    //                                                          563
    //
    // A few px headroom keeps the layout legible if a token grows by 1-2 px.
    constexpr int rightRailContentHeight = 570;
    const int totalH           = headerHeight + rightRailContentHeight;
    setSize(totalW, totalH);

    // Min = natural size (anything smaller starts clipping group rows);
    // max = generous so users can drag taller / wider if they want
    // breathing room. Aspect-locking would be wrong here — width and
    // height are independent (rail is fixed-width, keyboard is fixed-
    // height).
    setResizable(true, true);
    setResizeLimits(totalW, totalH, totalW * 3, totalH * 3);
}

void PointsmanEditor::paint(juce::Graphics& g)
{
    using namespace pointsman::editor;
    g.fillAll(theme::bg);

    g.setColour(theme::fg);
    g.setFont(theme::dataFont(theme::fsXl, true));
    g.drawText("Pointsman",
               theme::railPad, 0,
               getWidth() - theme::railPad * 2, theme::headerHeight,
               juce::Justification::centredLeft);

    // Build version, right-aligned in the same header row. Fed by
    // POINTSMAN_VERSION_STRING (vst/CMakeLists.txt → project(Pointsman
    // VERSION ...)); kept small + 0.4 alpha so it reads as metadata
    // next to the title rather than competing with it. Lets the user
    // verify at a glance which binary the DAW loaded — DAW-side plugin
    // info dialogs are slow to reach during iteration.
    g.setFont(theme::dataFont(theme::fsSm, false));
    g.setColour(theme::fgAlpha(0.4f));
    g.drawText("v" POINTSMAN_VERSION_STRING,
               theme::railPad, 0,
               getWidth() - theme::railPad * 2, theme::headerHeight,
               juce::Justification::centredRight);

    g.setColour(theme::lzBorder);
    g.drawLine(0.0f, (float) theme::headerHeight,
               (float) getWidth(), (float) theme::headerHeight, 1.0f);
}

void PointsmanEditor::resized()
{
    using namespace pointsman::editor::theme;
    auto bounds = getLocalBounds();
    bounds.removeFromTop(headerHeight);

    auto rail = bounds.removeFromRight(railWidth);
    controls_.setBounds(rail);

    // Keyboard fills the remaining left column horizontally (minus the
    // railPad gutters on each side, so the edge keys don't butt against
    // the window border) and is vertically centred at its intrinsic
    // 104 px height (kbdWhiteH + 4 for the 2 px top inset + 2 px lower
    // margin). buildKeys() reads the component's width and divides it
    // among the white keys in the current range slider's [lo, hi], so
    // the user's manual window resize and the range slider both flow
    // through one path.
    bounds.reduce(railPad, 0);
    const int kbdH = kbdWhiteH + 4;
    keyboard_.setBounds(bounds.withSizeKeepingCentre(bounds.getWidth(), kbdH));
}
