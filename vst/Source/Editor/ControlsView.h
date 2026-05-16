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
    class RangeSlider;

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
        juce::ComboBox& getScaleComboForTest()   { return scaleCombo_; }
        juce::ComboBox& getRootComboForTest()    { return rootCombo_; }
        juce::ComboBox& getTriggerComboForTest() { return triggerCombo_; }
        juce::ComboBox& getInChComboForTest()    { return inChCombo_; }
        juce::ComboBox& getCtlChComboForTest()   { return ctlChCombo_; }
        int getHarmonyBadgeCountForTest() const;
        int getHarmonyBadgeSelectedIdForTest(int idx) const;
        juce::ComboBox* getHarmonyBadgeComboForTest(int idx);
        juce::Label&   getSeedValueForTest()     { return seedValue_; }
        juce::Button&  getSeedRandomBtnForTest() { return seedRandomBtn_; }
        juce::Slider&  getRangeSliderForTest();
        juce::Label&   getRangeValueLabelForTest() { return rangeValueLabel_; }

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
        void onSeedTextEdited();
        void onSeedRandomClicked();
        void syncSeedLabelFromApvts();
        void syncRangeValueLabel();
        void rebuildHarmonyBadges();
        void syncModeHighlights();
        void layoutHarmonyArea(juce::Rectangle<int> area);
        int  loadIntParam(const char* id) const;

        PointsmanProcessor& processor_;

        // Scale group
        juce::Label    scaleLegend_, rootLabel_;
        juce::ComboBox scaleCombo_, rootCombo_;
        // ComboBoxAttachment owns the initial setSelectedId, which silently
        // no-ops on an empty combo. Items must be added BEFORE the
        // attachment exists — defer construction via unique_ptr so the
        // ControlsView constructor body populates the combo first.
        std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment>
            scaleAtt_, rootAtt_;

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
        juce::ComboBox inChCombo_, ctlChCombo_, triggerCombo_;
        // Seed: 0..0xffffff. The earlier IncDecButtons slider was unusable
        // for a 24-bit range. Replaced with an editable numeric label +
        // randomize button. Seed is plumbed manually (no SliderAttachment)
        // because there is no JUCE attachment for Label and we want a
        // randomize gesture that's not just "+/-1 on the parameter."
        juce::Label      seedValue_;
        juce::TextButton seedRandomBtn_ {"RND"};
        // See scaleAtt_/rootAtt_ above — same items-before-attachment dance.
        std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment>
            inChAtt_, ctlChAtt_, triggerAtt_;

        // Display group — keyboard range slider. RangeSlider is a custom
        // TwoValueHorizontal that owns bidirectional sync to a PAIR of
        // APVTS Int params (kbdRangeLoNote / kbdRangeHiNote). JUCE has no
        // built-in two-value attachment; the wrapper lives in
        // ControlsView.cpp anonymous namespace.
        juce::Label  displayLegend_;
        juce::Label  rangeLabel_;
        juce::Label  rangeValueLabel_;
        std::unique_ptr<RangeSlider> rangeSlider_;

        // Computed once in resized() — full bounds reserved for the harmony
        // badge stack + add-button row, so rebuildHarmonyBadges() can
        // re-layout without a full re-resized.
        juce::Rectangle<int> harmonyAreaBounds_ {};

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ControlsView)
    };
}
