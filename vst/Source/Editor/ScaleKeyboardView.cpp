#include "Editor/ScaleKeyboardView.h"

#include "Editor/Theme.h"
#include "Engine/Quantizer.h"
#include "Plugin/Parameters.h"
#include "Plugin/PluginProcessor.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <set>

using namespace pointsman;

namespace
{
    // ~60 fps. Same cadence as m4l/scaleKeyboard.jsui.js (animTask.interval=16).
    constexpr int kPulseTimerHz = 60;

    double monotonicMs() noexcept
    {
        using namespace std::chrono;
        return duration<double, std::milli>(
                   steady_clock::now().time_since_epoch()).count();
    }
}

namespace pointsman::editor
{
    namespace
    {
        constexpr std::array<int, 7> kWhitePcs = {0, 2, 4, 5, 7, 9, 11};
        constexpr std::array<int, 5> kBlackPcs = {1, 3, 6, 8, 10};
    }

    ScaleKeyboardView::ScaleKeyboardView(PointsmanProcessor& p)
        : processor_(p)
    {
        processor_.apvts.addParameterListener(pid::scale,          this);
        processor_.apvts.addParameterListener(pid::root,           this);
        processor_.apvts.addParameterListener(pid::mode,           this);
        processor_.apvts.addParameterListener(pid::kbdRangeLoNote, this);
        processor_.apvts.addParameterListener(pid::kbdRangeHiNote, this);

        // Initialise pulse-version baseline so a stale value left from
        // a prior editor instance does not trigger a phantom pulse.
        lastSeenPulseVersion_ = processor_.getPulseHeadForTest();
        lastTickMs_ = monotonicMs();
        startTimerHz(kPulseTimerHz);
    }

    ScaleKeyboardView::~ScaleKeyboardView()
    {
        stopTimer();
        processor_.apvts.removeParameterListener(pid::scale,          this);
        processor_.apvts.removeParameterListener(pid::root,           this);
        processor_.apvts.removeParameterListener(pid::mode,           this);
        processor_.apvts.removeParameterListener(pid::kbdRangeLoNote, this);
        processor_.apvts.removeParameterListener(pid::kbdRangeHiNote, this);
    }

    // Maps a black key's pitch class to its visual offset within the
    // preceding white key, expressed in white-key-widths. Same numerals
    // as inboil's BLACK_KEY_OFFSETS but re-expressed relative to the
    // preceding white key (not the octave's leftmost C) so the dynamic
    // range layout below can position a black key from any starting
    // octave without recomputing octave-relative offsets.
    namespace
    {
        float blackKeyOffsetFromPrecedingWhite(int pc) noexcept
        {
            switch (pc)
            {
                case 1:  return 0.6f;    // C# past C  (inboil 0.6 absolute)
                case 3:  return 0.7f;    // D# past D  (inboil 1.7 - 1.0)
                case 6:  return 0.65f;   // F# past F  (inboil 3.65 - 3.0)
                case 8:  return 0.7f;    // G# past G  (inboil 4.7 - 4.0)
                case 10: return 0.75f;   // A# past A  (inboil 5.75 - 5.0)
                default: return 0.0f;
            }
        }
    }

