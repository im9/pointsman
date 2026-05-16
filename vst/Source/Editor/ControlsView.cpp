#include "Editor/ControlsView.h"

#include "Editor/Theme.h"
#include "Plugin/Parameters.h"
#include "Plugin/PluginProcessor.h"

#include <algorithm>

using namespace pointsman;

namespace pointsman::editor
{
    namespace
    {
        constexpr std::array<const char*, 12> kNoteNames = {
            "C","C#","D","D#","E","F","F#","G","G#","A","A#","B"
        };

        constexpr std::array<int, 4> kHarmonyIntervals = {3, 4, 5, 6};

        const char* modeDescriptionFor(ModeChoice m)
        {
            switch (m)
            {
                case ModeChoice::Scale: return "snap to nearest scale degree";
                case ModeChoice::Chord: return "expand to a diatonic chord (1 in, N out)";
            }
            return "";
        }

        void styleSlider(juce::Slider& s, juce::Slider::SliderStyle style)
        {
            s.setSliderStyle(style);
            s.setColour(juce::Slider::trackColourId,           theme::olive.withAlpha(0.6f));
            s.setColour(juce::Slider::backgroundColourId,      theme::lzBorder);
            s.setColour(juce::Slider::thumbColourId,           theme::olive);
            s.setColour(juce::Slider::textBoxTextColourId,     theme::fg);
            s.setColour(juce::Slider::textBoxOutlineColourId,  juce::Colours::transparentBlack);
            s.setColour(juce::Slider::textBoxBackgroundColourId, theme::bg);
            s.setTextBoxStyle(juce::Slider::TextBoxRight, false, 44, theme::rowHeight);
        }

        void styleLegend(juce::Label& l, juce::String text)
        {
            l.setText(std::move(text), juce::dontSendNotification);
            l.setFont(theme::dataFont(theme::fsSm, true));
            l.setColour(juce::Label::textColourId, theme::fg.withAlpha(0.45f));
            l.setJustificationType(juce::Justification::centredLeft);
        }

        void styleControlLabel(juce::Label& l, juce::String text)
        {
            l.setText(std::move(text), juce::dontSendNotification);
            l.setFont(theme::dataFont(theme::fsMd, true));
            l.setColour(juce::Label::textColourId, theme::fg.withAlpha(0.6f));
            l.setJustificationType(juce::Justification::centredLeft);
        }

        void styleCombo(juce::ComboBox& c)
        {
            c.setColour(juce::ComboBox::backgroundColourId, juce::Colours::transparentBlack);
            c.setColour(juce::ComboBox::outlineColourId,    theme::lzBorderMid);
            c.setColour(juce::ComboBox::textColourId,       theme::fg);
            c.setColour(juce::ComboBox::arrowColourId,      theme::fg.withAlpha(0.5f));
        }
    }

