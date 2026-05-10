// Editor logic-layer tests for ADR 003 Phase 3.
//
// Per ADR 003 §"UI logic / renderer split" and CLAUDE.md §"GUI / UI
// components": only the testable surface is exercised here — hit testing,
// mode-pill click → APVTS mode, harmony-add → processor.harmonyVoices.
// Visual quality, font rendering, and host-paint cadence stay manual.
//
// Tests run inside the Catch2 session opened by tests/main.cpp, which
// already wraps initialiseJuce_GUI() / shutdownJuce_GUI() so JUCE
// singletons (MessageManager, MainMouseSource) are alive.

#include <catch2/catch_test_macros.hpp>

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include "Editor/ControlsView.h"
#include "Editor/ScaleKeyboardView.h"
#include "Plugin/Parameters.h"
#include "Plugin/PluginProcessor.h"

using namespace pointsman;

namespace
{
    // Synthesise a left-click mouseDown at `pt` in `target`'s local coords.
    // Goes through Component::mouseDown(MouseEvent) so the same handler
    // path the host invokes is tested. The MouseInputSource value is
    // pulled from juce::Desktop, which is initialised by the JUCE GUI
    // singletons (see tests/main.cpp).
    juce::MouseEvent makeFakeMouseDown(juce::Component& target,
                                       juce::Point<int> pt)
    {
        const auto src = juce::Desktop::getInstance().getMainMouseSource();
        const auto pos = pt.toFloat();
        return juce::MouseEvent(
            src, pos, juce::ModifierKeys(),
            juce::MouseInputSource::defaultPressure,
            juce::MouseInputSource::defaultOrientation,
            juce::MouseInputSource::defaultRotation,
            juce::MouseInputSource::defaultTiltX,
            juce::MouseInputSource::defaultTiltY,
            &target, &target,
            juce::Time::getCurrentTime(),
            pos, juce::Time::getCurrentTime(),
            1, false);
    }

    int loadInt(juce::AudioProcessorValueTreeState& s, const char* p)
    {
        return static_cast<int>(s.getRawParameterValue(p)->load());
    }

    // juce::Button::triggerClick() routes through Component::postCommandMessage
    // → MessageManager::callAsync → handleCommandMessage → onClick. On macOS
    // headless console apps (no NSApp running), JUCE's async queue is not
    // pumped by runDispatchLoopUntil, so the test runner cannot rely on
    // triggerClick() to flush. Invoke onClick directly: this is the exact
    // callback Button::sendClickMessage fires inside the host, so the test
    // exercises identical state-mutation code.
    void clickSync(juce::Button& btn)
    {
        if (! btn.isEnabled()) return;
        if (btn.onClick) btn.onClick();
    }
}

TEST_CASE("ScaleKeyboardView: tap on a key updates APVTS root to that pitch class",
          "[editor][keyboard]")
{
    PointsmanProcessor proc;
    proc.prepareToPlay(44100.0, 256);

    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    // pc = 5 (F) is a white key — pick its center coordinate from the
    // logic-layer inspector. Default root is 0; the test confirms a tap
    // shifts root to 5.
    const auto center = kbd.getKeyCenterForTest(5);
    REQUIRE(center.x > 0);
    REQUIRE(center.y > 0);

    auto e = makeFakeMouseDown(kbd, center);
    kbd.mouseDown(e);

    REQUIRE(loadInt(proc.apvts, pid::root) == 5);
}

TEST_CASE("ScaleKeyboardView: in-scale dot set matches active scale + root",
          "[editor][keyboard]")
{
    PointsmanProcessor proc;
    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    // Default state: scale=Major (idx 0), root=0 (C).
    // SCALE_INTERVALS[major] = {0,2,4,5,7,9,11}.
    REQUIRE(kbd.getInScalePcsForTest()
            == std::vector<int>{0, 2, 4, 5, 7, 9, 11});

    // Switch to Minor Pentatonic (idx 8). MinorPentatonic intervals are
    // {0,3,5,7,10}; root still 0 → same pcs.
    auto* sp = proc.apvts.getParameter(pid::scale);
    sp->setValueNotifyingHost(sp->convertTo0to1(8.0f));
    REQUIRE(kbd.getInScalePcsForTest()
            == std::vector<int>{0, 3, 5, 7, 10});

    // Shift root to D (pc 2). Major intervals {0,2,4,5,7,9,11} + 2 mod 12
    // → sorted {1,2,4,6,7,9,11}.
    sp->setValueNotifyingHost(sp->convertTo0to1(0.0f)); // back to Major
    auto* rp = proc.apvts.getParameter(pid::root);
    rp->setValueNotifyingHost(rp->convertTo0to1(2.0f));
    REQUIRE(kbd.getInScalePcsForTest()
            == std::vector<int>{1, 2, 4, 6, 7, 9, 11});
}

