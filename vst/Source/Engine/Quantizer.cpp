#include "Quantizer.h"

#include <algorithm>
#include <array>
#include <cstdlib>
#include <iterator>
#include <utility>

namespace pointsman
{
    namespace
    {
        // Per-scale interval tables. Mirrors m4l/engine/quantizer.ts
        // SCALE_INTERVALS exactly (also captured in
        // docs/ai/quantizer-test-vectors.json meta.scale_intervals).
        // ChromaticHalf is intentionally absent — it is handled by the
        // identity branch in buildScalePitches.
        constexpr int kMajor[]            = {0, 2, 4, 5, 7, 9, 11};
        constexpr int kMinor[]            = {0, 2, 3, 5, 7, 8, 10};
        constexpr int kDorian[]           = {0, 2, 3, 5, 7, 9, 10};
        constexpr int kPhrygian[]         = {0, 1, 3, 5, 7, 8, 10};
        constexpr int kLydian[]           = {0, 2, 4, 6, 7, 9, 11};
        constexpr int kMixolydian[]       = {0, 2, 4, 5, 7, 9, 10};
        constexpr int kLocrian[]          = {0, 1, 3, 5, 6, 8, 10};
        constexpr int kPentatonic[]       = {0, 2, 4, 7, 9};
        constexpr int kMinorPentatonic[]  = {0, 3, 5, 7, 10};
        constexpr int kBlues[]            = {0, 3, 5, 6, 7, 10};
        constexpr int kHarmonic[]         = {0, 2, 3, 5, 7, 8, 11};
        constexpr int kMelodic[]          = {0, 2, 3, 5, 7, 9, 11};
        constexpr int kWhole[]            = {0, 2, 4, 6, 8, 10};
        constexpr int kChromatic[]        = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};

        std::pair<const int*, std::size_t> intervalsFor(ScaleName s) noexcept
        {
            switch (s)
            {
                case ScaleName::Major:           return {kMajor,           std::size(kMajor)};
                case ScaleName::Minor:           return {kMinor,           std::size(kMinor)};
                case ScaleName::Dorian:          return {kDorian,          std::size(kDorian)};
                case ScaleName::Phrygian:        return {kPhrygian,        std::size(kPhrygian)};
                case ScaleName::Lydian:          return {kLydian,          std::size(kLydian)};
                case ScaleName::Mixolydian:      return {kMixolydian,      std::size(kMixolydian)};
                case ScaleName::Locrian:         return {kLocrian,         std::size(kLocrian)};
                case ScaleName::Pentatonic:      return {kPentatonic,      std::size(kPentatonic)};
                case ScaleName::MinorPentatonic: return {kMinorPentatonic, std::size(kMinorPentatonic)};
                case ScaleName::Blues:           return {kBlues,           std::size(kBlues)};
                case ScaleName::Harmonic:        return {kHarmonic,        std::size(kHarmonic)};
                case ScaleName::Melodic:         return {kMelodic,         std::size(kMelodic)};
                case ScaleName::Whole:           return {kWhole,           std::size(kWhole)};
                case ScaleName::Chromatic:       return {kChromatic,       std::size(kChromatic)};
                case ScaleName::ChromaticHalf:   return {nullptr, 0};
            }
            return {nullptr, 0};
        }
    }

    std::vector<int> buildScalePitches(ScaleName scale, int root)
    {
        if (scale == ScaleName::ChromaticHalf)
        {
            std::vector<int> out(128);
            for (int i = 0; i < 128; ++i) out[(std::size_t) i] = i;
            return out;
        }

        const auto [intervals, n] = intervalsFor(scale);
        std::array<bool, 12> pcSet{};
        for (std::size_t i = 0; i < n; ++i)
        {
            const int pc = ((root + intervals[i]) % 12 + 12) % 12;
            pcSet[(std::size_t) pc] = true;
        }

        std::vector<int> out;
        out.reserve(128);
        for (int v = 0; v <= 127; ++v)
        {
            if (pcSet[(std::size_t) (v % 12)]) out.push_back(v);
        }
        return out;
    }

    namespace
    {
        // Pointer + count form of the snap rule, so callers that build
        // their pitch span on the stack (snapToChordTones) avoid a
        // heap-allocating std::vector on the audio thread. Same tie-to-
        // lower / empty → identity contract as the public overload.
        int snapToScaleSpan(int note, const int* pitches, std::size_t n) noexcept
        {
            if (n == 0) return note;
            if (note <= pitches[0])     return pitches[0];
            if (note >= pitches[n - 1]) return pitches[n - 1];

            const auto* it = std::lower_bound(pitches, pitches + n, note);
            const int upper = *it;
            if (upper == note) return upper;
            const int lower = *(it - 1);
            const int dUp = upper - note;
            const int dDn = note - lower;
            return dDn <= dUp ? lower : upper; // tie → lower
        }
    }

    int snapToScale(int note, const std::vector<int>& pitches)
    {
        return snapToScaleSpan(note, pitches.data(), pitches.size());
    }

    int snapToChordTones(int note,
                         uint16_t chordPcsMask,
                         const std::vector<int>& scalePitches,
                         int tolerance)
    {
        if (chordPcsMask == 0) return snapToScale(note, scalePitches);

        // Stack buffer sized to the worst case (every pitch class lit →
        // 128 entries). Avoids a per-call heap allocation on the audio
        // thread; this function runs on every input noteOn in mode=chord.
        std::array<int, 128> chordMidi{};
        std::size_t chordCount = 0;
        for (int v = 0; v <= 127; ++v)
        {
            if ((chordPcsMask >> (v % 12)) & 1u)
                chordMidi[chordCount++] = v;
        }

        const int nearest = snapToScaleSpan(note, chordMidi.data(), chordCount);
        if (std::abs(nearest - note) <= tolerance) return nearest;
        return snapToScale(note, scalePitches);
    }

    int snapToChordTones(int note,
                         const std::vector<int>& chordPcs,
                         const std::vector<int>& scalePitches,
                         int tolerance)
    {
        uint16_t mask = 0;
        for (int pc : chordPcs)
            mask |= static_cast<uint16_t>(1u << ((((pc % 12) + 12) % 12)));
        return snapToChordTones(note, mask, scalePitches, tolerance);
    }

    int diatonicShift(int note,
                      int interval,
                      HarmonyDirection direction,
                      const std::vector<int>& scalePitches)
    {
        if (scalePitches.empty()) return note;

        const int snapped = snapToScale(note, scalePitches);
        const auto it = std::find(scalePitches.begin(), scalePitches.end(), snapped);
        const int idx = (int) (it - scalePitches.begin());

        const int steps = interval - 1;
        const int targetIdx = (direction == HarmonyDirection::Above)
                            ? idx + steps
                            : idx - steps;

        if (targetIdx < 0) return scalePitches.front();
        if (targetIdx >= (int) scalePitches.size()) return scalePitches.back();
        return scalePitches[(std::size_t) targetIdx];
    }
}