    // ── RangeSlider (TwoValueHorizontal bound to a pair of APVTS Int params) ──
    // JUCE's SliderAttachment binds one param to one slider value. A two-
    // value slider needs two attachments, which the stock attachment class
    // can't do — it owns ::onValueChange, so a second instance would
    // overwrite the first's listener. RangeSlider takes the same path
    // SliderAttachment uses internally: subscribe as a ParameterListener
    // (for host / undo writes) and assign onValueChange (for user drags).
    // Marshals listener callbacks onto the message thread with SafePointer
    // so the slider can be destroyed concurrently with an in-flight write.
    class RangeSlider : public juce::Slider,
                        private juce::AudioProcessorValueTreeState::Listener
    {
    public:
        RangeSlider(juce::AudioProcessorValueTreeState& apvts,
                    juce::String                       loPid,
                    juce::String                       hiPid,
                    std::function<void()>              onChanged = {})
            : apvts_(apvts),
              loPid_(std::move(loPid)),
              hiPid_(std::move(hiPid)),
              onChanged_(std::move(onChanged))
        {
            auto* loParam = apvts_.getParameter(loPid_);
            auto* hiParam = apvts_.getParameter(hiPid_);
            jassert(loParam != nullptr && hiParam != nullptr);

            // Both params share an Int range (24..108 from Parameters.cpp).
            // Pull the range from loParam — assert they match in dev builds.
            const auto loRange = loParam->getNormalisableRange();
            jassert(loRange.start == hiParam->getNormalisableRange().start &&
                    loRange.end   == hiParam->getNormalisableRange().end);
            setSliderStyle(juce::Slider::TwoValueHorizontal);
            setRange(loRange.start, loRange.end, 1.0);
            // setMinAndMaxValues atomically: setMinValue alone would clamp
            // to the current max (range start = 24 at this point), so the
            // first call below shoves min back to 24 unless max is moved
            // first. The pair-API avoids that ordering trap.
            const float initLo = apvts_.getRawParameterValue(loPid_)->load();
            const float initHi = apvts_.getRawParameterValue(hiPid_)->load();
            setMinAndMaxValues(initLo, initHi, juce::dontSendNotification);
            setTextBoxStyle(juce::Slider::NoTextBox, true, 0, 0);

            apvts_.addParameterListener(loPid_, this);
            apvts_.addParameterListener(hiPid_, this);

            onValueChange = [this]
            {
                if (suppressUiToParam_) return;
                auto* lo = apvts_.getParameter(loPid_);
                auto* hi = apvts_.getParameter(hiPid_);
                lo->setValueNotifyingHost(lo->convertTo0to1(
                    static_cast<float>(getMinValue())));
                hi->setValueNotifyingHost(hi->convertTo0to1(
                    static_cast<float>(getMaxValue())));
                if (onChanged_) onChanged_();
            };
        }

        ~RangeSlider() override
        {
            apvts_.removeParameterListener(loPid_, this);
            apvts_.removeParameterListener(hiPid_, this);
        }

    private:
        void parameterChanged(const juce::String& id, float newValue) override
        {
            juce::MessageManager::callAsync(
                [self = juce::Component::SafePointer<RangeSlider>(this), id, newValue]
                {
                    auto* s = self.getComponent();
                    if (s == nullptr) return;
                    // dontSendNotification → no echo back into APVTS via
                    // onValueChange. suppressUiToParam_ guards the
                    // setMinValue/setMaxValue path too in case JUCE ever
                    // fires the callback regardless.
                    s->suppressUiToParam_ = true;
                    if (id == s->loPid_)
                        s->setMinValue(newValue, juce::dontSendNotification);
                    else if (id == s->hiPid_)
                        s->setMaxValue(newValue, juce::dontSendNotification);
                    s->suppressUiToParam_ = false;
                    if (s->onChanged_) s->onChanged_();
                });
        }

        juce::AudioProcessorValueTreeState& apvts_;
        juce::String                        loPid_;
        juce::String                        hiPid_;
        std::function<void()>               onChanged_;
        bool                                suppressUiToParam_ = false;
    };

    // ── Mode pill (small TextButton with inboil active/inactive look) ───
    class ModePill : public juce::TextButton
    {
    public:
        explicit ModePill(juce::String text) : juce::TextButton(std::move(text)) {}

        void setActiveState(bool a)
        {
            if (active_ != a) { active_ = a; repaint(); }
        }

        void paintButton(juce::Graphics& g,
                         bool /*shouldDrawHighlighted*/,
                         bool /*shouldDrawDown*/) override
        {
            const auto bounds = getLocalBounds().toFloat().reduced(0.5f);
            g.setColour(active_ ? theme::olive : theme::lzBorderMid);
            g.drawRoundedRectangle(bounds, 1.0f, 1.0f);
            g.setColour(active_ ? theme::olive : theme::fg.withAlpha(0.5f));
            g.setFont(theme::dataFont(theme::fsMd, true));
            g.drawText(getButtonText(), getLocalBounds(),
                       juce::Justification::centred);
        }

    private:
        bool active_ = false;
    };

    // ── Harmony badge (combined interval+direction combo + remove button) ──
    // Earlier two-combo layout (interval | direction | x) was ~30 px per
    // combo at the cap-of-3 badge width, which truncated "above"/"below"
    // and even "3rd" to "...". One 8-item combo ("3rd ↑" … "6th ↓") buys
    // back the horizontal space and makes the current selection
    // legible at a glance.
    class HarmonyBadge : public juce::Component
    {
    public:
        // id = (interval - 3) * 2 + (Above ? 1 : 2). interval ∈ {3,4,5,6}.
        static int voiceToId(int interval, HarmonyDirection dir)
        {
            const int iv = std::clamp(interval, 3, 6);
            return (iv - 3) * 2 + (dir == HarmonyDirection::Above ? 1 : 2);
        }

