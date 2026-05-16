// Editor logic-layer tests for ADR 003 Phase 3 + Phase 5.
//
// Per ADR 003 §"UI logic / renderer split" and CLAUDE.md §"GUI / UI
// components": only the testable surface is exercised here — hit testing,
// mode-pill click → APVTS mode, harmony-add → processor.harmonyVoices,
// feel/drift slider → APVTS, mode description text.
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

    float loadFloat(juce::AudioProcessorValueTreeState& s, const char* p)
    {
        return s.getRawParameterValue(p)->load();
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

TEST_CASE("ControlsView: every visible child has non-zero size after resized()",
          "[editor][controls][layout]")
{
    // Catches the class of bug where a rail-content overflow squeezes a
    // row to zero height (the TRIG row regression that shipped when the
    // harmony group's reserved height was bumped without also growing
    // rightRailContentHeight). Walks every descendant component; any
    // `visible && (w == 0 || h == 0)` is a layout failure.
    auto countZeroSizedVisible = [](auto&& self, juce::Component& root) -> int
    {
        int count = 0;
        for (int i = 0; i < root.getNumChildComponents(); ++i)
        {
            auto* c = root.getChildComponent(i);
            if (c == nullptr) continue;
            if (c->isVisible() && (c->getWidth() <= 0 || c->getHeight() <= 0))
            {
                INFO("zero-sized component at bounds "
                     << c->getBoundsInParent().toString());
                ++count;
            }
            count += self(self, *c);
        }
        return count;
    };

    SECTION("no voices (user explicitly cleared the default triad)")
    {
        PointsmanProcessor proc;
        proc.setHarmonyVoices({});  // override the default 1-3-5 triad
        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 570);  // theme::railWidth × rightRailContentHeight
        REQUIRE(countZeroSizedVisible(countZeroSizedVisible, ctl) == 0);
    }

    SECTION("default voices (1-3-5 triad pre-populated)")
    {
        PointsmanProcessor proc;
        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 570);
        REQUIRE(countZeroSizedVisible(countZeroSizedVisible, ctl) == 0);
    }

    SECTION("max voices (add button is hidden, not zero-sized)")
    {
        PointsmanProcessor proc;
        proc.setHarmonyVoices({
            {3, pointsman::HarmonyDirection::Above},
            {4, pointsman::HarmonyDirection::Below},
            {5, pointsman::HarmonyDirection::Above},
        });
        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 570);  // theme::railWidth × rightRailContentHeight
        REQUIRE(countZeroSizedVisible(countZeroSizedVisible, ctl) == 0);
    }
}

TEST_CASE("ControlsView: SCALE/ROOT combos reflect APVTS at construction",
          "[editor][controls][init]")
{
    // ComboBoxAttachment's initial setSelectedId silently no-ops if the
    // combo has no items yet. The Phase 3 implementation populated combos
    // in the constructor body AFTER the attachments were built in the
    // member init list, so the combos rendered blank at first paint even
    // though the parameter had a valid default. Pin construction order
    // here so the regression doesn't reappear.
    //
    // Combo IDs are (parameter index + 1): juce::ComboBox treats id 0 as
    // "nothing selected", so addItem() uses 1-based ids.

    SECTION("default APVTS values populate the combos")
    {
        PointsmanProcessor proc;
        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 600);

        REQUIRE(ctl.getScaleComboForTest().getSelectedId()   == 1);
        REQUIRE(ctl.getRootComboForTest().getSelectedId()    == 1);
    }

    SECTION("non-default APVTS values populate the combos")
    {
        PointsmanProcessor proc;
        // 3rd scale, F root — chosen to avoid the index-0 case where a
        // blank combo would coincidentally match.
        auto* sp = proc.apvts.getParameter(pid::scale);
        sp->setValueNotifyingHost(sp->convertTo0to1(3.0f));
        auto* rp = proc.apvts.getParameter(pid::root);
        rp->setValueNotifyingHost(rp->convertTo0to1(5.0f));

        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 600);

        REQUIRE(ctl.getScaleComboForTest().getSelectedId() == 4);
        REQUIRE(ctl.getRootComboForTest().getSelectedId()  == 6);
    }
}

