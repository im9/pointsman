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
        constexpr int kPhrygianDominant[] = {0, 1, 4, 5, 7, 8, 10};

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
                case ScaleName::PhrygianDominant:return {kPhrygianDominant, std::size(kPhrygianDominant)};
            }
            return {nullptr, 0};
        }
    }

    void buildScalePitchesInto(ScaleName scale, int root, std::vector<int>& out)
    {
        out.clear();
        if (scale == ScaleName::ChromaticHalf)
        {
            for (int i = 0; i < 128; ++i) out.push_back(i);
            return;
        }

        const auto [intervals, n] = intervalsFor(scale);
        std::array<bool, 12> pcSet{};
        for (std::size_t i = 0; i < n; ++i)
        {
            const int pc = ((root + intervals[i]) % 12 + 12) % 12;
            pcSet[(std::size_t) pc] = true;
        }
        for (int v = 0; v <= 127; ++v)
        {
            if (pcSet[(std::size_t) (v % 12)]) out.push_back(v);
        }
    }

    std::vector<int> buildScalePitches(ScaleName scale, int root)
    {
        std::vector<int> out;
        out.reserve(128);
        buildScalePitchesInto(scale, root, out);
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

    // =====================================================================
    // ADR 004 — chord shape primitive
    // =====================================================================
    namespace
    {
        // Chord-shape interval tables. Order mirrors ChordShape enum and
        // scripts/gen-test-vectors/chord.mjs CHORD_SHAPES bit-for-bit.
        constexpr int kChordMaj[]     = {0, 4, 7};
        constexpr int kChordMin[]     = {0, 3, 7};
        constexpr int kChordDim[]     = {0, 3, 6};
        constexpr int kChordAug[]     = {0, 4, 8};
        constexpr int kChordSus2[]    = {0, 2, 7};
        constexpr int kChordSus4[]    = {0, 5, 7};
        constexpr int kChordPower[]   = {0, 7};
        constexpr int kChordMaj7[]    = {0, 4, 7, 11};
        constexpr int kChordMin7[]    = {0, 3, 7, 10};
        constexpr int kChordDom7[]    = {0, 4, 7, 10};
        constexpr int kChordMin7b5[]  = {0, 3, 6, 10};
        constexpr int kChordDim7[]    = {0, 3, 6, 9};
        constexpr int kChordMaj6[]    = {0, 4, 7, 9};
        constexpr int kChordMin6[]    = {0, 3, 7, 9};
        constexpr int kChordAdd9[]    = {0, 4, 7, 14};
        constexpr int kChordMaj9[]    = {0, 4, 7, 11, 14};
        constexpr int kChordMin9[]    = {0, 3, 7, 10, 14};
        constexpr int kChordDom9[]    = {0, 4, 7, 10, 14};
        constexpr int kChordDom13[]   = {0, 4, 7, 10, 14, 21};
        constexpr int kChordOctave[]  = {0, 12};

        std::pair<const int*, std::size_t> chordIntervalsFor(ChordShape s) noexcept
        {
            switch (s)
            {
                case ChordShape::Maj:    return {kChordMaj,    std::size(kChordMaj)};
                case ChordShape::Min:    return {kChordMin,    std::size(kChordMin)};
                case ChordShape::Dim:    return {kChordDim,    std::size(kChordDim)};
                case ChordShape::Aug:    return {kChordAug,    std::size(kChordAug)};
                case ChordShape::Sus2:   return {kChordSus2,   std::size(kChordSus2)};
                case ChordShape::Sus4:   return {kChordSus4,   std::size(kChordSus4)};
                case ChordShape::Power:  return {kChordPower,  std::size(kChordPower)};
                case ChordShape::Maj7:   return {kChordMaj7,   std::size(kChordMaj7)};
                case ChordShape::Min7:   return {kChordMin7,   std::size(kChordMin7)};
                case ChordShape::Dom7:   return {kChordDom7,   std::size(kChordDom7)};
                case ChordShape::Min7b5: return {kChordMin7b5, std::size(kChordMin7b5)};
                case ChordShape::Dim7:   return {kChordDim7,   std::size(kChordDim7)};
                case ChordShape::Maj6:   return {kChordMaj6,   std::size(kChordMaj6)};
                case ChordShape::Min6:   return {kChordMin6,   std::size(kChordMin6)};
                case ChordShape::Add9:   return {kChordAdd9,   std::size(kChordAdd9)};
                case ChordShape::Maj9:   return {kChordMaj9,   std::size(kChordMaj9)};
                case ChordShape::Min9:   return {kChordMin9,   std::size(kChordMin9)};
                case ChordShape::Dom9:   return {kChordDom9,   std::size(kChordDom9)};
                case ChordShape::Dom13:  return {kChordDom13,  std::size(kChordDom13)};
                case ChordShape::Octave: return {kChordOctave, std::size(kChordOctave)};
            }
            return {nullptr, 0};
        }
    }

    void applyChordShapeInto(int rootMidi, ChordShape shape, std::vector<int>& out)
    {
        out.clear();
        const auto [intervals, n] = chordIntervalsFor(shape);
        for (std::size_t i = 0; i < n; ++i)
        {
            const int v = rootMidi + intervals[i];
            if (v >= 0 && v <= 127) out.push_back(v);
        }
    }

    std::vector<int> applyChordShape(int rootMidi, ChordShape shape)
    {
        std::vector<int> out;
        out.reserve(8); // covers the worst case (Dom13 = 6 voices) + headroom
        applyChordShapeInto(rootMidi, shape, out);
        return out;
    }

    // =====================================================================
    // ADR 004 — arpeggiator rate
    // =====================================================================

    ArpRateFraction parseArpRate(ArpRate rate)
    {
        switch (rate)
        {
            case ArpRate::Q4:   return {1, 1};
            case ArpRate::Q4D:  return {3, 2};
            case ArpRate::Q4T:  return {2, 3};
            case ArpRate::Q8:   return {1, 2};
            case ArpRate::Q8D:  return {3, 4};
            case ArpRate::Q8T:  return {1, 3};
            case ArpRate::Q16:  return {1, 4};
            case ArpRate::Q16D: return {3, 8};
            case ArpRate::Q16T: return {1, 6};
            case ArpRate::Q32:  return {1, 8};
        }
        return {1, 4}; // unreachable; matches default arp rate
    }

    // =====================================================================
    // ADR 004 — arpeggiator pattern cursor + step resolution
    // =====================================================================

    ArpState nextArpIndex(ArpPattern pattern, ArpState state, int poolSize,
                          int octaves, int stepRepeats, double rngDraw01)
    {
        if (poolSize == 0) return state;
        const int sr = stepRepeats < 1 ? 1 : stepRepeats;
        const int oc = octaves < 1 ? 1 : octaves;

        const int nextRepeat = state.repeatTick + 1;
        if (nextRepeat < sr)
        {
            return { state.index, state.round, nextRepeat, state.direction };
        }

        int newIndex = state.index;
        int newRound = state.round;
        int newDirection = state.direction;

        switch (pattern)
        {
            case ArpPattern::Up:
            case ArpPattern::AsPlayed:
            {
                newIndex = state.index + 1;
                if (newIndex >= poolSize)
                {
                    newIndex = 0;
                    newRound = (state.round + 1) % oc;
                }
                break;
            }
            case ArpPattern::Down:
            {
                newIndex = state.index - 1;
                if (newIndex < 0)
                {
                    newIndex = poolSize - 1;
                    newRound = (state.round + 1) % oc;
                }
                break;
            }
            case ArpPattern::UpDown:
            {
                if (poolSize == 1)
                {
                    newIndex = 0;
                    newRound = (state.round + 1) % oc;
                    break;
                }
                int candidate = state.index + state.direction;
                if (candidate >= poolSize)
                {
                    candidate = poolSize - 2;
                    newDirection = -1;
                }
                else if (candidate < 0)
                {
                    candidate = 1;
                    newDirection = 1;
                    newRound = (state.round + 1) % oc;
                }
                newIndex = candidate;
                break;
            }
            case ArpPattern::Random:
            {
                int idx = (int) (rngDraw01 * (double) poolSize);
                if (idx < 0) idx = 0;
                if (idx >= poolSize) idx = poolSize - 1;
                newIndex = idx;
                // No positional structure — round counter is caller-managed.
                break;
            }
            case ArpPattern::Strike:
            {
                newIndex = 0;
                newRound = (state.round + 1) % oc;
                break;
            }
        }

        return { newIndex, newRound, 0, newDirection };
    }

    ArpEmission resolveArpStep(const std::vector<int>& pool, int index,
                               int octaveRound, ArpPattern pattern)
    {
        ArpEmission out;
        if (pool.empty()) { out.kind = ArpEmissionKind::Rest; return out; }
        const int shift = octaveRound * 12;
        if (pattern == ArpPattern::Strike)
        {
            std::vector<int> pitches;
            pitches.reserve(pool.size());
            for (const int p : pool)
            {
                const int v = p + shift;
                if (v >= 0 && v <= 127) pitches.push_back(v);
            }
            if (pitches.empty()) { out.kind = ArpEmissionKind::Rest; return out; }
            out.kind = ArpEmissionKind::Emit;
            out.pitches = std::move(pitches);
            return out;
        }
        const int n = (int) pool.size();
        // Positive-modulo so negative index inputs wrap correctly.
        const int i = ((index % n) + n) % n;
        const int v = pool[(std::size_t) i] + shift;
        if (v < 0 || v > 127) { out.kind = ArpEmissionKind::Rest; return out; }
        out.kind = ArpEmissionKind::Emit;
        out.pitches.push_back(v);
        return out;
    }

    // =====================================================================
    // ADR 004 — variation cascade
    // =====================================================================

    ArpVariationResult applyArpVariation(const ArpEmission& emission, double variation,
                                         double rngDraw01, double rngDraw02)
    {
        ArpVariationResult r;
        if (emission.kind == ArpEmissionKind::Rest)
        {
            r.effect = ArpVariationEffect::Rest;
            return r;
        }
        double v = variation;
        if (v < 0.0) v = 0.0;
        if (v > 1.0) v = 1.0;

        const double restEnd = 0.30 * v;
        const double octEnd  = 0.50 * v;
        const double flamEnd = 0.65 * v;

        if (v == 0.0 || rngDraw01 >= flamEnd)
        {
            r.effect = ArpVariationEffect::Normal;
            r.pitches = emission.pitches;
            return r;
        }
        if (rngDraw01 < restEnd)
        {
            r.effect = ArpVariationEffect::Rest;
            return r;
        }
        if (rngDraw01 < octEnd)
        {
            const int semitones = rngDraw02 < 0.5 ? -12 : 12;
            std::vector<int> shifted;
            shifted.reserve(emission.pitches.size());
            bool overflow = false;
            for (const int p : emission.pitches)
            {
                const int s = p + semitones;
                if (s < 0 || s > 127) { overflow = true; break; }
                shifted.push_back(s);
            }
            if (overflow)
            {
                r.effect = ArpVariationEffect::Normal;
                r.pitches = emission.pitches;
                return r;
            }
            r.effect = ArpVariationEffect::OctaveShift;
            r.pitches = std::move(shifted);
            r.semitones = semitones;
            return r;
        }
        // Flam bucket.
        r.effect = ArpVariationEffect::Flam;
        r.pitches = emission.pitches;
        r.secondOffsetFraction = 0.5;
        return r;
    }

    // =====================================================================
    // ADR 004 — groove cascade
    // =====================================================================

    ArpGrooveResult applyArpGroove(const ArpVariationResult& emission, int tickIndex,
                                   const ArpAccentTable& accentTable,
                                   const ArpSlideTable& slideTable,
                                   double swing, double sixteenthDurationSamples)
    {
        ArpGrooveResult r;
        if (emission.effect == ArpVariationEffect::Rest)
        {
            r.applied = false;
            return r;
        }
        // Positive-modulo so negative tickIndex (e.g. pre-roll) wraps.
        const int i = ((tickIndex % 16) + 16) % 16;
        r.applied = true;
        r.velocity = accentTable[(std::size_t) i];
        r.tieToNext = slideTable[(std::size_t) i];
        r.swingOffsetSamples = (tickIndex % 2 != 0)
            ? swing * (sixteenthDurationSamples / 2.0)
            : 0.0;
        return r;
    }

    // =====================================================================
    // ADR 004 — slide-aware noteOff scheduling
    // =====================================================================

    double scheduleArpNoteOff(bool slideOnCurrent, double gateSamples,
                              double nextTickSampleOffset)
    {
        return slideOnCurrent ? nextTickSampleOffset : gateSamples;
    }
}
