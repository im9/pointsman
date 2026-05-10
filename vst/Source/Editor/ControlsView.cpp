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
                case ModeChoice::Scale:   return "snap to nearest scale degree";
                case ModeChoice::Chord:   return "snap to chord tones";
                case ModeChoice::Harmony: return "add parallel diatonic voices";
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

    // ── Harmony badge (interval combo + direction combo + remove button) ──
    class HarmonyBadge : public juce::Component
    {
    public:
        HarmonyBadge(int idx, HarmonyVoice initial,
                     std::function<void(int, HarmonyVoice)> onEdit,
                     std::function<void(int)> onRemove)
            : idx_(idx), onEdit_(std::move(onEdit)), onRemove_(std::move(onRemove))
        {
            for (int iv : kHarmonyIntervals)
            {
                static constexpr std::array<const char*, 4> labels = {"3rd","4th","5th","6th"};
                intervalCombo_.addItem(labels[(std::size_t) (iv - 3)], iv);
            }
            intervalCombo_.setSelectedId(initial.interval, juce::dontSendNotification);
            styleCombo(intervalCombo_);
            intervalCombo_.onChange = [this]{ emit(); };
            addAndMakeVisible(intervalCombo_);

            directionCombo_.addItem("above", 1);
            directionCombo_.addItem("below", 2);
            directionCombo_.setSelectedId(
                initial.direction == HarmonyDirection::Above ? 1 : 2,
                juce::dontSendNotification);
            styleCombo(directionCombo_);
            directionCombo_.onChange = [this]{ emit(); };
            addAndMakeVisible(directionCombo_);

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
            const int half = r.getWidth() / 2;
            intervalCombo_.setBounds(r.removeFromLeft(half));
            directionCombo_.setBounds(r);
        }

    private:
        void emit()
        {
            HarmonyVoice v{};
            v.interval = intervalCombo_.getSelectedId();
            if (v.interval == 0) v.interval = 3;
            v.direction = directionCombo_.getSelectedId() == 2
                ? HarmonyDirection::Below
                : HarmonyDirection::Above;
            if (onEdit_) onEdit_(idx_, v);
        }

        int idx_;
        std::function<void(int, HarmonyVoice)> onEdit_;
        std::function<void(int)>               onRemove_;
        juce::ComboBox  intervalCombo_, directionCombo_;
        juce::TextButton removeBtn_ {"x"};
    };

    // ── ControlsView ──────────────────────────────────────────────────
    ControlsView::ControlsView(PointsmanProcessor& p)
        : processor_(p),
          scaleAtt_  (p.apvts, pid::scale,            scaleCombo_),
          rootAtt_   (p.apvts, pid::root,             rootCombo_),
          velAtt_    (p.apvts, pid::humanizeVelocity, velSlider_),
          gateAtt_   (p.apvts, pid::humanizeGate,     gateSlider_),
          timingAtt_ (p.apvts, pid::humanizeTiming,   timingSlider_),
          driftAtt_  (p.apvts, pid::humanizeDrift,    driftSlider_),
          outAtt_    (p.apvts, pid::outputLevel,      outSlider_),
          inChAtt_   (p.apvts, pid::inputChannel,     inChSlider_),
          ctlChAtt_  (p.apvts, pid::controlChannel,   ctlChSlider_),
          seedAtt_   (p.apvts, pid::seed,             seedSlider_),
          triggerAtt_(p.apvts, pid::triggerMode,      triggerCombo_)
    {
        // Scale group
        styleLegend(scaleLegend_, "SCALE");
        addAndMakeVisible(scaleLegend_);
        styleControlLabel(scaleLabel_, "SCALE");
        addAndMakeVisible(scaleLabel_);
        styleCombo(scaleCombo_);
        for (std::size_t i = 0; i < kScaleChoiceLabels.size(); ++i)
            scaleCombo_.addItem(kScaleChoiceLabels[i], static_cast<int>(i + 1));
        addAndMakeVisible(scaleCombo_);

        styleControlLabel(rootLabel_, "ROOT");
        addAndMakeVisible(rootLabel_);
        styleCombo(rootCombo_);
        for (int i = 0; i < 12; ++i)
            rootCombo_.addItem(kNoteNames[(std::size_t) i], i + 1);
        addAndMakeVisible(rootCombo_);

        // Mode group
        styleLegend(modeLegend_, "MODE");
        addAndMakeVisible(modeLegend_);
        const std::array<juce::String, 3> pillNames {"SCALE", "CHORD", "HARMONY"};
        for (std::size_t i = 0; i < 3; ++i)
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

        // Humanize group
        styleLegend(humanizeLegend_, "HUMANIZE");
        addAndMakeVisible(humanizeLegend_);
        struct SS { juce::Label* lbl; juce::Slider* s; const char* text; };
        const std::array<SS, 5> sliders = {{
            {&velLabel_,    &velSlider_,    "VEL"},
            {&gateLabel_,   &gateSlider_,   "GATE"},
            {&timingLabel_, &timingSlider_, "TIM"},
            {&driftLabel_,  &driftSlider_,  "DRFT"},
            {&outLabel_,    &outSlider_,    "OUT"},
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

        // Routing group
        styleLegend(routingLegend_, "ROUTING");
        addAndMakeVisible(routingLegend_);

        styleControlLabel(inChLabel_, "IN CH");
        addAndMakeVisible(inChLabel_);
        styleSlider(inChSlider_, juce::Slider::IncDecButtons);
        // 0 = omni; show "0" when omni rather than introducing a separate
        // ComboBox for one special value.
        inChSlider_.setRange(0.0, 16.0, 1.0);
        inChSlider_.setNumDecimalPlacesToDisplay(0);
        inChSlider_.textFromValueFunction = [](double v){
            const int n = static_cast<int>(v);
            return n == 0 ? juce::String("OMNI") : juce::String(n);
        };
        inChSlider_.updateText();
        addAndMakeVisible(inChSlider_);

        styleControlLabel(ctlChLabel_, "CTL CH");
        addAndMakeVisible(ctlChLabel_);
        styleSlider(ctlChSlider_, juce::Slider::IncDecButtons);
        ctlChSlider_.setRange(1.0, 16.0, 1.0);
        ctlChSlider_.setNumDecimalPlacesToDisplay(0);
        addAndMakeVisible(ctlChSlider_);

        styleControlLabel(trigLabel_, "TRIG");
        addAndMakeVisible(trigLabel_);
        styleCombo(triggerCombo_);
        for (std::size_t i = 0; i < kTriggerModeChoiceLabels.size(); ++i)
            triggerCombo_.addItem(kTriggerModeChoiceLabels[i], static_cast<int>(i + 1));
        addAndMakeVisible(triggerCombo_);

        styleControlLabel(seedLabel_, "SEED");
        addAndMakeVisible(seedLabel_);
        styleSlider(seedSlider_, juce::Slider::IncDecButtons);
        seedSlider_.setRange(0.0, (double) 0xffffff, 1.0);
        seedSlider_.setNumDecimalPlacesToDisplay(0);
        seedSlider_.setIncDecButtonsMode(juce::Slider::incDecButtonsDraggable_AutoDirection);
        addAndMakeVisible(seedSlider_);

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
        rebuildHarmonyBadges();
    }

    void ControlsView::onRemoveHarmonyClicked(int idx)
    {
        auto voices = processor_.getHarmonyVoices();
        if (idx < 0 || idx >= (int) voices.size()) return;
        voices.erase(voices.begin() + idx);
        processor_.setHarmonyVoices(std::move(voices));
        rebuildHarmonyBadges();
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
        layoutHarmonyRow(harmonyRowBounds_);
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

    namespace
    {
        // Paint a 1px border around a group's outer rect for the inboil
        // fieldset feel. Called from resized() via direct geometry — no
        // separate group-component is worth introducing here.
        struct GroupSlot
        {
            juce::Rectangle<int> bounds;
        };
    }

    void ControlsView::layoutHarmonyRow(juce::Rectangle<int> row)
    {
        if (row.isEmpty()) return;
        const int badgeH = theme::rowHeight;
        const int pillW  = 28;
        const int gap    = 4;

        int x = row.getX();
        const int y = row.getY();

        for (auto& b : badges_)
        {
            const int bw = std::min(120, row.getRight() - x - pillW - gap);
            if (bw < 60) break;
            b->setBounds(x, y, bw, badgeH);
            x += bw + gap;
        }
        addHarmonyBtn_.setBounds(x, y, pillW, badgeH);
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
            auto r1 = placeRow(bounds);
            scaleLabel_.setBounds(r1.removeFromLeft(labelW));
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
        harmonyLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            auto r = placeRow(bounds);
            harmonyRowBounds_ = r;
            layoutHarmonyRow(r);
        }
        bounds.removeFromTop(groupGap);

        // ── Humanize group ──────────────────────────────────────────
        humanizeLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        const std::array<std::pair<juce::Label*, juce::Slider*>, 5> humSliders = {{
            {&velLabel_,    &velSlider_},
            {&gateLabel_,   &gateSlider_},
            {&timingLabel_, &timingSlider_},
            {&driftLabel_,  &driftSlider_},
            {&outLabel_,    &outSlider_},
        }};
        for (auto& [lbl, s] : humSliders)
        {
            auto r = placeRow(bounds);
            lbl->setBounds(r.removeFromLeft(labelW));
            s  ->setBounds(r);
            bounds.removeFromTop(gap);
        }
        bounds.removeFromTop(groupGap - gap);

        // ── Routing group ───────────────────────────────────────────
        routingLegend_.setBounds(bounds.removeFromTop(legendH));
        bounds.removeFromTop(2);
        {
            auto r = placeRow(bounds);
            inChLabel_.setBounds(r.removeFromLeft(labelW));
            inChSlider_.setBounds(r);
            bounds.removeFromTop(gap);
        }
        {
            auto r = placeRow(bounds);
            ctlChLabel_.setBounds(r.removeFromLeft(labelW));
            ctlChSlider_.setBounds(r);
            bounds.removeFromTop(gap);
        }
        {
            auto r = placeRow(bounds);
            trigLabel_.setBounds(r.removeFromLeft(labelW));
            triggerCombo_.setBounds(r);
            bounds.removeFromTop(gap);
        }
        {
            auto r = placeRow(bounds);
            seedLabel_.setBounds(r.removeFromLeft(labelW));
            seedSlider_.setBounds(r);
        }
    }
}
