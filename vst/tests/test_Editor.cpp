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
    // The editor disables the + button at the cap; clickSync skips
    // disabled buttons (matching JUCE's handleCommandMessage gate).
    clickSync(addBtn);
    REQUIRE(proc.getHarmonyVoices().size() == 3);
}