TEST_CASE("ControlsView: IN CH combo round-trips with inputChannel APVTS",
          "[editor][controls][routing]")
{
    // Phase 5: routing collapses to IN CH only — CTL CH / TRIG / SEED rows
    // are gone. The combo's selectedItemIndex maps bit-exactly to the
    // parameter's raw value via JUCE's ComboBoxParameterAttachment
    // (numItems-1 must equal parameter max-min for the mapping to be
    // exact). This test pins that mapping at the boundaries.

    SECTION("item index 0 = OMNI (0), index N = channel N")
    {
        PointsmanProcessor proc;
        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 600);

        // Default = 0 (OMNI) → first item selected.
        REQUIRE(ctl.getInChComboForTest().getSelectedItemIndex() == 0);
        REQUIRE(ctl.getInChComboForTest().getItemText(0) == "OMNI");

        // Push param to 7 → 8th item ("7").
        auto* p = proc.apvts.getParameter(pid::inputChannel);
        p->setValueNotifyingHost(p->convertTo0to1(7.0f));
        REQUIRE(ctl.getInChComboForTest().getSelectedItemIndex() == 7);
        REQUIRE(ctl.getInChComboForTest().getText() == "7");

        // Push to max (16) → last item.
        p->setValueNotifyingHost(p->convertTo0to1(16.0f));
        REQUIRE(ctl.getInChComboForTest().getSelectedItemIndex() == 16);
        REQUIRE(ctl.getInChComboForTest().getText() == "16");
    }

    SECTION("combo selection writes back to APVTS")
    {
        PointsmanProcessor proc;
        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 600);

        // Pick channel 5 in the IN CH combo (item index 5, id 6).
        ctl.getInChComboForTest().setSelectedItemIndex(5, juce::sendNotificationSync);
        REQUIRE(loadInt(proc.apvts, pid::inputChannel) == 5);
    }
}

TEST_CASE("ControlsView: clicking each mode pill cycles APVTS mode",
          "[editor][controls]")
{
    // Phase 5 (post-merge): only 2 modes — Scale (0) and Chord (1).
    // The old Harmony mode is gone; Chord absorbs its voice-stack logic
    // with a default 1-3-5 triad.
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    auto pills = ctl.getModeButtonsForTest();
    REQUIRE(pills.size() == 2);

    // Default mode = scale (idx 0).
    REQUIRE(loadInt(proc.apvts, pid::mode) == 0);

    clickSync(*pills[1]);
    REQUIRE(loadInt(proc.apvts, pid::mode) == 1); // chord

    clickSync(*pills[0]);
    REQUIRE(loadInt(proc.apvts, pid::mode) == 0); // back to scale
}

TEST_CASE("ControlsView: mode pill description text reflects the active mode",
          "[editor][controls][mode]")
{
    // Pin the text so the surface intent stays visible in the UI.
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    auto pills = ctl.getModeButtonsForTest();

    // Default = scale.
    REQUIRE(ctl.getModeDescLabelForTest().getText()
            == juce::String("snap to nearest scale degree"));

    clickSync(*pills[1]); // chord
    REQUIRE(ctl.getModeDescLabelForTest().getText()
            == juce::String("expand to a diatonic chord (1 in, N out)"));
}

TEST_CASE("ControlsView: FEEL slider writes through to apvts::feel",
          "[editor][controls][humanize]")
{
    // Phase 5: humanize collapses to 2 sliders (feel, drift). The
    // SliderAttachment plumbs slider → APVTS automatically; this test
    // pins the wiring so a future Parameters refactor cannot silently
    // disconnect it.
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    REQUIRE(loadFloat(proc.apvts, pid::feel) == 0.0f);
    ctl.getFeelSliderForTest().setValue(0.5, juce::sendNotificationSync);
    REQUIRE(loadFloat(proc.apvts, pid::feel) == 0.5f);
}

TEST_CASE("ControlsView: DRIFT slider writes through to apvts::drift",
          "[editor][controls][humanize]")
{
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    REQUIRE(loadFloat(proc.apvts, pid::drift) == 0.0f);
    ctl.getDriftSliderForTest().setValue(0.95, juce::sendNotificationSync);
    REQUIRE(loadFloat(proc.apvts, pid::drift) == 0.95f);
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
    // — the resulting list size and midi are deterministic.
    kbd.pollPulseForTest(0.0);
    REQUIRE(kbd.getPulsesForTest().size() == 1);
    // E4 = 64 specifically — not "any E in any octave". The pulse must
    // carry the actual emitted MIDI pitch so only the exact key glows on
    // the 3-octave keyboard. (Pre-fix bug: pc=4 lit C3-E, C4-E, C5-E all
    // at once.)
    REQUIRE(kbd.getPulsesForTest()[0].midi == 64);
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

TEST_CASE("ScaleKeyboardView: pulse outside the APVTS range slider is dropped",
          "[editor][keyboard][pulse]")
{
    // Visible range comes from pid::kbdRangeLoNote / kbdRangeHiNote
    // (defaults 36 / 71 = C3..B5). Notes emitted outside that band have
    // no key to glow, so the pulse must be dropped at poll time rather
    // than recorded and silently ignored by paint.
    PointsmanProcessor proc;
    proc.prepareToPlay(44100.0, 256);
    proc.setHostIsPlayingForTest(true);

    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    // MIDI 24 = C1, well below the default C3 (=36). Default scale is
    // major / root C so the quantizer passes the pitch through unchanged.
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 24, static_cast<juce::uint8>(100)), 0);
    juce::AudioBuffer<float> audio(0, 256);
    proc.processBlock(audio, midi);
    kbd.pollPulseForTest(0.0);
    REQUIRE(kbd.getPulsesForTest().empty());

    // MIDI 84 = C6, one octave above the default B5 (=71).
    juce::MidiBuffer midi2;
    midi2.addEvent(juce::MidiMessage::noteOn(1, 84, static_cast<juce::uint8>(100)), 0);
    proc.processBlock(audio, midi2);
    kbd.pollPulseForTest(0.0);
    REQUIRE(kbd.getPulsesForTest().empty());
}

