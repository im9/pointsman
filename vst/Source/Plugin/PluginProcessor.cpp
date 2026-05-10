#include "PluginProcessor.h"
#include "../Editor/PluginEditor.h"

PointsmanProcessor::PointsmanProcessor()
    : AudioProcessor(BusesProperties()) {}

void PointsmanProcessor::prepareToPlay(double /*sampleRate*/, int /*samplesPerBlock*/) {}
void PointsmanProcessor::releaseResources() {}

void PointsmanProcessor::processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&)
{
    // ADR 003 Phase 0 stub — empty MIDI Effect (passes nothing through).
    // Phase 2 wires the engine: scale snap + chord-tone + diatonic harmony
    // + humanize, with controlChannel chord-context maintenance and
    // transport-stop / bypass panic.
}

juce::AudioProcessorEditor* PointsmanProcessor::createEditor()
{
    return new PointsmanEditor(*this);
}

void PointsmanProcessor::getStateInformation(juce::MemoryBlock& /*destData*/) {}
void PointsmanProcessor::setStateInformation(const void* /*data*/, int /*sizeInBytes*/) {}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PointsmanProcessor();
}
