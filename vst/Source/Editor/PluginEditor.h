// Top-level Pointsman editor (ADR 003 §"Editor (inboil-derived)" / Phase 3).
// 2-column body matching inboil's QuantizerSheet: keyboard on the left,
// 280px right rail of controls. Header strip carries the product name.
//
// inboil's × dismiss button is intentionally absent — VST/AU/CLAP hosts
// own plugin-window lifecycle; an explicit × would be either a no-op or
// host-internal close (unsupported).

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include "Editor/ControlsView.h"
#include "Editor/ScaleKeyboardView.h"
#include "Plugin/PluginProcessor.h"

class PointsmanEditor : public juce::AudioProcessorEditor
{
public:
    explicit PointsmanEditor(PointsmanProcessor&);
    ~PointsmanEditor() override = default;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    PointsmanProcessor&                  processor_;
    pointsman::editor::ScaleKeyboardView keyboard_;
    pointsman::editor::ControlsView      controls_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PointsmanEditor)
};
