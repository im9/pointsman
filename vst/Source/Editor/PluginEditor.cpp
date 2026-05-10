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

    // Fixed size for v1 — the keyboard is 3 octaves and the right rail is
    // a fixed 280px (theme::railWidth). A resizer would just stretch
    // empty space and the inboil reference UI is not designed to scale.
    // Re-evaluate when MPE / preset slot UI is added (concept.md "Future
    // extensions").
    using namespace pointsman::editor::theme;
    const int kbdWidth   = (kbdOctHi - kbdOctLo + 1) * 7 * kbdWhiteW + railPad * 2;
    const int totalW     = kbdWidth + railWidth;
    const int totalH     = headerHeight + kbdWhiteH + kbdPadTop + railPad * 2 + 360;
    setSize(totalW, totalH);
}

void PointsmanEditor::paint(juce::Graphics& g)
{
    using namespace pointsman::editor;
    g.fillAll(theme::bg);

    g.setColour(theme::fg);
    g.setFont(theme::dataFont(theme::fsLg, true));
    g.drawText("POINTSMAN",
               theme::railPad, 0,
               getWidth() - theme::railPad * 2, theme::headerHeight,
               juce::Justification::centredLeft);

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
    keyboard_.setBounds(bounds);
}