        static HarmonyVoice idToVoice(int id)
        {
            HarmonyVoice v{};
            const int clamped = std::clamp(id, 1, 8);
            v.interval  = ((clamped - 1) / 2) + 3;
            v.direction = ((clamped - 1) % 2 == 0) ? HarmonyDirection::Above
                                                   : HarmonyDirection::Below;
            return v;
        }

        HarmonyBadge(int idx, HarmonyVoice initial,
                     std::function<void(int, HarmonyVoice)> onEdit,
                     std::function<void(int)> onRemove)
            : idx_(idx), onEdit_(std::move(onEdit)), onRemove_(std::move(onRemove))
        {
            static constexpr std::array<const char*, 4> labels =
                {"3rd","4th","5th","6th"};
            // Words instead of arrows — the vertical-stack badge gets the
            // full rail width, so there's plenty of room and "above"/"below"
            // is what inboil uses (less guesswork than "↑/↓").
            for (int iv : kHarmonyIntervals)
            {
                const auto base = juce::String(labels[(std::size_t) (iv - 3)]);
                combo_.addItem(base + " above",
                               voiceToId(iv, HarmonyDirection::Above));
                combo_.addItem(base + " below",
                               voiceToId(iv, HarmonyDirection::Below));
            }
            combo_.setSelectedId(
                voiceToId(initial.interval, initial.direction),
                juce::dontSendNotification);
            styleCombo(combo_);
            combo_.onChange = [this]{ emit(); };
            addAndMakeVisible(combo_);

            removeBtn_.setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
            removeBtn_.setColour(juce::TextButton::textColourOffId, theme::fg.withAlpha(0.5f));
            removeBtn_.onClick = [this]{ if (onRemove_) onRemove_(idx_); };
            addAndMakeVisible(removeBtn_);
        }

        void paint(juce::Graphics& g) override
        {
            g.setColour(theme::olive);
            g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(0.5f), 1.0f, 1.0f);
        }

        void resized() override
        {
            auto r = getLocalBounds().reduced(2);
            const int rmW = 18;
            removeBtn_.setBounds(r.removeFromRight(rmW));
            combo_.setBounds(r);
        }

        juce::ComboBox& getComboForTest() { return combo_; }

    private:
        void emit()
        {
            const int id = combo_.getSelectedId();
            if (id < 1 || id > 8) return;
            if (onEdit_) onEdit_(idx_, idToVoice(id));
        }

