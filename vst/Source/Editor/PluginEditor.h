#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include "Plugin/PluginProcessor.h"

// ADR 003 Phase 2 keeps the editor as a placeholder; inboil-derived keyboard
// + right rail land in Phase 3.
class PointsmanEditor : public juce::AudioProcessorEditor
{
public:
    explicit PointsmanEditor(PointsmanProcessor&);
    ~PointsmanEditor() override = default;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    PointsmanProcessor& processor;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PointsmanEditor)
};