TEST_CASE("ControlsView: clicking each mode pill cycles APVTS mode",
          "[editor][controls]")
{
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    auto pills = ctl.getModeButtonsForTest();
    REQUIRE(pills.size() == 3);

    // Default mode = scale (idx 0).
    REQUIRE(loadInt(proc.apvts, pid::mode) == 0);

    clickSync(*pills[1]);
    REQUIRE(loadInt(proc.apvts, pid::mode) == 1); // chord

    clickSync(*pills[2]);
    REQUIRE(loadInt(proc.apvts, pid::mode) == 2); // harmony

    clickSync(*pills[0]);
    REQUIRE(loadInt(proc.apvts, pid::mode) == 0); // back to scale
}

TEST_CASE("ScaleKeyboardView: pulse list grows when processor emits a noteOn",
          "[editor][keyboard][pulse]")
{
    // ADR 003 §"Editor (inboil-derived)": pulse-on-emit is implemented as
    // a lock-free atomic from the audio thread (PluginProcessor) to a
    // timer-poll on the editor side. The test exercises the end-to-end
    // path by driving processBlock and then synchronously polling the
    // editor (the headless test runner can't drive juce::Timer reliably).
    PointsmanProcessor proc;
    proc.prepareToPlay(44100.0, 256);
    proc.setHostIsPlayingForTest(true);

    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    // Constructor initialises lastSeenPulseVersion_ to the current atomic
    // version so a stale pulse from a prior run does not phantom-fire.
    REQUIRE(kbd.getPulsesForTest().empty());

    // Emit MIDI 64 (E4) → in-scale for default major root=0 → passes
    // through pitch-unchanged. Velocity 100 → intensity = 100/127 ≈ 0.787.
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 64, static_cast<juce::uint8>(100)), 0);
    juce::AudioBuffer<float> audio(0, 256);
    proc.processBlock(audio, midi);

    // Tick with dt=0 so the new pulse is picked up but no decay applies
    // — the resulting list size and pc are deterministic.
    kbd.pollPulseForTest(0.0);
    REQUIRE(kbd.getPulsesForTest().size() == 1);
    REQUIRE(kbd.getPulsesForTest()[0].pc == 4);  // 64 % 12 = 4 (E)
    // Initial age = 0; intensity scaled from velocity.
    REQUIRE(kbd.getPulsesForTest()[0].ageMs == 0.0);
    REQUIRE(kbd.getPulsesForTest()[0].intensity > 0.78);
    REQUIRE(kbd.getPulsesForTest()[0].intensity < 0.79);

    // Half the decay window elapses → intensity halves linearly.
    // baseIntensity * (1 - 125/250) = 0.787 * 0.5 ≈ 0.394.
    kbd.pollPulseForTest(125.0);
    REQUIRE(kbd.getPulsesForTest().size() == 1);
    REQUIRE(kbd.getPulsesForTest()[0].ageMs == 125.0);
    REQUIRE(kbd.getPulsesForTest()[0].intensity > 0.39);
    REQUIRE(kbd.getPulsesForTest()[0].intensity < 0.40);

    // Past the decay window → pruned.
    kbd.pollPulseForTest(200.0);
    REQUIRE(kbd.getPulsesForTest().empty());
}

TEST_CASE("ControlsView: harmony + grows the voice list, capped at 3",
          "[editor][controls][harmony]")
{
    // Harmony voice list is mutated through PointsmanProcessor::
    // setHarmonyVoices(), which also syncs the PointsmanState child tree.
    // The test asserts both the runtime vector and that the cap (max 3,
    // per concept.md §"Parameter surface") is enforced by the editor.
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    REQUIRE(proc.getHarmonyVoices().empty());

    auto& addBtn = ctl.getAddHarmonyButtonForTest();
    clickSync(addBtn);
    REQUIRE(proc.getHarmonyVoices().size() == 1);

    clickSync(addBtn);
    REQUIRE(proc.getHarmonyVoices().size() == 2);

    clickSync(addBtn);
    REQUIRE(proc.getHarmonyVoices().size() == 3);

    // Fourth click is a no-op — concept.md caps harmonyVoices at 3.
    // In Live the + button is disabled by the async rebuild (fired from
    // valueTreeChildAdded → callAsync); in this headless runner the
    // async queue does not pump, so the button stays enabled and the
    // cap is enforced instead by the in-handler guard at the top of
    // ControlsView::onAddHarmonyClicked.
    clickSync(addBtn);
    REQUIRE(proc.getHarmonyVoices().size() == 3);
}
