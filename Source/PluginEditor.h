#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class StencilEditor : public juce::AudioProcessorEditor
{
public:
    explicit StencilEditor(StencilProcessor&);
    ~StencilEditor() override = default;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    StencilProcessor& processor;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(StencilEditor)
};
