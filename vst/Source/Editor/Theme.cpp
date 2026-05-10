#include "Editor/Theme.h"

namespace pointsman::editor::theme
{
    juce::Font dataFont(float pointSize, bool bold)
    {
        juce::Font font(juce::FontOptions()
            .withName("JetBrains Mono")
            .withHeight(pointSize)
            .withStyle(bold ? "Bold" : "Regular"));

        // If JetBrains Mono is missing, JUCE silently falls back to its
        // proportional default — visually wrong for a data-grid. Force
        // Menlo as the macOS monospace fallback.
        if (font.getTypefaceName() != "JetBrains Mono")
        {
            font = juce::Font(juce::FontOptions()
                .withName("Menlo")
                .withHeight(pointSize)
                .withStyle(bold ? "Bold" : "Regular"));
        }
        return font;
    }
}
