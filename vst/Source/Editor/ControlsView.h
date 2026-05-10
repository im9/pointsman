// Right-rail controls (ADR 003 §"Editor (inboil-derived)" / Phase 3).
// Inboil QuantizerSheet right-rail port: Scale / Mode / Harmony /
// Humanize / Routing groups. Inboil-only Target / Track / Preset /
// Merge / Fill / manual chords[] editor are intentionally dropped per
// ADR 003 §"inboil sections dropped for the vst port".
//
// Logic-layer test inspectors expose the mode-pill set and the
// harmony-add button so click→APVTS / click→harmonyVoices wiring is
// covered by tests. Everything visual is manual.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <array>
#include <memory>
#include <vector>

#include "Engine/State.h"

class PointsmanProcessor;

namespace pointsman::editor
{
    // Forward-declared internal types — defined in ControlsView.cpp.
    class ModePill;
    class HarmonyBadge;

    class ControlsView
        : public juce::Component
        , private juce::AudioProcessorValueTreeState::Listener
        , private juce::ValueTree::Listener
    {
    public:
        explicit ControlsView(PointsmanProcessor&);
        ~ControlsView() override;

        void paint(juce::Graphics&) override;
        void resized() override;

        // ── Test inspectors ───────────────────────────────────────
        // Three pointers in (Scale, Chord, Harmony) order.
        std::vector<juce::Button*> getModeButtonsForTest();
        juce::Button& getAddHarmonyButtonForTest();

    private:
        // APVTS listener — repaint mode pill highlight when mode changes
        // from any source (host automation, undo).
        void parameterChanged(const juce::String&, float) override;

        // ValueTree listener on apvts.state — picks up harmonyVoices
        // changes from setStateInformation (host preset load).
        void valueTreeChildAdded(juce::ValueTree&, juce::ValueTree&) override;
        void valueTreeChildRemoved(juce::ValueTree&, juce::ValueTree&, int) override;
        void valueTreeRedirected(juce::ValueTree&) override;

        void onModePillClicked(int idx);
        void onAddHarmonyClicked();
        void onRemoveHarmonyClicked(int idx);
        void onHarmonyVoiceEdited(int idx, pointsman::HarmonyVoice v);
        void rebuildHarmonyBadges();
        void syncModeHighlights();
        void layoutHarmonyRow(juce::Rectangle<int> row);

        PointsmanProcessor& processor_;

        // Scale group
        juce::Label    scaleLegend_, scaleLabel_, rootLabel_;
        juce::ComboBox scaleCombo_, rootCombo_;
        juce::AudioProcessorValueTreeState::ComboBoxAttachment scaleAtt_, rootAtt_;

        // Mode group (3 pills + descriptive text below)
        juce::Label    modeLegend_, modeDesc_;
        std::array<std::unique_ptr<ModePill>, 3> pills_;

        // Harmony group (dynamic badges + add button)
        juce::Label    harmonyLegend_;
        juce::TextButton addHarmonyBtn_ {"+"};
        std::vector<std::unique_ptr<HarmonyBadge>> badges_;

        // Humanize group (5 sliders)
        juce::Label  humanizeLegend_;
        juce::Label  velLabel_, gateLabel_, timingLabel_, driftLabel_, outLabel_;
        juce::Slider velSlider_, gateSlider_, timingSlider_, driftSlider_, outSlider_;
        juce::AudioProcessorValueTreeState::SliderAttachment
            velAtt_, gateAtt_, timingAtt_, driftAtt_, outAtt_;

        // Routing group
        juce::Label    routingLegend_;
        juce::Label    inChLabel_, ctlChLabel_, trigLabel_, seedLabel_;
        juce::Slider   inChSlider_, ctlChSlider_, seedSlider_;
        juce::ComboBox triggerCombo_;
        juce::AudioProcessorValueTreeState::SliderAttachment   inChAtt_, ctlChAtt_, seedAtt_;
        juce::AudioProcessorValueTreeState::ComboBoxAttachment triggerAtt_;

        // Computed once in resized() — y of harmony group's dynamic row, so
        // rebuildHarmonyBadges() can re-layout without a full re-resized.
        juce::Rectangle<int> harmonyRowBounds_ {};

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ControlsView)
    };
}
