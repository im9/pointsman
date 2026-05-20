// MIDI -> note name string for editor labels (currently used by the
// range value label under the scale keyboard; any future view that needs
// a sounding-pitch label should reuse this rather than re-derive).
//
// Yamaha / Ableton convention: MIDI 60 = "C3". Most DAWs (Ableton Live,
// Logic Pro, Bitwig, Reaper, Studio One, Cubase) label MIDI 60 as C3 in
// their piano-roll views. The earlier scientific-notation form
// (`n / 12 - 1`, C4 = 60) was a port bug that left the VST's editor
// labels one octave above what the host's own clip view shows — the
// same defect Stencil VST corrected on 2026-05-20 (commit 78cf2cd).
// Test vst/tests/test_NoteFormat.cpp pins this convention so a future
// drift back to scientific notation trips with explicit context.
//
// Pointsman m4l does not display note names + octaves, so there is no
// cross-target counterpart to keep in sync here (unlike Stencil, whose
// m4l side has midiToNoteName in rangeSlider.logic.ts).
//
// Inline + header-only: there is exactly one caller in Pointsman
// (ControlsView::syncRangeValueLabel), and the test binary needs access
// without adding a separate .cpp to the link line. If this grows to a
// second caller it can stay header-only — the function is trivial.

#pragma once

#include <algorithm>
#include <array>
#include <juce_core/juce_core.h>

namespace pointsman::editor {

// MIDI 0   -> "C-2"
// MIDI 60  -> "C3"   (middle C, Ableton / Logic piano-roll default)
// MIDI 127 -> "G8"
inline juce::String noteLabel(int midiNote)
{
    static constexpr std::array<const char*, 12> kNoteNames =
        {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
    const int n = std::clamp(midiNote, 0, 127);
    return juce::String(kNoteNames[(std::size_t) (n % 12)])
         + juce::String(n / 12 - 2);
}

}  // namespace pointsman::editor
