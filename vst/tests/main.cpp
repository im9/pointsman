// pointsman_tests entry point.
//
// JUCE init/shutdown wrap the Catch2 session so JUCE-dependent tests added
// in Phase 2 (Plugin) and Phase 3 (Editor) can co-exist in the same binary.
// Phase 1 only exercises pointsman_engine, which is JUCE-free, but keeping
// the wrapper from the start avoids reshuffling main when the plugin and
// editor tests land. ADR 003 §"Test infrastructure".

#include <catch2/catch_session.hpp>
#include <juce_gui_basics/juce_gui_basics.h>

int main(int argc, char* argv[])
{
    juce::initialiseJuce_GUI();
    const int result = Catch::Session().run(argc, argv);
    juce::shutdownJuce_GUI();
    return result;
}
