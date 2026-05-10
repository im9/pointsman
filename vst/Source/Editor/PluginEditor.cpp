#include "PluginEditor.h"

PointsmanEditor::PointsmanEditor(PointsmanProcessor& p)
    : AudioProcessorEditor(&p), processor(p)
{
    setSize(600, 400);
}

void PointsmanEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colours::black);
    g.setColour(juce::Colours::white);
    g.setFont(16.0f);
    g.drawText("Pointsman", getLocalBounds(), juce::Justification::centred);
}

void PointsmanEditor::resized() {}
