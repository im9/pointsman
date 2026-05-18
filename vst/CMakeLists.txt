cmake_minimum_required(VERSION 3.15)
project(Pointsman VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Test dependencies (ADR 003 §"Test infrastructure") -----------------------
# Catch2 v3 + nlohmann/json v3 fetched at configure time. Mirrors the oedipa
# pattern; JSON_BuildTests is forced off so we don't compile its own suite.
include(FetchContent)

FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG v3.5.4
)

set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)

FetchContent_MakeAvailable(Catch2 nlohmann_json)

add_subdirectory(JUCE)
add_subdirectory(clap-juce-extensions EXCLUDE_FROM_ALL)

# --- Engine static library (ADR 003 §"Engine boundary") -----------------------
# Pure C++17. NO juce_* link or include — this is the cross-host portability
# boundary. Both the plugin and the test binary depend on it.
add_library(pointsman_engine STATIC
    Source/Engine/Rng.h
    Source/Engine/State.h
    Source/Engine/Quantizer.h
    Source/Engine/Quantizer.cpp
    Source/Engine/Humanize.h
    Source/Engine/Humanize.cpp
)
target_include_directories(pointsman_engine PUBLIC Source)
target_compile_features(pointsman_engine PUBLIC cxx_std_17)

# CMake-time guard: pointsman_engine must not link any juce_* library.
# Re-evaluated at the end of configuration via a deferred call.
function(_pointsman_assert_engine_pure)
    get_target_property(_engine_link_libs pointsman_engine LINK_LIBRARIES)
    if (_engine_link_libs)
        foreach(_lib IN LISTS _engine_link_libs)
            if (_lib MATCHES "^juce")
                message(FATAL_ERROR
                    "pointsman_engine must not link juce_* (got '${_lib}'); "
                    "see ADR 003 §\"Engine boundary\".")
            endif()
        endforeach()
    endif()
endfunction()
cmake_language(DEFER CALL _pointsman_assert_engine_pure)

# --- Plugin core static library (ADR 003 §"Plugin core boundary") -------------
# AudioProcessor + APVTS + state serialization + editor, separated from the
# JUCE plugin bundle so the test binary can link it without pulling in
# juce_audio_plugin_client (the AU / VST3 wrappers, plugin-only).
add_library(pointsman_plugin_core STATIC
    Source/Plugin/Parameters.cpp
    Source/Plugin/Parameters.h
    Source/Plugin/PluginProcessor.cpp
    Source/Plugin/PluginProcessor.h
    Source/Editor/Theme.cpp
    Source/Editor/Theme.h
    Source/Editor/ScaleKeyboardView.cpp
    Source/Editor/ScaleKeyboardView.h
    Source/Editor/ControlsView.cpp
    Source/Editor/ControlsView.h
    Source/Editor/PluginEditor.cpp
    Source/Editor/PluginEditor.h
)
target_include_directories(pointsman_plugin_core PUBLIC Source)
target_link_libraries(pointsman_plugin_core PUBLIC
    pointsman_engine
    juce::juce_audio_basics
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_basics
    juce::juce_gui_extra
)
target_compile_definitions(pointsman_plugin_core PUBLIC
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    JUCE_STANDALONE_APPLICATION=0
    # Exposed to PluginEditor so the header can render the build version
    # (mirrors the plist version reported to the host). Source of truth
    # is project(Pointsman VERSION ...) at the top of this file; the
    # release skill bumps it as Step 0 before tagging.
    POINTSMAN_VERSION_STRING="${PROJECT_VERSION}"
)

# --- Plugin -------------------------------------------------------------------
juce_add_plugin(Pointsman
    COMPANY_NAME "im9"
    BUNDLE_ID "fm.im9.pointsman"
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

# The plugin sources also compile into Pointsman directly so the linker
# can resolve createPluginFilter() (called by juce_audio_plugin_client) and
# the AudioProcessor symbol via the plugin target's own object files. The
# static lib pointsman_plugin_core is linked for shared deps + for the
# tests target's plugin-core access.
target_sources(Pointsman PRIVATE
    Source/Plugin/Parameters.cpp
    Source/Plugin/Parameters.h
    Source/Plugin/PluginProcessor.cpp
    Source/Plugin/PluginProcessor.h
    Source/Editor/Theme.cpp
    Source/Editor/Theme.h
    Source/Editor/ScaleKeyboardView.cpp
    Source/Editor/ScaleKeyboardView.h
    Source/Editor/ControlsView.cpp
    Source/Editor/ControlsView.h
    Source/Editor/PluginEditor.cpp
    Source/Editor/PluginEditor.h
)
target_include_directories(Pointsman PRIVATE Source)
target_link_libraries(Pointsman PRIVATE
    pointsman_engine
    juce::juce_audio_basics
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_audio_plugin_client
)

target_compile_definitions(Pointsman PRIVATE
    JUCE_IGNORE_VST3_MISMATCHED_PARAMETER_ID_WARNING=1
    POINTSMAN_VERSION_STRING="${PROJECT_VERSION}"
)

# CLAP wrapper (ADR 003 §"Plugin format"): clap-juce-extensions derives
# Pointsman_CLAP from the existing Pointsman target, producing
# Pointsman.clap alongside Pointsman.vst3 / Pointsman.component. CLAP is
# Bitwig's native format; the same pattern + SHA ships on oedipa.
clap_juce_extensions_plugin(TARGET Pointsman
    CLAP_ID "fm.im9.pointsman"
    CLAP_FEATURES note-effect utility
    CLAP_MANUAL_URL "https://github.com/im9/pointsman"
    CLAP_SUPPORT_URL "https://github.com/im9/pointsman/issues"
)

# --- Tests --------------------------------------------------------------------
# Custom main (tests/main.cpp) wraps the Catch2 session with explicit
# juce::initialiseJuce_GUI() / shutdownJuce_GUI() so the plugin / editor
# tests get the JUCE singletons (MessageManager, etc.) they need.
add_executable(pointsman_tests
    tests/main.cpp
    tests/test_Rng.cpp
    tests/test_Quantizer.cpp
    tests/test_Humanize.cpp
    tests/test_Plugin.cpp
    tests/test_Editor.cpp
)
target_link_libraries(pointsman_tests PRIVATE
    pointsman_plugin_core
    Catch2::Catch2
    nlohmann_json::nlohmann_json
)
target_compile_features(pointsman_tests PRIVATE cxx_std_17)
target_compile_definitions(pointsman_tests PRIVATE
    POINTSMAN_RNG_VECTORS_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../docs/ai/rng-test-vectors.json"
    POINTSMAN_QUANTIZER_VECTORS_PATH="${CMAKE_CURRENT_SOURCE_DIR}/../docs/ai/quantizer-test-vectors.json"
)
