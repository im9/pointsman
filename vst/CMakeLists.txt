cmake_minimum_required(VERSION 3.15)
project(Pointsman VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(JUCE)
add_subdirectory(clap-juce-extensions EXCLUDE_FROM_ALL)

juce_add_plugin(Pointsman
    COMPANY_NAME "im9"
    BUNDLE_ID "com.im9.pointsman"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT TRUE
    IS_MIDI_EFFECT TRUE
    PLUGIN_MANUFACTURER_CODE "Im9x"
    PLUGIN_CODE "Pntm"
    FORMATS VST3 AU
    PRODUCT_NAME "Pointsman"
    COPY_PLUGIN_AFTER_BUILD TRUE
)

target_sources(Pointsman PRIVATE
    Source/Plugin/PluginProcessor.cpp
    Source/Plugin/PluginProcessor.h
    Source/Editor/PluginEditor.cpp
    Source/Editor/PluginEditor.h
)

target_link_libraries(Pointsman PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_audio_plugin_client
)

target_compile_definitions(Pointsman PRIVATE
    JUCE_IGNORE_VST3_MISMATCHED_PARAMETER_ID_WARNING=1
)

juce_generate_juce_header(Pointsman)

# CLAP wrapper (ADR 003 §"Plugin format"): clap-juce-extensions derives
# Pointsman_CLAP from the existing Pointsman target, producing
# Pointsman.clap alongside Pointsman.vst3 / Pointsman.component. CLAP is
# Bitwig's native format; the same pattern + SHA ships on oedipa.
clap_juce_extensions_plugin(TARGET Pointsman
    CLAP_ID "com.im9.pointsman"
    CLAP_FEATURES note-effect utility
    CLAP_MANUAL_URL "https://github.com/im9/pointsman"
    CLAP_SUPPORT_URL "https://github.com/im9/pointsman/issues"
)

# Tests: rebuilt in ADR 003 Phase 1 with Catch2 v3 + nlohmann/json v3 via FetchContent.
# The pointsman_engine + pointsman_plugin_core static libs and the pointsman_tests
# executable land then. Phase 0 ships scaffold removal + rename only.
