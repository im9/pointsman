{
    "patcher": {
        "fileversion": 1,
        "appversion": {
            "major": 8,
            "minor": 6,
            "revision": 5,
            "architecture": "x64",
            "modernui": 1
        },
        "classnamespace": "box",
        "rect": [80.0, 80.0, 1400.0, 820.0],
        "bglocked": 0,
        "openinpresentation": 1,
        "devicewidth": 1000.0,
        "default_fontsize": 9.0,
        "default_fontface": 0,
        "default_fontname": "Andale Mono",
        "gridonopen": 1,
        "gridsize": [8.0, 8.0],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "boxes": [

            {"box": {"id": "obj-grp-scale", "maxclass": "panel", "bgcolor": [0, 0, 0, 0], "bordercolor": [0.929, 0.910, 0.863, 0.18], "border": 1, "rounded": 0, "numinlets": 1, "numoutlets": 0, "patching_rect": [40.0, 60.0, 200.0, 12.0], "presentation": 1, "presentation_rect": [8.0, 8.0, 280.0, 164.0]}},
            {"box": {"id": "obj-grp-keyboard", "maxclass": "panel", "bgcolor": [0, 0, 0, 0], "bordercolor": [0.929, 0.910, 0.863, 0.18], "border": 1, "rounded": 0, "numinlets": 1, "numoutlets": 0, "patching_rect": [240.0, 60.0, 200.0, 12.0], "presentation": 1, "presentation_rect": [296.0, 8.0, 440.0, 164.0]}},
            {"box": {"id": "obj-grp-human", "maxclass": "panel", "bgcolor": [0, 0, 0, 0], "bordercolor": [0.929, 0.910, 0.863, 0.18], "border": 1, "rounded": 0, "numinlets": 1, "numoutlets": 0, "patching_rect": [440.0, 60.0, 200.0, 12.0], "presentation": 1, "presentation_rect": [744.0, 8.0, 248.0, 164.0]}},

            {"box": {"id": "obj-lgnd-scale", "maxclass": "comment", "text": "SCALE / I/O", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 8.0, "textcolor": [0.471, 0.471, 0.271, 1.0], "patching_rect": [40.0, 60.0, 100.0, 12.0], "presentation": 1, "presentation_rect": [20.0, 14.0, 90.0, 12.0]}},
            {"box": {"id": "obj-lgnd-keyboard", "maxclass": "comment", "text": "KEYBOARD", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 8.0, "textcolor": [0.471, 0.471, 0.271, 1.0], "patching_rect": [240.0, 60.0, 80.0, 12.0], "presentation": 1, "presentation_rect": [308.0, 14.0, 70.0, 12.0]}},
            {"box": {"id": "obj-lgnd-human", "maxclass": "comment", "text": "HUMAN", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 8.0, "textcolor": [0.471, 0.471, 0.271, 1.0], "patching_rect": [440.0, 60.0, 80.0, 12.0], "presentation": 1, "presentation_rect": [756.0, 14.0, 50.0, 12.0]}},

            {"box": {"id": "obj-thisdevice", "maxclass": "newobj", "text": "live.thisdevice", "numinlets": 1, "numoutlets": 3, "outlettype": ["bang", "bang", ""], "patching_rect": [40.0, 100.0, 102.0, 22.0]}},
            {"box": {"id": "obj-loadbang", "maxclass": "newobj", "text": "loadbang", "numinlets": 1, "numoutlets": 1, "outlettype": ["bang"], "patching_rect": [40.0, 130.0, 65.0, 22.0]}},
            {"box": {"id": "obj-msg-getid", "maxclass": "message", "text": "getid", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [40.0, 160.0, 50.0, 22.0]}},
            {"box": {"id": "obj-livepath", "maxclass": "newobj", "text": "live.path live_set", "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", ""], "patching_rect": [40.0, 190.0, 120.0, 22.0]}},
            {"box": {"id": "obj-liveobs", "maxclass": "newobj", "text": "live.observer is_playing", "numinlets": 2, "numoutlets": 3, "outlettype": ["", "", ""], "patching_rect": [40.0, 220.0, 160.0, 22.0]}},

            {"box": {"id": "obj-sel-playing", "maxclass": "newobj", "text": "sel 0 1", "numinlets": 1, "numoutlets": 3, "outlettype": ["bang", "bang", ""], "patching_rect": [40.0, 250.0, 50.0, 22.0]}},
            {"box": {"id": "obj-msg-tstart", "maxclass": "message", "text": "transportStart", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [110.0, 280.0, 110.0, 22.0]}},
            {"box": {"id": "obj-msg-tstop", "maxclass": "message", "text": "transportStop", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [40.0, 280.0, 110.0, 22.0]}},

            {"box": {"id": "obj-panic-btn", "maxclass": "live.text", "numinlets": 1, "numoutlets": 1, "outlettype": ["bang"], "text": "PANIC", "fontname": "Andale Mono", "fontsize": 8.0, "patching_rect": [240.0, 100.0, 60.0, 16.0]}},
            {"box": {"id": "obj-msg-panic", "maxclass": "message", "text": "panic", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [240.0, 130.0, 50.0, 22.0]}},

            {"box": {"id": "obj-midiin", "maxclass": "newobj", "text": "midiin", "numinlets": 1, "numoutlets": 1, "outlettype": ["int"], "patching_rect": [340.0, 100.0, 45.0, 22.0]}},
            {"box": {"id": "obj-midiparse", "maxclass": "newobj", "text": "midiparse", "numinlets": 1, "numoutlets": 7, "outlettype": ["", "", "", "int", "int", "int", "int"], "patching_rect": [340.0, 130.0, 80.0, 22.0]}},
            {"box": {"id": "obj-unpack-mp", "maxclass": "newobj", "text": "unpack 0 0", "numinlets": 1, "numoutlets": 2, "outlettype": ["int", "int"], "patching_rect": [340.0, 160.0, 80.0, 22.0]}},
            {"box": {"id": "obj-pak-noteargs", "maxclass": "newobj", "text": "pak 0 0 0", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [340.0, 190.0, 80.0, 22.0]}},
            {"box": {"id": "obj-if-noteinout", "maxclass": "newobj", "text": "if $i2 > 0 then noteIn $i1 $i2 $i3 else noteOff $i1 $i3", "numinlets": 3, "numoutlets": 1, "outlettype": [""], "patching_rect": [340.0, 220.0, 380.0, 22.0]}},

            {"box": {"id": "obj-nodescript", "maxclass": "newobj", "text": "node.script stencil-qt.mjs @autostart 1", "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""], "patching_rect": [40.0, 360.0, 420.0, 22.0]}},
            {"box": {"id": "obj-print-from-node", "maxclass": "newobj", "text": "print stencil-qt-from-node", "numinlets": 1, "numoutlets": 0, "patching_rect": [40.0, 390.0, 200.0, 22.0]}},

            {"box": {"id": "obj-route-out", "maxclass": "newobj", "text": "route note ready scaleChanged notePulse", "numinlets": 1, "numoutlets": 5, "outlettype": ["", "", "", "", ""], "patching_rect": [240.0, 390.0, 280.0, 22.0]}},
            {"box": {"id": "obj-trig-ready", "maxclass": "newobj", "text": "t b", "numinlets": 1, "numoutlets": 1, "outlettype": ["bang"], "patching_rect": [340.0, 450.0, 40.0, 22.0]}},
            {"box": {"id": "obj-unpack-note", "maxclass": "newobj", "text": "unpack 0 0 0", "numinlets": 1, "numoutlets": 3, "outlettype": ["int", "int", "int"], "patching_rect": [240.0, 420.0, 100.0, 22.0]}},
            {"box": {"id": "obj-noteout", "maxclass": "newobj", "text": "noteout", "numinlets": 3, "numoutlets": 0, "patching_rect": [240.0, 480.0, 60.0, 22.0]}},
            {"box": {"id": "obj-defer-sc", "maxclass": "newobj", "text": "deferlow", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [400.0, 420.0, 80.0, 22.0]}},
            {"box": {"id": "obj-defer-np", "maxclass": "newobj", "text": "deferlow", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [520.0, 420.0, 80.0, 22.0]}},
            {"box": {"id": "obj-prep-sc", "maxclass": "newobj", "text": "prepend scaleChanged", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [400.0, 450.0, 140.0, 22.0]}},
            {"box": {"id": "obj-prep-np", "maxclass": "newobj", "text": "prepend notePulse", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [520.0, 450.0, 120.0, 22.0]}},

            {"box": {"id": "obj-jsui", "maxclass": "jsui", "filename": "scaleKeyboard.jsui.js", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "parameter_enable": 0, "patching_rect": [344.0, 32.0, 416.0, 132.0], "presentation": 1, "presentation_rect": [308.0, 32.0, 416.0, 132.0]}},


            {"box": {"id": "obj-lbl-scale", "maxclass": "comment", "text": "SCL", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 9.0, "textcolor": [0.929, 0.910, 0.863, 0.85], "patching_rect": [970.0, 60.0, 60.0, 14.0], "presentation": 1, "presentation_rect": [20.0, 34.0, 40.0, 14.0]}},
            {"box": {"id": "obj-w-scale", "maxclass": "live.menu", "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", "float"], "parameter_enable": 1, "patching_rect": [970.0, 60.0, 200.0, 22.0], "presentation": 1, "presentation_rect": [72.0, 32.0, 200.0, 16.0], "saved_attribute_attributes": {"valueof": {"parameter_enum": ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "pentatonic", "minor-pentatonic", "blues", "harmonic", "melodic", "whole", "chromatic", "chromatic-half"], "parameter_initial": [0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtScale", "parameter_shortname": "Scl", "parameter_type": 2}}}},
            {"box": {"id": "obj-sel-scale", "maxclass": "newobj", "text": "sel 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14", "numinlets": 1, "numoutlets": 16, "outlettype": ["bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", "bang", ""], "patching_rect": [1180.0, 60.0, 280.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-major", "maxclass": "message", "text": "setParam scale major", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 90.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-minor", "maxclass": "message", "text": "setParam scale minor", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 120.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-dorian", "maxclass": "message", "text": "setParam scale dorian", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 150.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-phrygian", "maxclass": "message", "text": "setParam scale phrygian", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 180.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-lydian", "maxclass": "message", "text": "setParam scale lydian", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 210.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-mixolydian", "maxclass": "message", "text": "setParam scale mixolydian", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 240.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-locrian", "maxclass": "message", "text": "setParam scale locrian", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 270.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-pentatonic", "maxclass": "message", "text": "setParam scale pentatonic", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 300.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-minor-pentatonic", "maxclass": "message", "text": "setParam scale minor-pentatonic", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 330.0, 220.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-blues", "maxclass": "message", "text": "setParam scale blues", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 360.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-harmonic", "maxclass": "message", "text": "setParam scale harmonic", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 390.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-melodic", "maxclass": "message", "text": "setParam scale melodic", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 420.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-whole", "maxclass": "message", "text": "setParam scale whole", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 450.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-chromatic", "maxclass": "message", "text": "setParam scale chromatic", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 480.0, 200.0, 22.0]}},
            {"box": {"id": "obj-msg-scale-chromatic-half", "maxclass": "message", "text": "setParam scale chromatic-half", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 510.0, 220.0, 22.0]}},

            {"box": {"id": "obj-lbl-root", "maxclass": "comment", "text": "ROOT", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 9.0, "textcolor": [0.929, 0.910, 0.863, 0.85], "patching_rect": [970.0, 90.0, 60.0, 14.0], "presentation": 1, "presentation_rect": [20.0, 58.0, 32.0, 14.0]}},
            {"box": {"id": "obj-w-root", "maxclass": "live.menu", "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", "float"], "parameter_enable": 1, "patching_rect": [970.0, 90.0, 60.0, 22.0], "presentation": 1, "presentation_rect": [56.0, 56.0, 56.0, 16.0], "saved_attribute_attributes": {"valueof": {"parameter_enum": ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], "parameter_initial": [0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtRoot", "parameter_shortname": "Root", "parameter_type": 2}}}},
            {"box": {"id": "obj-prep-root", "maxclass": "newobj", "text": "prepend setParam root", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 90.0, 180.0, 22.0]}},

            {"box": {"id": "obj-w-outputLevel", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 150.0, 36.0, 52.0], "presentation": 1, "presentation_rect": [122.0, 110.0, 36.0, 52.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [1.0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtOutputLevel", "parameter_mmax": 1.0, "parameter_mmin": 0.0, "parameter_shortname": "LVL", "parameter_type": 0, "parameter_unitstyle": 1}}}},
            {"box": {"id": "obj-prep-outputLevel", "maxclass": "newobj", "text": "prepend setParam outputLevel", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 150.0, 200.0, 22.0]}},

            {"box": {"id": "obj-lbl-triggerMode", "maxclass": "comment", "text": "TRG", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 9.0, "textcolor": [0.929, 0.910, 0.863, 0.85], "patching_rect": [970.0, 180.0, 60.0, 14.0], "presentation": 1, "presentation_rect": [20.0, 84.0, 40.0, 14.0]}},
            {"box": {"id": "obj-w-triggerMode", "maxclass": "live.menu", "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", "float"], "parameter_enable": 1, "patching_rect": [970.0, 180.0, 200.0, 22.0], "presentation": 1, "presentation_rect": [72.0, 82.0, 200.0, 16.0], "saved_attribute_attributes": {"valueof": {"parameter_enum": ["passthrough", "root"], "parameter_initial": [0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtTriggerMode", "parameter_shortname": "Trig", "parameter_type": 2}}}},
            {"box": {"id": "obj-sel-triggerMode", "maxclass": "newobj", "text": "sel 0 1", "numinlets": 1, "numoutlets": 3, "outlettype": ["bang", "bang", ""], "patching_rect": [1180.0, 180.0, 60.0, 22.0]}},
            {"box": {"id": "obj-msg-triggerMode-passthrough", "maxclass": "message", "text": "setParam triggerMode passthrough", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 210.0, 220.0, 22.0]}},
            {"box": {"id": "obj-msg-triggerMode-root", "maxclass": "message", "text": "setParam triggerMode root", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [1180.0, 240.0, 200.0, 22.0]}},

            {"box": {"id": "obj-lbl-inputChannel", "maxclass": "comment", "text": "IN", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 9.0, "textcolor": [0.929, 0.910, 0.863, 0.85], "patching_rect": [970.0, 210.0, 60.0, 14.0], "presentation": 1, "presentation_rect": [116.0, 58.0, 16.0, 14.0]}},
            {"box": {"id": "obj-w-inputChannel", "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 210.0, 60.0, 22.0], "presentation": 1, "presentation_rect": [136.0, 56.0, 48.0, 16.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtInputChannel", "parameter_mmax": 16.0, "parameter_mmin": 0.0, "parameter_shortname": "InCh", "parameter_type": 1, "parameter_unitstyle": 0}}}},
            {"box": {"id": "obj-prep-inputChannel", "maxclass": "newobj", "text": "prepend setParam inputChannel", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 210.0, 200.0, 22.0]}},

            {"box": {"id": "obj-lbl-controlChannel", "maxclass": "comment", "text": "CTL", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 9.0, "textcolor": [0.929, 0.910, 0.863, 0.85], "patching_rect": [970.0, 240.0, 60.0, 14.0], "presentation": 1, "presentation_rect": [196.0, 58.0, 22.0, 14.0]}},
            {"box": {"id": "obj-w-controlChannel", "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 240.0, 60.0, 22.0], "presentation": 1, "presentation_rect": [222.0, 56.0, 48.0, 16.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [16], "parameter_initial_enable": 1, "parameter_longname": "StencilQtControlChannel", "parameter_mmax": 16.0, "parameter_mmin": 1.0, "parameter_shortname": "CtlCh", "parameter_type": 1, "parameter_unitstyle": 0}}}},
            {"box": {"id": "obj-prep-controlChannel", "maxclass": "newobj", "text": "prepend setParam controlChannel", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 240.0, 220.0, 22.0]}},

            {"box": {"id": "obj-w-humanizeVelocity", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 270.0, 36.0, 52.0], "presentation": 1, "presentation_rect": [760.0, 44.0, 36.0, 52.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [0.0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtHumanizeVelocity", "parameter_mmax": 1.0, "parameter_mmin": 0.0, "parameter_shortname": "VEL", "parameter_type": 0, "parameter_unitstyle": 1}}}},
            {"box": {"id": "obj-prep-humanizeVelocity", "maxclass": "newobj", "text": "prepend setParam humanizeVelocity", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 270.0, 240.0, 22.0]}},

            {"box": {"id": "obj-w-humanizeGate", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 300.0, 36.0, 52.0], "presentation": 1, "presentation_rect": [816.0, 44.0, 36.0, 52.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [0.0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtHumanizeGate", "parameter_mmax": 1.0, "parameter_mmin": 0.0, "parameter_shortname": "GATE", "parameter_type": 0, "parameter_unitstyle": 1}}}},
            {"box": {"id": "obj-prep-humanizeGate", "maxclass": "newobj", "text": "prepend setParam humanizeGate", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 300.0, 220.0, 22.0]}},

            {"box": {"id": "obj-w-humanizeTiming", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 330.0, 36.0, 52.0], "presentation": 1, "presentation_rect": [872.0, 44.0, 36.0, 52.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [0.0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtHumanizeTiming", "parameter_mmax": 1.0, "parameter_mmin": 0.0, "parameter_shortname": "TIME", "parameter_type": 0, "parameter_unitstyle": 1}}}},
            {"box": {"id": "obj-prep-humanizeTiming", "maxclass": "newobj", "text": "prepend setParam humanizeTiming", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 330.0, 220.0, 22.0]}},

            {"box": {"id": "obj-w-humanizeDrift", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 360.0, 36.0, 52.0], "presentation": 1, "presentation_rect": [928.0, 44.0, 36.0, 52.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [0.0], "parameter_initial_enable": 1, "parameter_longname": "StencilQtHumanizeDrift", "parameter_mmax": 1.0, "parameter_mmin": 0.0, "parameter_shortname": "DRIFT", "parameter_type": 0, "parameter_unitstyle": 1}}}},
            {"box": {"id": "obj-prep-humanizeDrift", "maxclass": "newobj", "text": "prepend setParam humanizeDrift", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 360.0, 220.0, 22.0]}},

            {"box": {"id": "obj-lbl-seed", "maxclass": "comment", "text": "SEED", "numinlets": 1, "numoutlets": 0, "fontname": "Andale Mono", "fontsize": 9.0, "textcolor": [0.929, 0.910, 0.863, 0.85], "patching_rect": [970.0, 390.0, 60.0, 14.0], "presentation": 1, "presentation_rect": [756.0, 122.0, 40.0, 14.0]}},
            {"box": {"id": "obj-w-seed", "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"], "parameter_enable": 1, "patching_rect": [970.0, 390.0, 60.0, 22.0], "presentation": 1, "presentation_rect": [808.0, 120.0, 160.0, 16.0], "saved_attribute_attributes": {"valueof": {"parameter_initial": [42], "parameter_initial_enable": 1, "parameter_longname": "StencilQtSeed", "parameter_mmax": 2147483647.0, "parameter_mmin": 0.0, "parameter_shortname": "Seed", "parameter_steps": 2147483648, "parameter_type": 1, "parameter_unitstyle": 0}}}},
            {"box": {"id": "obj-prep-seed", "maxclass": "newobj", "text": "prepend setParam seed", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [1100.0, 390.0, 180.0, 22.0]}}

        ],
        "lines": [

            {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-getid", 0]}},
            {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-getid", 0]}},
            {"patchline": {"source": ["obj-msg-getid", 0], "destination": ["obj-livepath", 0]}},
            {"patchline": {"source": ["obj-livepath", 0], "destination": ["obj-liveobs", 0]}},

            {"patchline": {"source": ["obj-liveobs", 0], "destination": ["obj-sel-playing", 0]}},
            {"patchline": {"source": ["obj-sel-playing", 0], "destination": ["obj-msg-tstop", 0]}},
            {"patchline": {"source": ["obj-sel-playing", 1], "destination": ["obj-msg-tstart", 0]}},
            {"patchline": {"source": ["obj-msg-tstop", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-tstart", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-panic-btn", 0], "destination": ["obj-msg-panic", 0]}},
            {"patchline": {"source": ["obj-msg-panic", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-midiin", 0], "destination": ["obj-midiparse", 0]}},
            {"patchline": {"source": ["obj-midiparse", 0], "destination": ["obj-unpack-mp", 0]}},
            {"patchline": {"source": ["obj-midiparse", 4], "destination": ["obj-pak-noteargs", 2]}},
            {"patchline": {"source": ["obj-unpack-mp", 1], "destination": ["obj-pak-noteargs", 1]}},
            {"patchline": {"source": ["obj-unpack-mp", 0], "destination": ["obj-pak-noteargs", 0]}},
            {"patchline": {"source": ["obj-pak-noteargs", 0], "destination": ["obj-if-noteinout", 0]}},
            {"patchline": {"source": ["obj-if-noteinout", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-nodescript", 0], "destination": ["obj-print-from-node", 0]}},
            {"patchline": {"source": ["obj-nodescript", 0], "destination": ["obj-route-out", 0]}},

            {"patchline": {"source": ["obj-route-out", 0], "destination": ["obj-unpack-note", 0]}},
            {"patchline": {"source": ["obj-unpack-note", 0], "destination": ["obj-noteout", 0]}},
            {"patchline": {"source": ["obj-unpack-note", 1], "destination": ["obj-noteout", 1]}},
            {"patchline": {"source": ["obj-unpack-note", 2], "destination": ["obj-noteout", 2]}},

            {"patchline": {"source": ["obj-route-out", 2], "destination": ["obj-defer-sc", 0]}},
            {"patchline": {"source": ["obj-defer-sc", 0], "destination": ["obj-prep-sc", 0]}},
            {"patchline": {"source": ["obj-prep-sc", 0], "destination": ["obj-jsui", 0]}},
            {"patchline": {"source": ["obj-route-out", 3], "destination": ["obj-defer-np", 0]}},
            {"patchline": {"source": ["obj-defer-np", 0], "destination": ["obj-prep-np", 0]}},
            {"patchline": {"source": ["obj-prep-np", 0], "destination": ["obj-jsui", 0]}},

            {"patchline": {"source": ["obj-w-scale", 0], "destination": ["obj-sel-scale", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 0], "destination": ["obj-msg-scale-major", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 1], "destination": ["obj-msg-scale-minor", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 2], "destination": ["obj-msg-scale-dorian", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 3], "destination": ["obj-msg-scale-phrygian", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 4], "destination": ["obj-msg-scale-lydian", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 5], "destination": ["obj-msg-scale-mixolydian", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 6], "destination": ["obj-msg-scale-locrian", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 7], "destination": ["obj-msg-scale-pentatonic", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 8], "destination": ["obj-msg-scale-minor-pentatonic", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 9], "destination": ["obj-msg-scale-blues", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 10], "destination": ["obj-msg-scale-harmonic", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 11], "destination": ["obj-msg-scale-melodic", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 12], "destination": ["obj-msg-scale-whole", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 13], "destination": ["obj-msg-scale-chromatic", 0]}},
            {"patchline": {"source": ["obj-sel-scale", 14], "destination": ["obj-msg-scale-chromatic-half", 0]}},
            {"patchline": {"source": ["obj-msg-scale-major", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-minor", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-dorian", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-phrygian", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-lydian", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-mixolydian", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-locrian", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-pentatonic", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-minor-pentatonic", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-blues", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-harmonic", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-melodic", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-whole", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-chromatic", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-scale-chromatic-half", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-root", 0], "destination": ["obj-prep-root", 0]}},
            {"patchline": {"source": ["obj-prep-root", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-outputLevel", 0], "destination": ["obj-prep-outputLevel", 0]}},
            {"patchline": {"source": ["obj-prep-outputLevel", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-triggerMode", 0], "destination": ["obj-sel-triggerMode", 0]}},
            {"patchline": {"source": ["obj-sel-triggerMode", 0], "destination": ["obj-msg-triggerMode-passthrough", 0]}},
            {"patchline": {"source": ["obj-sel-triggerMode", 1], "destination": ["obj-msg-triggerMode-root", 0]}},
            {"patchline": {"source": ["obj-msg-triggerMode-passthrough", 0], "destination": ["obj-nodescript", 0]}},
            {"patchline": {"source": ["obj-msg-triggerMode-root", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-inputChannel", 0], "destination": ["obj-prep-inputChannel", 0]}},
            {"patchline": {"source": ["obj-prep-inputChannel", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-controlChannel", 0], "destination": ["obj-prep-controlChannel", 0]}},
            {"patchline": {"source": ["obj-prep-controlChannel", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-humanizeVelocity", 0], "destination": ["obj-prep-humanizeVelocity", 0]}},
            {"patchline": {"source": ["obj-prep-humanizeVelocity", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-humanizeGate", 0], "destination": ["obj-prep-humanizeGate", 0]}},
            {"patchline": {"source": ["obj-prep-humanizeGate", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-humanizeTiming", 0], "destination": ["obj-prep-humanizeTiming", 0]}},
            {"patchline": {"source": ["obj-prep-humanizeTiming", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-humanizeDrift", 0], "destination": ["obj-prep-humanizeDrift", 0]}},
            {"patchline": {"source": ["obj-prep-humanizeDrift", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-w-seed", 0], "destination": ["obj-prep-seed", 0]}},
            {"patchline": {"source": ["obj-prep-seed", 0], "destination": ["obj-nodescript", 0]}},

            {"patchline": {"source": ["obj-route-out", 1], "destination": ["obj-trig-ready", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-scale", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-root", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-outputLevel", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-triggerMode", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-inputChannel", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-controlChannel", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-humanizeVelocity", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-humanizeGate", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-humanizeTiming", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-humanizeDrift", 0]}},
            {"patchline": {"source": ["obj-trig-ready", 0], "destination": ["obj-w-seed", 0]}}

        ]
    }
}