TEST_CASE("ScaleKeyboardView: widening the APVTS range admits previously dropped pulses",
          "[editor][keyboard][pulse][range]")
{
    // Pin the dynamic-range branch of the pulse poll: a pitch that is
    // out-of-range at one slider setting must be admitted once the user
    // widens the slider to include it.
    PointsmanProcessor proc;
    proc.prepareToPlay(44100.0, 256);
    proc.setHostIsPlayingForTest(true);

    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    // Default range = C3..B5. MIDI 84 = C6 → out of range, dropped.
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 84, static_cast<juce::uint8>(100)), 0);
    juce::AudioBuffer<float> audio(0, 256);
    proc.processBlock(audio, midi);
    kbd.pollPulseForTest(0.0);
    REQUIRE(kbd.getPulsesForTest().empty());

    // Widen the range to C3..C7 (MIDI 36..96). The next emit at MIDI 84
    // must now be admitted into the pulse list.
    proc.apvts.getParameter(pid::kbdRangeHiNote)
        ->setValueNotifyingHost(proc.apvts.getParameter(pid::kbdRangeHiNote)
                                     ->convertTo0to1(96.0f));
    juce::MidiBuffer midi2;
    midi2.addEvent(juce::MidiMessage::noteOn(1, 84, static_cast<juce::uint8>(100)), 0);
    proc.processBlock(audio, midi2);
    kbd.pollPulseForTest(0.0);
    REQUIRE(kbd.getPulsesForTest().size() == 1);
    REQUIRE(kbd.getPulsesForTest()[0].midi == 84);
}

TEST_CASE("ControlsView: range slider round-trips with kbdRange APVTS params",
          "[editor][controls][range]")
{
    // The DISPLAY group's TwoValueHorizontal slider has no JUCE-stock
    // attachment; the custom RangeSlider drives both APVTS Int params
    // by hand. This test pins the two-way path: setting the slider
    // writes back to APVTS.
    PointsmanProcessor proc;
    pointsman::editor::ControlsView ctl(proc);
    ctl.setSize(280, 600);

    auto& slider = ctl.getRangeSliderForTest();
    REQUIRE(slider.getMinValue() == defaults::kbdRangeLoNote);
    REQUIRE(slider.getMaxValue() == defaults::kbdRangeHiNote);

    // Slider → APVTS (user drag). Setting min/max with sendNotification
    // fires onValueChange → writes APVTS.
    slider.setMinValue(48.0, juce::sendNotificationSync);
    slider.setMaxValue(96.0, juce::sendNotificationSync);
    REQUIRE(loadInt(proc.apvts, pid::kbdRangeLoNote) == 48);
    REQUIRE(loadInt(proc.apvts, pid::kbdRangeHiNote) == 96);

    // The range value label mirrors the new MIDI note names. Default
    // octave convention is MIDI 60 = C4 (Logic / Yamaha).
    REQUIRE(ctl.getRangeValueLabelForTest().getText() == juce::String("C3 - C7"));
}

TEST_CASE("ScaleKeyboardView: buildKeys honours the APVTS range",
          "[editor][keyboard][range]")
{
    PointsmanProcessor proc;
    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    const auto defaultKeys = [&]
    {
        // Centre of C3 (MIDI 36) must exist.
        const auto c3 = kbd.getKeyCenterForTest(0);
        REQUIRE(c3.x >= 0);
    };
    defaultKeys();

    // Narrow the range to C4..B4 (MIDI 48..59, one octave).
    proc.apvts.getParameter(pid::kbdRangeLoNote)
        ->setValueNotifyingHost(proc.apvts.getParameter(pid::kbdRangeLoNote)
                                     ->convertTo0to1(48.0f));
    proc.apvts.getParameter(pid::kbdRangeHiNote)
        ->setValueNotifyingHost(proc.apvts.getParameter(pid::kbdRangeHiNote)
                                     ->convertTo0to1(59.0f));
    const auto c4Centre = kbd.getKeyCenterForTest(0);
    REQUIRE(c4Centre.x >= 0);
    REQUIRE(kbd.getPcAtForTest(c4Centre) == 0);
}