    std::vector<ScaleKeyboardView::KeyInfo> ScaleKeyboardView::buildKeys() const
    {
        std::vector<KeyInfo> keys;

        const int loMidi = static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::kbdRangeLoNote)->load());
        const int hiMidi = static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::kbdRangeHiNote)->load());
        if (hiMidi < loMidi) return keys;

        // Count white keys in the displayed range. The keyboard column's
        // local width divides equally among them, so a narrow slider
        // yields chunky keys and a wide one yields slim keys — the
        // tradeoff for not auto-resizing the host window when the range
        // changes (per user direction).
        int whiteCount = 0;
        for (int m = loMidi; m <= hiMidi; ++m)
        {
            const int pc = ((m % 12) + 12) % 12;
            if (std::find(kWhitePcs.begin(), kWhitePcs.end(), pc) != kWhitePcs.end())
                ++whiteCount;
        }
        if (whiteCount == 0) return keys;

        const int availW = getWidth();
        if (availW <= 0) return keys;

        const float wkW = static_cast<float>(availW) / static_cast<float>(whiteCount);
        const int   wkH = theme::kbdWhiteH;
        const int   bkW = (int) std::lround(wkW * theme::kbdBlackToWhiteWidthRatio);
        const int   bkH = theme::kbdBlackH;

        int   whiteIdx     = 0;
        int   lastWhiteX   = 0;
        bool  haveWhite    = false;

        for (int m = loMidi; m <= hiMidi; ++m)
        {
            const int pc = ((m % 12) + 12) % 12;
            const bool isWhite = std::find(kWhitePcs.begin(), kWhitePcs.end(), pc) != kWhitePcs.end();
            if (isWhite)
            {
                // Tile each white key exactly to the next slot boundary
                // so neighbouring keys share an edge. A naive width =
                // lround(wkW) accumulates rounding drift and shows up as
                // a 1 px gap or overlap every few keys, which reads as
                // "the keyboard has random spacing" at narrow widths.
                const int x     = (int) std::lround(static_cast<float>(whiteIdx)       * wkW);
                const int xNext = (int) std::lround(static_cast<float>(whiteIdx + 1)   * wkW);
                keys.push_back({pc, m, x, xNext - x, wkH, false});
                lastWhiteX = x;
                haveWhite = true;
                ++whiteIdx;
            }
            else if (haveWhite)
            {
                // Black keys reference the preceding white in the same
                // octave; if the range starts on a black key we drop the
                // leading black until the first white anchors the row.
                const float offset = blackKeyOffsetFromPrecedingWhite(pc);
                const int x = lastWhiteX + (int) std::lround(offset * wkW);
                keys.push_back({pc, m, x, bkW, bkH, true});
            }
        }
        return keys;
    }

    std::vector<int> ScaleKeyboardView::buildScalePcs() const
    {
        const int rootPc = static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::root)->load());
        const auto scale = static_cast<ScaleName>(static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::scale)->load()));
        const auto pitches = buildScalePitches(scale, rootPc);

        std::set<int> uniq;
        for (int p : pitches) uniq.insert(((p % 12) + 12) % 12);
        return std::vector<int>(uniq.begin(), uniq.end());
    }

    std::vector<int> ScaleKeyboardView::getInScalePcsForTest() const
    {
        return buildScalePcs();
    }

    int ScaleKeyboardView::getPcAtForTest(juce::Point<int> p) const
    {
        const auto keys = buildKeys();
        // Black keys overlay whites; iterate blacks first to match paint
        // order's hit priority (a click that lands on a black sliver picks
        // the black key, not the white underneath).
        for (const auto& k : keys)
        {
            if (!k.isBlack) continue;
            const juce::Rectangle<int> r(k.x, theme::kbdPadTop, k.w, k.h);
            if (r.contains(p)) return k.pc;
        }
        for (const auto& k : keys)
        {
            if (k.isBlack) continue;
            const juce::Rectangle<int> r(k.x, theme::kbdPadTop, k.w, k.h);
            if (r.contains(p)) return k.pc;
        }
        return -1;
    }

    juce::Point<int> ScaleKeyboardView::getKeyCenterForTest(int pc) const
    {
        const auto keys = buildKeys();
        for (const auto& k : keys)
        {
            if (k.pc != pc) continue;
            // Pick a hit-point biased away from any overlapping black key:
            // the white-key bottom strip is unambiguous in the paint order.
            const int cx = k.x + k.w / 2;
            const int cy = theme::kbdPadTop + (k.isBlack
                ? k.h - 6
                : k.h - 8);
            return {cx, cy};
        }
        return {-1, -1};
    }

    void ScaleKeyboardView::parameterChanged(const juce::String&, float)
    {
        // APVTS listeners run on the audio or message thread depending on
        // host wiring. Marshal repaint onto the message thread to stay safe.
        juce::MessageManager::callAsync([safeThis = juce::Component::SafePointer<ScaleKeyboardView>(this)]
        {
            if (auto* self = safeThis.getComponent())
                self->repaint();
        });
    }

    void ScaleKeyboardView::pollPulseForTest(double dtMs)
    {
        // Step 1 — pick up any new emits from the audio thread. Walk the
        // pulse ring from lastSeenPulseVersion_ to the current head. The
        // ring is sized so a 60Hz UI poll picks up every emit even when
        // chord mode publishes multiple voices in one processBlock; a
        // single-slot atomic would collapse same-block emits to just the
        // last visible pulse. Notes outside the visible band
        // (pid::kbdRangeLoNote..pid::kbdRangeHiNote) are dropped here so
        // paint doesn't carry unrenderable pulses.
        const uint32_t head = processor_.getPulseHeadForTest();
        if (head != lastSeenPulseVersion_)
        {
            const int kbdMidiLo = static_cast<int>(
                processor_.apvts.getRawParameterValue(pid::kbdRangeLoNote)->load());
            const int kbdMidiHi = static_cast<int>(
                processor_.apvts.getRawParameterValue(pid::kbdRangeHiNote)->load());
            // If the writer outpaced us by more than the ring size, the
            // oldest unseen slots have already been overwritten. Start
            // from the oldest version still recoverable. The
            // version-confirm below catches any further mid-walk race.
            constexpr uint32_t kRingSize = PointsmanProcessor::kPulseRingSize;
            const uint32_t firstVisible = (head - lastSeenPulseVersion_ > kRingSize)
                ? head - kRingSize
                : lastSeenPulseVersion_;
            for (uint32_t v = firstVisible + 1; v <= head; ++v)
            {
                const uint64_t packed = processor_.pulseRing_[
                    (v - 1) & PointsmanProcessor::kPulseRingMask]
                    .load(std::memory_order_acquire);
                // Confirm the slot still carries the version we expect
                // — if the writer wrapped during our walk, drop the stale
                // entry rather than emit a phantom pulse for a later
                // version.
                if (PointsmanProcessor::unpackPulseVersion(packed) != v) continue;
                const int pitch = PointsmanProcessor::unpackPulsePitch(packed);
                const int vel   = PointsmanProcessor::unpackPulseVelocity(packed);
                if (pitch < kbdMidiLo || pitch > kbdMidiHi) continue;
                double base = static_cast<double>(vel) / 127.0;
                if (base < 0.0) base = 0.0;
                if (base > 1.0) base = 1.0;
                pulses_.push_back({pitch, base, base, 0.0});
            }
            lastSeenPulseVersion_ = head;
        }

        // Step 2 — age existing pulses and prune. Linear decay matching
        // m4l/scaleKeyboard.jsui.js: intensity = baseIntensity *
        // (1 - ageMs/PULSE_DECAY_MS). Base is stored once at creation, so
        // each tick recomputes the displayed intensity directly from the
        // current age — no reciprocal-multiply, no error accumulation.
        const double dt = (dtMs > 0.0) ? dtMs : 0.0;
        if (dt > 0.0)
        {
            std::vector<Pulse> next;
            next.reserve(pulses_.size());
            for (const auto& p : pulses_)
            {
                const double aged = p.ageMs + dt;
                if (aged >= kPulseDecayMs) continue;
                Pulse q = p;
                q.ageMs = aged;
                q.intensity = p.baseIntensity * (1.0 - aged / kPulseDecayMs);
                next.push_back(q);
            }
            pulses_ = std::move(next);
        }
    }

    void ScaleKeyboardView::timerCallback()
    {
        const double now = monotonicMs();
        const double dt  = now - lastTickMs_;
        lastTickMs_ = now;
        const std::size_t before = pulses_.size();
        pollPulseForTest(dt);
        if (!pulses_.empty() || before > 0) repaint();
    }

    double ScaleKeyboardView::pulseGlowFor(int midi) const noexcept
    {
        double sum = 0.0;
        for (const auto& p : pulses_)
            if (p.midi == midi) sum += p.intensity;
        if (sum > 1.0) sum = 1.0;
        return sum;
    }

    void ScaleKeyboardView::mouseDown(const juce::MouseEvent& e)
    {
        const int pc = getPcAtForTest(e.getPosition());
        if (pc < 0 || pc > 11) return;

        if (auto* rp = processor_.apvts.getParameter(pid::root))
            rp->setValueNotifyingHost(rp->convertTo0to1(static_cast<float>(pc)));
    }

    void ScaleKeyboardView::paint(juce::Graphics& g)
    {
        g.fillAll(theme::bg);

        const auto keys      = buildKeys();
        const auto scalePcs  = buildScalePcs();
        const std::set<int> scaleSet(scalePcs.begin(), scalePcs.end());

        const int rootPc = static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::root)->load());

        // White keys first (so blacks paint on top). The inset between
        // adjacent keys is the smaller of "1 px" or "10 % of the key
        // width" so a wide-range setting (key width ≈ 8 px) doesn't have
        // a 25 % visual gap eating each key.
        const auto whiteInset = [&keys]
        {
            for (const auto& k : keys)
                if (!k.isBlack)
                    return std::min(1.0f, static_cast<float>(k.w) * 0.10f);
            return 1.0f;
        }();

        for (const auto& k : keys)
        {
            if (k.isBlack) continue;

            const juce::Rectangle<float> r((float) k.x + whiteInset,
                                           (float) theme::kbdPadTop,
                                           (float) k.w - whiteInset * 2.0f,
                                           (float) k.h);

            const bool inScale = scaleSet.count(k.pc) > 0;
            const juce::Colour fill = inScale ? theme::kbdWhiteInScale
                                              : theme::kbdWhiteOutScale;

            g.setColour(fill);
            g.fillRoundedRectangle(r, 3.0f);

            // Pulse-on-emit overlay. Coral glow scales with intensity so a
            // freshly emitted note flashes and fades over kPulseDecayMs.
            // Drawn before the border so it sits beneath the key outline
            // (matches m4l's draw order: pulse glow under the dot/border).
            // Keyed on `k.midi` (not pc) so only the actually-sounding
            // key glows — same pc in another visible octave stays dark.
            const double whiteGlow = pulseGlowFor(k.midi);
            if (whiteGlow > 0.0)
            {
                g.setColour(theme::pulseGlow.withAlpha(static_cast<float>(whiteGlow * 0.6)));
                g.fillRoundedRectangle(r, 3.0f);
            }

            g.setColour(theme::kbdKeyStroke);
            g.drawRoundedRectangle(r, 3.0f, 1.0f);

            // In-scale dot under the key. Radius / position copied from
            // inboil QuantizerSheet.svelte (white-key dot: r=4 at
            // cy = h-12). The note-name label inboil draws below the dot
            // is intentionally absent: the dynamic-range slider means
            // white keys can become as narrow as ~12 px (81-key span),
            // where C/D/E/... text either clips or fights the dot for
            // space. Octave identity reads off the range slider's value
            // labels instead.
            if (inScale)
            {
                constexpr float dotR = 4.0f;
                const float cx = r.getCentreX();
                const float cy = r.getBottom() - 12.0f;
                g.setColour(theme::kbdWhiteDot);
                g.fillEllipse(cx - dotR, cy - dotR, dotR * 2, dotR * 2);
            }
        }

        // Black keys.
        for (const auto& k : keys)
        {
            if (!k.isBlack) continue;

            const juce::Rectangle<float> r((float) k.x + 1.0f,
                                           (float) theme::kbdPadTop,
                                           (float) (k.w - 2),
                                           (float) k.h);

            const bool inScale = scaleSet.count(k.pc) > 0;
            const juce::Colour fill = inScale ? theme::kbdBlackInScale
                                              : theme::kbdBlackOutScale;

            g.setColour(fill);
            g.fillRoundedRectangle(r, 3.0f);

            const double blackGlow = pulseGlowFor(k.midi);
            if (blackGlow > 0.0)
            {
                g.setColour(theme::pulseGlow.withAlpha(static_cast<float>(blackGlow * 0.7)));
                g.fillRoundedRectangle(r, 3.0f);
            }

            g.setColour(theme::kbdBlackKeyStroke);
            g.drawRoundedRectangle(r, 3.0f, 1.0f);

            // In-scale dot. Inboil black-key dot: r=3, cy = h-10.
            if (inScale)
            {
                constexpr float dotR = 3.0f;
                const float cx = r.getCentreX();
                const float cy = r.getBottom() - 10.0f;
                g.setColour(theme::kbdBlackDot);
                g.fillEllipse(cx - dotR, cy - dotR, dotR * 2, dotR * 2);
            }
        }
    }
}
