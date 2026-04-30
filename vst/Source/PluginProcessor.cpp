#include "PluginProcessor.h"
#include "PluginEditor.h"

StencilProcessor::StencilProcessor()
    : AudioProcessor(BusesProperties()) {}

void StencilProcessor::prepareToPlay(double /*sampleRate*/, int /*samplesPerBlock*/) {}
void StencilProcessor::releaseResources() {}

void StencilProcessor::processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer& /*midi*/)
{
    // TODO: Turing Machine + Quantizer MIDI processing
}

juce::AudioProcessorEditor* StencilProcessor::createEditor()
{
    return new StencilEditor(*this);
}

void StencilProcessor::getStateInformation(juce::MemoryBlock& /*destData*/) {}
void StencilProcessor::setStateInformation(const void* /*data*/, int /*sizeInBytes*/) {}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new StencilProcessor();
}