TEST_CASE("ScaleKeyboardView: pulse glow lights only the exact emitted MIDI key",
          "[editor][keyboard][pulse]")
{
    // Counter-test for the same bug from the other direction: emit C4
    // and verify the glow reads non-zero on MIDI 60 but zero on MIDI 48
    // (C3) and MIDI 72 (C5). Each Pulse must carry midi (not pc) and
    // paint must compare KeyInfo.midi (not pc). The simplest check is to
    // inspect the pulse list directly: exactly one entry, midi=60.
    PointsmanProcessor proc;
    proc.prepareToPlay(44100.0, 256);
    proc.setHostIsPlayingForTest(true);

    pointsman::editor::ScaleKeyboardView kbd(proc);
    kbd.setSize(700, 120);

    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
    juce::AudioBuffer<float> audio(0, 256);
    proc.processBlock(audio, midi);
    kbd.pollPulseForTest(0.0);

    const auto& pulses = kbd.getPulsesForTest();
    REQUIRE(pulses.size() == 1);
    REQUIRE(pulses[0].midi == 60);   // not 48, not 72, not "pc=0"
}

TEST_CASE("ControlsView: HARMONY badge combo maps to (interval, direction)",
          "[editor][controls][harmony]")
{
    // The badge exposes a single 8-item combo ("3rd ↑" … "6th ↓").
    // Id mapping: (interval - 3) * 2 + (Above ? 1 : 2). Pin both
    // directions of the mapping so the encoding can't silently drift.

    SECTION("badge initial selection reflects each voice's (interval, direction)")
    {
        PointsmanProcessor proc;
        proc.setHarmonyVoices({
            {3, pointsman::HarmonyDirection::Above}, // id = (3-3)*2 + 1 = 1
            {4, pointsman::HarmonyDirection::Below}, // id = (4-3)*2 + 2 = 4
            {6, pointsman::HarmonyDirection::Above}, // id = (6-3)*2 + 1 = 7
        });

        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 600);

        REQUIRE(ctl.getHarmonyBadgeCountForTest() == 3);
        REQUIRE(ctl.getHarmonyBadgeSelectedIdForTest(0) == 1);
        REQUIRE(ctl.getHarmonyBadgeSelectedIdForTest(1) == 4);
        REQUIRE(ctl.getHarmonyBadgeSelectedIdForTest(2) == 7);
    }

    SECTION("changing the badge combo writes back to harmonyVoices")
    {
        PointsmanProcessor proc;
        proc.setHarmonyVoices({{3, pointsman::HarmonyDirection::Above}});

        pointsman::editor::ControlsView ctl(proc);
        ctl.setSize(280, 600);

        auto* combo = ctl.getHarmonyBadgeComboForTest(0);
        REQUIRE(combo != nullptr);

        // id 6 → (6-1)/2 + 3 = 5 (interval), Below (id even). 5th below.
        combo->setSelectedId(6, juce::sendNotificationSync);
        REQUIRE(proc.getHarmonyVoices().size() == 1);
        REQUIRE(proc.getHarmonyVoices()[0].interval == 5);
        REQUIRE(proc.getHarmonyVoices()[0].direction
                == pointsman::HarmonyDirection::Below);
    }
}

TEST_CASE("ControlsView: harmony + grows the voice list, capped at 3",
          "[editor][controls][harmony]")
{
    // Start with the user explicitly cleared the default-triad so the
    // baseline is empty, then exercise the cap from there.
    PointsmanProcessor proc;
    proc.setHarmonyVoices({});
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

// Guards the CMake → editor wiring of the build version. The header
// label renders `v` POINTSMAN_VERSION_STRING; the macro is fed by
// `project(Pointsman VERSION X.Y.Z)` in vst/CMakeLists.txt via
// target_compile_definitions on pointsman_plugin_core. Without this
// test the macro could silently regress to empty / undefined and the
// header would render `v` with no number — the very thing the label
// was added to prevent. We do not snapshot-test paint output (CLAUDE.md
// §"GUI / UI components"); a parseable X.Y.Z string is sufficient.
TEST_CASE("Editor: POINTSMAN_VERSION_STRING macro is defined and parses as X.Y.Z",
          "[editor][version]")
{
#ifndef POINTSMAN_VERSION_STRING
    FAIL("POINTSMAN_VERSION_STRING is not defined — check vst/CMakeLists.txt "
         "target_compile_definitions on pointsman_plugin_core / Pointsman");
#else
    const juce::String v { POINTSMAN_VERSION_STRING };
    REQUIRE_FALSE(v.isEmpty());
    juce::StringArray parts;
    parts.addTokens(v, ".", "");
    REQUIRE(parts.size() == 3);
    for (const auto& part : parts)
    {
        REQUIRE_FALSE(part.isEmpty());
        REQUIRE(part.containsOnly("0123456789"));
    }
#endif
}
