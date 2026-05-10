// 3-octave keyboard view (ADR 003 §"Editor (inboil-derived)" / Phase 3).
// Direct port of inboil src/lib/components/QuantizerSheet.svelte
// keyboard rendering: white + black keys, in-scale dot, chord-tier
// olive highlight, tap-sets-root.
//
// UI logic / renderer split per CLAUDE.md §"GUI / UI components": tap
// hit testing and the in-scale pc set are unit-tested via the
// getXxxForTest() inspectors; pixel rendering is manual.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <vector>

#include "Engine/State.h"

class PointsmanProcessor;

namespace pointsman::editor
{
    class ScaleKeyboardView
        : public juce::Component
        , private juce::AudioProcessorValueTreeState::Listener
    {
    public:
        explicit ScaleKeyboardView(PointsmanProcessor&);
        ~ScaleKeyboardView() override;

        void paint(juce::Graphics&) override;
        void mouseDown(const juce::MouseEvent&) override;

        // ── Logic-layer test inspectors (ADR 003 §"UI logic / renderer split") ──
        // Pitch class hit at a given local coord, or -1 if outside any key.
        // Black keys take precedence on overlap (matches paint order).
        int getPcAtForTest(juce::Point<int> localPt) const;

        // Center coord of the first occurrence of `pc` in the keyboard.
        // Used by tests to drive a synthetic mouseDown without hard-coding
        // pixel offsets that drift with theme tokens.
        juce::Point<int> getKeyCenterForTest(int pc) const;

        // The set of in-scale pitch classes given the current (scale, root)
        // APVTS values. Sorted ascending. Mirrors inboil's `scalePcs`
        // derived store.
        std::vector<int> getInScalePcsForTest() const;

    private:
        struct KeyInfo
        {
            int pc;       // 0..11
            int midi;     // pc + oct * 12
            int x;        // local-coord left edge
            int w;
            int h;
            bool isBlack;
        };

        std::vector<KeyInfo> buildKeys() const;
        std::vector<int>     buildScalePcs() const;

        // APVTS listener — repaint on (scale, root, mode) change.
        void parameterChanged(const juce::String&, float) override;

        PointsmanProcessor& processor_;

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ScaleKeyboardView)
    };
}
