#pragma once
#include <JuceHeader.h>
#include "../Plugin/PluginProcessor.h"

// ADR 003 Phase 0 stub — inboil-derived keyboard + right rail land in Phase 3.
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