        int idx_;
        std::function<void(int, HarmonyVoice)> onEdit_;
        std::function<void(int)>               onRemove_;
        juce::ComboBox  combo_;
        juce::TextButton removeBtn_ {"x"};
    };

    // ── ControlsView ──────────────────────────────────────────────────
    ControlsView::ControlsView(PointsmanProcessor& p)
        : processor_(p),
          feelAtt_  (p.apvts, pid::feel,  feelSlider_),
          driftAtt_ (p.apvts, pid::drift, driftSlider_)
    {
        // ComboBox attachments are constructed below, AFTER addItem() — see
        // the scaleAtt_/rootAtt_ comment in ControlsView.h.

        // Scale group
        styleLegend(scaleLegend_, "SCALE");
        addAndMakeVisible(scaleLegend_);
        // No row-level "SCALE" label — the group legend already says
        // SCALE and a second copy on the row just reads as duplicated
        // text. The ROOT row keeps its label because it sits in the same
        // group and the two combos otherwise look identical.
        styleCombo(scaleCombo_);
        for (std::size_t i = 0; i < kScaleChoiceLabels.size(); ++i)
            scaleCombo_.addItem(kScaleChoiceLabels[i], static_cast<int>(i + 1));
        scaleAtt_ = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
            p.apvts, pid::scale, scaleCombo_);
        addAndMakeVisible(scaleCombo_);

        styleControlLabel(rootLabel_, "ROOT");
        addAndMakeVisible(rootLabel_);
        styleCombo(rootCombo_);
        for (int i = 0; i < 12; ++i)
            rootCombo_.addItem(kNoteNames[(std::size_t) i], i + 1);
        rootAtt_ = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
            p.apvts, pid::root, rootCombo_);
        addAndMakeVisible(rootCombo_);

        // Mode group
        styleLegend(modeLegend_, "MODE");
        addAndMakeVisible(modeLegend_);
        const std::array<juce::String, 2> pillNames {"SCALE", "CHORD"};
        for (std::size_t i = 0; i < pills_.size(); ++i)
        {
            pills_[i] = std::make_unique<ModePill>(pillNames[i]);
            pills_[i]->onClick = [this, i]{ onModePillClicked((int) i); };
            addAndMakeVisible(*pills_[i]);
        }
        modeDesc_.setFont(theme::dataFont(theme::fsSm));
        modeDesc_.setColour(juce::Label::textColourId, theme::fg.withAlpha(0.4f));
        modeDesc_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(modeDesc_);
        syncModeHighlights();

        // Harmony group
        styleLegend(harmonyLegend_, "HARMONY");
        addAndMakeVisible(harmonyLegend_);
        addHarmonyBtn_.setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
        addHarmonyBtn_.setColour(juce::TextButton::textColourOffId, theme::fg);
        addHarmonyBtn_.onClick = [this]{ onAddHarmonyClicked(); };
        addAndMakeVisible(addHarmonyBtn_);
        rebuildHarmonyBadges();

        // Humanize group (Phase 5: 2 sliders)
        styleLegend(humanizeLegend_, "HUMANIZE");
        addAndMakeVisible(humanizeLegend_);
        struct SS { juce::Label* lbl; juce::Slider* s; const char* text; };
        const std::array<SS, 2> sliders = {{
            {&feelLabel_,  &feelSlider_,  "FEEL"},
            {&driftLabel_, &driftSlider_, "DRFT"},
        }};
        for (auto& ss : sliders)
        {
            styleControlLabel(*ss.lbl, ss.text);
            addAndMakeVisible(*ss.lbl);
            styleSlider(*ss.s, juce::Slider::LinearHorizontal);
            // Override the SliderAttachment's default text-from-value (which
            // uses parameter::getText() and yields up to 7 decimals for a
            // 0..1 float). Two-decimal display matches inboil's data-grid feel.
            ss.s->textFromValueFunction = [](double v){ return juce::String(v, 2); };
            ss.s->updateText();
            addAndMakeVisible(*ss.s);
        }

        // Routing group (Phase 5: IN CH only)
        styleLegend(routingLegend_, "ROUTING");
        addAndMakeVisible(routingLegend_);

        styleControlLabel(inChLabel_, "IN CH");
        addAndMakeVisible(inChLabel_);
        styleCombo(inChCombo_);
        // 17 items map 1:1 onto inputChannel's [0, 16] range — item index
        // 0 = OMNI (raw 0), index n = channel n (raw n). See JUCE's
        // ComboBoxParameterAttachment::setValue: index =
        // round(normalised * (numItems-1)), so numItems-1 must equal the
        // parameter's max - min for the mapping to be bit-exact.
        inChCombo_.addItem("OMNI", 1);
        for (int i = 1; i <= 16; ++i)
            inChCombo_.addItem(juce::String(i), i + 1);
        inChAtt_ = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
            p.apvts, pid::inputChannel, inChCombo_);
        addAndMakeVisible(inChCombo_);

        // Display group — keyboard range slider. Range syncs from APVTS
        // (host preset / undo); the RangeSlider's onChanged_ callback keeps
        // rangeValueLabel_ ("C3 - B5") in sync with the slider drag.
        styleLegend(displayLegend_, "DISPLAY");
        addAndMakeVisible(displayLegend_);
        styleControlLabel(rangeLabel_, "RANGE");
        addAndMakeVisible(rangeLabel_);
        rangeValueLabel_.setFont(theme::dataFont(theme::fsMd));
        rangeValueLabel_.setColour(juce::Label::textColourId, theme::fg.withAlpha(0.7f));
        rangeValueLabel_.setJustificationType(juce::Justification::centredRight);
        addAndMakeVisible(rangeValueLabel_);
        rangeSlider_ = std::make_unique<RangeSlider>(
            p.apvts, pid::kbdRangeLoNote, pid::kbdRangeHiNote,
            [this]{ syncRangeValueLabel(); });
        rangeSlider_->setColour(juce::Slider::trackColourId,     theme::olive.withAlpha(0.6f));
        rangeSlider_->setColour(juce::Slider::backgroundColourId, theme::lzBorder);
        rangeSlider_->setColour(juce::Slider::thumbColourId,     theme::olive);
        addAndMakeVisible(*rangeSlider_);
        syncRangeValueLabel();

        // ── Listeners ─────────────────────────────────────────────
        processor_.apvts.addParameterListener(pid::mode, this);
        processor_.apvts.state.addListener(this);
    }

    ControlsView::~ControlsView()
    {
        processor_.apvts.state.removeListener(this);
        processor_.apvts.removeParameterListener(pid::mode, this);
    }

    std::vector<juce::Button*> ControlsView::getModeButtonsForTest()
    {
        std::vector<juce::Button*> out;
        for (auto& p : pills_) out.push_back(p.get());
        return out;
    }

    juce::Button& ControlsView::getAddHarmonyButtonForTest()
    {
        return addHarmonyBtn_;
    }

    int ControlsView::getHarmonyBadgeCountForTest() const
    {
        return static_cast<int>(badges_.size());
    }

    int ControlsView::getHarmonyBadgeSelectedIdForTest(int idx) const
    {
        if (idx < 0 || idx >= (int) badges_.size()) return -1;
        return badges_[(std::size_t) idx]->getComboForTest().getSelectedId();
    }

    juce::ComboBox* ControlsView::getHarmonyBadgeComboForTest(int idx)
    {
        if (idx < 0 || idx >= (int) badges_.size()) return nullptr;
        return &badges_[(std::size_t) idx]->getComboForTest();
    }

    void ControlsView::onModePillClicked(int idx)
    {
        if (auto* p = processor_.apvts.getParameter(pid::mode))
            p->setValueNotifyingHost(p->convertTo0to1(static_cast<float>(idx)));
        // syncModeHighlights() will be re-invoked through parameterChanged.
        syncModeHighlights();
    }

    void ControlsView::onAddHarmonyClicked()
    {
        auto voices = processor_.getHarmonyVoices();
        if ((int) voices.size() >= kHarmonyVoicesMax) return;
        voices.push_back({3, HarmonyDirection::Above});
        processor_.setHarmonyVoices(std::move(voices));
        // rebuildHarmonyBadges() comes via valueTreeChildAdded → callAsync.
        // The prior direct call destroyed-and-recreated badge subcomponents
        // before the async rebuild ran the same destroy-recreate again, so
        // every add/remove fired two rebuilds. Async-only avoids the
        // duplicate teardown.
    }

    void ControlsView::onRemoveHarmonyClicked(int idx)
    {
        auto voices = processor_.getHarmonyVoices();
        if (idx < 0 || idx >= (int) voices.size()) return;
        voices.erase(voices.begin() + idx);
        processor_.setHarmonyVoices(std::move(voices));
        // See onAddHarmonyClicked: rebuild via the async listener path only.
    }

    void ControlsView::onHarmonyVoiceEdited(int idx, HarmonyVoice v)
    {
        auto voices = processor_.getHarmonyVoices();
        if (idx < 0 || idx >= (int) voices.size()) return;
        voices[(std::size_t) idx] = v;
        processor_.setHarmonyVoices(std::move(voices));
    }

    void ControlsView::rebuildHarmonyBadges()
    {
        badges_.clear();
        const auto& voices = processor_.getHarmonyVoices();
        for (int i = 0; i < (int) voices.size(); ++i)
        {
            auto badge = std::make_unique<HarmonyBadge>(
                i, voices[(std::size_t) i],
                [this](int j, HarmonyVoice v){ onHarmonyVoiceEdited(j, v); },
                [this](int j){ onRemoveHarmonyClicked(j); });
            addAndMakeVisible(*badge);
            badges_.push_back(std::move(badge));
        }
        addHarmonyBtn_.setEnabled((int) voices.size() < kHarmonyVoicesMax);
        layoutHarmonyArea(harmonyAreaBounds_);
        repaint();
    }

    void ControlsView::syncModeHighlights()
    {
        const int active = static_cast<int>(
            processor_.apvts.getRawParameterValue(pid::mode)->load());
        for (std::size_t i = 0; i < pills_.size(); ++i)
            pills_[i]->setActiveState(static_cast<int>(i) == active);
        modeDesc_.setText(modeDescriptionFor(static_cast<ModeChoice>(active)),
                          juce::dontSendNotification);
    }

    void ControlsView::parameterChanged(const juce::String& id, float)
    {
        if (id == pid::mode)
        {
            juce::MessageManager::callAsync(
                [safeThis = juce::Component::SafePointer<ControlsView>(this)]
                {
                    if (auto* self = safeThis.getComponent()) self->syncModeHighlights();
                });
        }
    }

    int ControlsView::loadIntParam(const char* id) const
    {
        return static_cast<int>(processor_.apvts.getRawParameterValue(id)->load());
    }

    namespace
    {
        // MIDI pitch → "Name<octave>" using octave-1 convention so MIDI 60
        // reads "C4" (Yamaha / Logic / most modern hosts). Inboil and the
        // m4l engine use the same convention.
        juce::String midiNoteToText(int midi)
        {
            static constexpr std::array<const char*, 12> kNames =
                {"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
            const int pc  = ((midi % 12) + 12) % 12;
            const int oct = midi / 12 - 1;
            return juce::String(kNames[(std::size_t) pc]) + juce::String(oct);
        }
    }

    void ControlsView::syncRangeValueLabel()
    {
        const int lo = loadIntParam(pid::kbdRangeLoNote);
        const int hi = loadIntParam(pid::kbdRangeHiNote);
        rangeValueLabel_.setText(midiNoteToText(lo) + " - " + midiNoteToText(hi),
                                 juce::dontSendNotification);
    }

    juce::Slider& ControlsView::getRangeSliderForTest()
    {
        return *rangeSlider_;
    }

    void ControlsView::valueTreeChildAdded(juce::ValueTree&, juce::ValueTree&)
    {
        juce::MessageManager::callAsync(
            [safeThis = juce::Component::SafePointer<ControlsView>(this)]
            {
                if (auto* self = safeThis.getComponent()) self->rebuildHarmonyBadges();
            });
    }

    void ControlsView::valueTreeChildRemoved(juce::ValueTree&, juce::ValueTree&, int)
    {
        juce::MessageManager::callAsync(
            [safeThis = juce::Component::SafePointer<ControlsView>(this)]
            {
                if (auto* self = safeThis.getComponent()) self->rebuildHarmonyBadges();
            });
    }

    void ControlsView::valueTreeRedirected(juce::ValueTree&)
    {
        juce::MessageManager::callAsync(
            [safeThis = juce::Component::SafePointer<ControlsView>(this)]
            {
                if (auto* self = safeThis.getComponent()) self->rebuildHarmonyBadges();
            });
    }

    void ControlsView::paint(juce::Graphics& g)
    {
        g.fillAll(theme::bg);
        g.setColour(theme::lzBorder);
        g.drawLine(0.0f, 0.0f, 0.0f, (float) getHeight(), 1.0f);
    }

    void ControlsView::layoutHarmonyArea(juce::Rectangle<int> area)
    {
        if (area.isEmpty()) return;
        const int badgeH = theme::rowHeight;
        const int pillW  = 28;
        const int gap    = theme::rowGap;

        // Vertical stack — one badge per row at full width. The earlier
        // horizontal layout could only fit two badges in the right rail at
        // the max-3 configuration; the third broke `bw < 60` and dropped
        // off. Stacking is also the more legible affordance for "what did
        // I select" since each badge gets the full rail width.
        auto cursor = area;
        for (auto& b : badges_)
        {
            if (cursor.getHeight() < badgeH) break;
            auto row = cursor.removeFromTop(badgeH);
            b->setBounds(row);
            cursor.removeFromTop(gap);
        }
        // Add button sits right-aligned on the next free row. When the cap
        // is hit (voices == max), there's no free row left — hide the
        // button entirely instead of parking a 0×0 component (the layout
        // sanity test asserts no visible component has zero size).
        if (cursor.getHeight() >= badgeH)
        {
            auto row = cursor.removeFromTop(badgeH);
            addHarmonyBtn_.setBounds(row.removeFromRight(pillW));
            addHarmonyBtn_.setVisible(true);
        }
        else
        {
            addHarmonyBtn_.setVisible(false);
        }
    }

    void ControlsView::resized()
    {
        const int pad = theme::railPad;
        auto bounds = getLocalBounds().reduced(pad, pad);

        const int legendH    = (int) theme::fsSm + 4;
        const int row        = theme::rowHeight;
        const int gap        = theme::rowGap;
        const int groupGap   = theme::groupGap;
        const int labelW     = 56;

        auto placeRow = [&](juce::Rectangle<int>& area)
        {
            return area.removeFromTop(row);
        };

        // ── Scale group ─────────────────────────────────────────────
        scaleLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            // No SCALE row label — see ControlsView ctor. Reserve the same
            // labelW gutter as ROOT so the two combos still line up.
            auto r1 = placeRow(bounds);
            r1.removeFromLeft(labelW);
            scaleCombo_.setBounds(r1);
            bounds.removeFromTop(gap);
            auto r2 = placeRow(bounds);
            rootLabel_.setBounds(r2.removeFromLeft(labelW));
            rootCombo_.setBounds(r2);
        }
        bounds.removeFromTop(groupGap);

        // ── Mode group ──────────────────────────────────────────────
        modeLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            auto pillsRow = placeRow(bounds);
            const int pillW = (pillsRow.getWidth() - gap * 2) / 3;
            for (auto& p : pills_)
            {
                p->setBounds(pillsRow.removeFromLeft(pillW));
                pillsRow.removeFromLeft(gap);
            }
            bounds.removeFromTop(gap);
            modeDesc_.setBounds(bounds.removeFromTop(legendH));
        }
        bounds.removeFromTop(groupGap);

        // ── Harmony group ───────────────────────────────────────────
        // Always reserve kHarmonyVoicesMax rows so the layout stays stable
        // as voices are added/removed. The add button shares a row with
        // the last-occupied badge slot, so the worst case (3 badges OR
        // 2 badges + add) is exactly kHarmonyVoicesMax rows.
        harmonyLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            const int harmonyRows  = kHarmonyVoicesMax;
            const int harmonyAreaH = harmonyRows * row + (harmonyRows - 1) * gap;
            auto area = bounds.removeFromTop(harmonyAreaH);
            harmonyAreaBounds_ = area;
            layoutHarmonyArea(area);
        }
        bounds.removeFromTop(groupGap);

        // ── Humanize group (Phase 5: 2 sliders) ─────────────────────
        humanizeLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        const std::array<std::pair<juce::Label*, juce::Slider*>, 2> humSliders = {{
            {&feelLabel_,  &feelSlider_},
            {&driftLabel_, &driftSlider_},
        }};
        for (auto& [lbl, s] : humSliders)
        {
            auto r = placeRow(bounds);
            lbl->setBounds(r.removeFromLeft(labelW));
            s  ->setBounds(r);
            bounds.removeFromTop(gap);
        }
        bounds.removeFromTop(groupGap - gap);

        // ── Routing group (Phase 5: IN CH only) ─────────────────────
        routingLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            auto r = placeRow(bounds);
            inChLabel_.setBounds(r.removeFromLeft(labelW));
            inChCombo_.setBounds(r);
            bounds.removeFromTop(gap);
        }
        bounds.removeFromTop(groupGap);

        // ── Display group ──────────────────────────────────────────
        displayLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            auto r = placeRow(bounds);
            rangeLabel_.setBounds(r.removeFromLeft(labelW));
            // Value label fixed-width on the right; slider fills the gap.
            constexpr int valueW = 64;
            rangeValueLabel_.setBounds(r.removeFromRight(valueW));
            if (rangeSlider_ != nullptr) rangeSlider_->setBounds(r);
        }
    }
}
