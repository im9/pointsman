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

        // White-key index offsets for black keys, expressed in white-key
        // widths from the octave's left edge. Mirrors inboil's
        // BLACK_KEY_OFFSETS map.
        float blackKeyOffset(int pc)
        {
            switch (pc)
            {
                case 1:  return 0.6f;
                case 3:  return 1.7f;
                case 6:  return 3.65f;
                case 8:  return 4.7f;
                case 10: return 5.75f;
                default: return 0.0f;
            }
        }

        constexpr std::array<const char*, 12> kNoteNames = {
            "C","C#","D","D#","E","F","F#","G","G#","A","A#","B"
        };
    }

    ScaleKeyboardView::ScaleKeyboardView(PointsmanProcessor& p)
        : processor_(p)
    {
        processor_.apvts.addParameterListener(pid::scale, this);
        processor_.apvts.addParameterListener(pid::root,  this);
        processor_.apvts.addParameterListener(pid::mode,  this);

        // Initialise pulse-version baseline so a stale value left from
        // a prior editor instance does not trigger a phantom pulse.
        lastSeenPulseVersion_ = PointsmanProcessor::unpackPulseVersion(
            processor_.lastEmittedPulse.load(std::memory_order_acquire));
        lastTickMs_ = monotonicMs();
        startTimerHz(kPulseTimerHz);
    }

    ScaleKeyboardView::~ScaleKeyboardView()
    {
        stopTimer();
        processor_.apvts.removeParameterListener(pid::scale, this);
        processor_.apvts.removeParameterListener(pid::root,  this);
        processor_.apvts.removeParameterListener(pid::mode,  this);
    }

    std::vector<ScaleKeyboardView::KeyInfo> ScaleKeyboardView::buildKeys() const
    {
        std::vector<KeyInfo> keys;
        const int wkW = theme::kbdWhiteW;
        const int wkH = theme::kbdWhiteH;
        const int bkW = theme::kbdBlackW;
        const int bkH = theme::kbdBlackH;

        for (int oct = theme::kbdOctLo; oct <= theme::kbdOctHi; ++oct)
        {
            const int octOffsetX = (oct - theme::kbdOctLo) * 7 * wkW;

            for (int wi = 0; wi < (int) kWhitePcs.size(); ++wi)
            {
                const int pc = kWhitePcs[(std::size_t) wi];
                keys.push_back({pc, oct * 12 + pc,
                                octOffsetX + wi * wkW, wkW, wkH, false});
            }
            for (int pc : kBlackPcs)
            {
                const int x = octOffsetX
                            + (int) std::lround(blackKeyOffset(pc) * (float) wkW);
                keys.push_back({pc, oct * 12 + pc, x, bkW, bkH, true});
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
        // Step 1 — pick up any new emit from the audio thread.
        const uint64_t packed = processor_.lastEmittedPulse.load(std::memory_order_acquire);
        const uint32_t version = PointsmanProcessor::unpackPulseVersion(packed);
        if (version != lastSeenPulseVersion_)
        {
            lastSeenPulseVersion_ = version;
            const int pitch = PointsmanProcessor::unpackPulsePitch(packed);
            const int vel   = PointsmanProcessor::unpackPulseVelocity(packed);
            const int pc    = ((pitch % 12) + 12) % 12;
            double base = static_cast<double>(vel) / 127.0;
            if (base < 0.0) base = 0.0;
            if (base > 1.0) base = 1.0;
            pulses_.push_back({pc, base, base, 0.0});
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

    double ScaleKeyboardView::pulseGlowFor(int pc) const noexcept
    {
        double sum = 0.0;
        for (const auto& p : pulses_)
            if (p.pc == pc) sum += p.intensity;
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

        // Live chord context for the olive highlight in mode = chord. The
        // processor maintains this from controlChannel notes; we read it
        // each paint — no listener needed because chord changes do not flow
        // through APVTS.
        const auto modeChoice = static_cast<ModeChoice>(
            static_cast<int>(processor_.apvts.getRawParameterValue(pid::mode)->load()));
        std::set<int> chordSet;
        if (modeChoice == ModeChoice::Chord)
        {
            for (int pc : processor_.chordContextPcsForTest())
                chordSet.insert(pc);
        }

        const int rootPc = static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::root)->load());

        // White keys first (so blacks paint on top).
        for (const auto& k : keys)
        {
            if (k.isBlack) continue;

            const juce::Rectangle<float> r((float) k.x + 1.0f,
                                           (float) theme::kbdPadTop,
                                           (float) (k.w - 2),
                                           (float) k.h);

            const bool inChord = chordSet.count(k.pc) > 0;
            const bool inScale = scaleSet.count(k.pc) > 0;

            juce::Colour fill;
            if (modeChoice == ModeChoice::Chord && inChord)
                fill = theme::oliveBg;
            else if (inScale)
                fill = theme::fg.withAlpha(0.06f);
            else
                fill = theme::bg.darker(0.05f);

            g.setColour(fill);
            g.fillRoundedRectangle(r, 3.0f);

            // Pulse-on-emit overlay. Coral glow scales with intensity so a
            // freshly emitted note flashes and fades over kPulseDecayMs.
            // Drawn before the border so it sits beneath the key outline
            // (matches m4l's draw order: pulse glow under the dot/border).
            const double whiteGlow = pulseGlowFor(k.pc);
            if (whiteGlow > 0.0)
            {
                g.setColour(theme::pulseGlow.withAlpha(static_cast<float>(whiteGlow * 0.6)));
                g.fillRoundedRectangle(r, 3.0f);
            }

            g.setColour(inChord ? theme::olive : theme::lzBorder);
            g.drawRoundedRectangle(r, 3.0f, 1.0f);

            // In-scale dot under the key.
            if (inScale)
            {
                const float dotR = 3.0f;
                const float cx = r.getCentreX();
                const float cy = r.getBottom() - 12.0f;
                g.setColour(inChord ? theme::olive : theme::fg.withAlpha(0.45f));
                g.fillEllipse(cx - dotR, cy - dotR, dotR * 2, dotR * 2);
            }

            // Note label (small, top of key).
            g.setColour(theme::fg.withAlpha(k.pc == rootPc ? 0.85f : 0.35f));
            g.setFont(theme::dataFont(theme::fsSm, k.pc == rootPc));
            g.drawText(kNoteNames[(std::size_t) k.pc],
                       (int) r.getX(), (int) r.getBottom() - 28,
                       (int) r.getWidth(), 12,
                       juce::Justification::centred);
        }

        // Black keys.
        for (const auto& k : keys)
        {
            if (!k.isBlack) continue;

            const juce::Rectangle<float> r((float) k.x + 1.0f,
                                           (float) theme::kbdPadTop,
                                           (float) (k.w - 2),
                                           (float) k.h);

            const bool inChord = chordSet.count(k.pc) > 0;
            const bool inScale = scaleSet.count(k.pc) > 0;

            juce::Colour fill;
            if (modeChoice == ModeChoice::Chord && inChord)
                fill = theme::olive;
            else
                fill = theme::fg.withAlpha(inScale ? 0.70f : 0.85f);

            g.setColour(fill);
            g.fillRoundedRectangle(r, 2.0f);

            const double blackGlow = pulseGlowFor(k.pc);
            if (blackGlow > 0.0)
            {
                g.setColour(theme::pulseGlow.withAlpha(static_cast<float>(blackGlow * 0.7)));
                g.fillRoundedRectangle(r, 2.0f);
            }

            if (inScale)
            {
                const float dotR = 2.5f;
                const float cx = r.getCentreX();
                const float cy = r.getBottom() - 9.0f;
                g.setColour(inChord ? theme::olive : theme::bg.withAlpha(0.85f));
                g.fillEllipse(cx - dotR, cy - dotR, dotR * 2, dotR * 2);
            }
        }
    }
}
