cmake_minimum_required(VERSION 3.15)
project(Stencil VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(JUCE)

juce_add_plugin(Stencil
    COMPANY_NAME "im9"
    BUNDLE_ID "com.im9.stencil"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT TRUE
    IS_MIDI_EFFECT TRUE
    PLUGIN_MANUFACTURER_CODE "Im9x"
    PLUGIN_CODE "Stnl"
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "Stencil"
)

target_sources(Stencil PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
    Source/PluginEditor.cpp
    Source/PluginEditor.h
)

target_link_libraries(Stencil PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_audio_plugin_client
)

target_compile_definitions(Stencil PRIVATE
    JUCE_IGNORE_VST3_MISMATCHED_PARAMETER_ID_WARNING=1
)

juce_generate_juce_header(Stencil)

# Tests
add_executable(stencil_tests
    tests/test_TuringMachine.cpp
)
target_include_directories(stencil_tests PRIVATE Source)
target_link_libraries(stencil_tests PRIVATE Catch2::Catch2WithMain)
target_compile_features(stencil_tests PRIVATE cxx_std_17)
