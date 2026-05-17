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
        "rect": [
            80,
            80,
            1400,
            820
        ],
        "bglocked": 0,
        "openinpresentation": 1,
        "devicewidth": 1000,
        "default_fontsize": 9,
        "default_fontface": 0,
        "default_fontname": "Andale Mono",
        "gridonopen": 1,
        "gridsize": [
            8,
            8
        ],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "boxes": [
            {
                "box": {
                    "id": "obj-thisdevice",
                    "maxclass": "newobj",
                    "text": "live.thisdevice",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        100,
                        102,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-loadbang",
                    "maxclass": "newobj",
                    "text": "loadbang",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        "bang"
                    ],
                    "patching_rect": [
                        40,
                        130,
                        65,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-getid",
                    "maxclass": "message",
                    "text": "getid",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        160,
                        50,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-livepath",
                    "maxclass": "newobj",
                    "text": "live.path live_set",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        190,
                        120,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-liveobs",
                    "maxclass": "newobj",
                    "text": "live.observer is_playing",
                    "numinlets": 2,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        220,
                        160,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-sel-playing",
                    "maxclass": "newobj",
                    "text": "sel 0 1",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        250,
                        50,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-tstart",
                    "maxclass": "message",
                    "text": "transportStart",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        110,
                        280,
                        110,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-tstop",
                    "maxclass": "message",
                    "text": "transportStop",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        280,
                        110,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-panic-btn",
                    "maxclass": "live.text",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        "bang"
                    ],
                    "text": "PANIC",
                    "fontname": "Andale Mono",
                    "fontsize": 8,
                    "patching_rect": [
                        240,
                        100,
                        60,
                        16
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-panic",
                    "maxclass": "message",
                    "text": "panic",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        240,
                        130,
                        50,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-midiin",
                    "maxclass": "newobj",
                    "text": "midiin",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        "int"
                    ],
                    "patching_rect": [
                        340,
                        100,
                        45,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-midiparse",
                    "maxclass": "newobj",
                    "text": "midiparse",
                    "numinlets": 1,
                    "numoutlets": 7,
                    "outlettype": [
                        "",
                        "",
                        "",
                        "int",
                        "int",
                        "int",
                        "int"
                    ],
                    "patching_rect": [
                        340,
                        130,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-unpack-mp",
                    "maxclass": "newobj",
                    "text": "unpack 0 0",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "int",
                        "int"
                    ],
                    "patching_rect": [
                        340,
                        160,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-pak-noteargs",
                    "maxclass": "newobj",
                    "text": "pak 0 0 0",
                    "numinlets": 3,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        340,
                        190,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-if-noteinout",
                    "maxclass": "newobj",
                    "text": "if $i2 > 0 then noteIn $i1 $i2 $i3 else noteOff $i1 $i3",
                    "numinlets": 3,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        340,
                        220,
                        380,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-nodescript",
                    "maxclass": "newobj",
                    "text": "node.script pointsman.mjs @autostart 1",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        360,
                        420,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-print-from-node",
                    "maxclass": "newobj",
                    "text": "print pointsman-from-node",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [
                        40,
                        390,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-route-out",
                    "maxclass": "newobj",
                    "text": "route note ready scaleChanged notePulse",
                    "numinlets": 1,
                    "numoutlets": 6,
                    "outlettype": [
                        "",
                        "",
                        "",
                        "",
                        "",
                        ""
                    ],
                    "patching_rect": [
                        240,
                        390,
                        360,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-trig-ready",
                    "maxclass": "newobj",
                    "text": "t b",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        "bang"
                    ],
                    "patching_rect": [
                        340,
                        450,
                        40,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-unpack-note",
                    "maxclass": "newobj",
                    "text": "unpack 0 0 0",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "int",
                        "int",
                        "int"
                    ],
                    "patching_rect": [
                        240,
                        420,
                        100,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-noteout",
                    "maxclass": "newobj",
                    "text": "noteout",
                    "numinlets": 3,
                    "numoutlets": 0,
                    "patching_rect": [
                        240,
                        480,
                        60,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-defer-sc",
                    "maxclass": "newobj",
                    "text": "deferlow",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        400,
                        420,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-defer-np",
                    "maxclass": "newobj",
                    "text": "deferlow",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        520,
                        420,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-prep-sc",
                    "maxclass": "newobj",
                    "text": "prepend scaleChanged",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        400,
                        450,
                        140,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-prep-np",
                    "maxclass": "newobj",
                    "text": "prepend notePulse",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        520,
                        450,
                        120,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-route-setroot",
                    "maxclass": "newobj",
                    "text": "route setRoot",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "",
                        ""
                    ],
                    "patching_rect": [
                        344,
                        200,
                        100,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-jsui",
                    "maxclass": "jsui",
                    "filename": "scaleKeyboard.jsui.js",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "parameter_enable": 0,
                    "patching_rect": [
                        344,
                        32,
                        416,
                        132
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        308,
                        32,
                        416,
                        132
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-lbl-scale",
                    "maxclass": "comment",
                    "text": "SCALE",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "fontname": "Andale Mono",
                    "fontsize": 9,
                    "textcolor": [
                        0.929,
                        0.91,
                        0.863,
                        0.85
                    ],
                    "patching_rect": [
                        970,
                        60,
                        60,
                        14
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        8,
                        48,
                        14
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-scale",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        970,
                        60,
                        200,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        24,
                        140,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "major",
                                "minor",
                                "dorian",
                                "phrygian",
                                "lydian",
                                "mixolydian",
                                "locrian",
                                "pentatonic",
                                "minor-pentatonic",
                                "blues",
                                "harmonic",
                                "melodic",
                                "whole",
                                "chromatic",
                                "chromatic-half"
                            ],
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanScale",
                            "parameter_shortname": "Scl",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-scale",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14",
                    "numinlets": 1,
                    "numoutlets": 16,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        60,
                        280,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-major",
                    "maxclass": "message",
                    "text": "setParam scale major",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        90,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-minor",
                    "maxclass": "message",
                    "text": "setParam scale minor",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        120,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-dorian",
                    "maxclass": "message",
                    "text": "setParam scale dorian",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        150,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-phrygian",
                    "maxclass": "message",
                    "text": "setParam scale phrygian",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        180,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-lydian",
                    "maxclass": "message",
                    "text": "setParam scale lydian",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        210,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-mixolydian",
                    "maxclass": "message",
                    "text": "setParam scale mixolydian",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        240,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-locrian",
                    "maxclass": "message",
                    "text": "setParam scale locrian",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        270,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-pentatonic",
                    "maxclass": "message",
                    "text": "setParam scale pentatonic",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        300,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-minor-pentatonic",
                    "maxclass": "message",
                    "text": "setParam scale minor-pentatonic",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        330,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-blues",
                    "maxclass": "message",
                    "text": "setParam scale blues",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        360,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-harmonic",
                    "maxclass": "message",
                    "text": "setParam scale harmonic",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        390,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-melodic",
                    "maxclass": "message",
                    "text": "setParam scale melodic",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        420,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-whole",
                    "maxclass": "message",
                    "text": "setParam scale whole",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        450,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-chromatic",
                    "maxclass": "message",
                    "text": "setParam scale chromatic",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        480,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-scale-chromatic-half",
                    "maxclass": "message",
                    "text": "setParam scale chromatic-half",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        510,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-lbl-root",
                    "maxclass": "comment",
                    "text": "ROOT",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "fontname": "Andale Mono",
                    "fontsize": 9,
                    "textcolor": [
                        0.929,
                        0.91,
                        0.863,
                        0.85
                    ],
                    "patching_rect": [
                        970,
                        90,
                        60,
                        14
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        176,
                        8,
                        32,
                        14
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-root",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        970,
                        90,
                        60,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        176,
                        24,
                        56,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "C",
                                "C#",
                                "D",
                                "D#",
                                "E",
                                "F",
                                "F#",
                                "G",
                                "G#",
                                "A",
                                "A#",
                                "B"
                            ],
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanRoot",
                            "parameter_shortname": "Root",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-prep-root",
                    "maxclass": "newobj",
                    "text": "prepend setParam root",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1100,
                        90,
                        180,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-lbl-mode",
                    "maxclass": "comment",
                    "text": "MODE",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "fontname": "Andale Mono",
                    "fontsize": 9,
                    "textcolor": [
                        0.929,
                        0.91,
                        0.863,
                        0.85
                    ],
                    "patching_rect": [
                        970,
                        540,
                        60,
                        14
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        48,
                        40,
                        14
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-mode",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        970,
                        540,
                        200,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        64,
                        80,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "scale",
                                "chord"
                            ],
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanMode",
                            "parameter_shortname": "Mode",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-mode",
                    "maxclass": "newobj",
                    "text": "sel 0 1",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        540,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-mode-scale",
                    "maxclass": "message",
                    "text": "setParam mode scale",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        570,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-mode-chord",
                    "maxclass": "message",
                    "text": "setParam mode chord",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1180,
                        600,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-sel-mode-harmony",
                    "maxclass": "newobj",
                    "text": "sel 1",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        1450,
                        540,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-voices-hidden-0",
                    "maxclass": "message",
                    "text": "active 1, ignoreclick 0",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1550,
                        540,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-voices-hidden-1",
                    "maxclass": "message",
                    "text": "active 0, ignoreclick 1",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1550,
                        570,
                        80,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-lbl-inputChannel",
                    "maxclass": "comment",
                    "text": "IN-CH",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "fontname": "Andale Mono",
                    "fontsize": 9,
                    "textcolor": [
                        0.929,
                        0.91,
                        0.863,
                        0.85
                    ],
                    "patching_rect": [
                        970,
                        210,
                        60,
                        14
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        756,
                        8,
                        48,
                        14
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-inputChannel",
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        970,
                        210,
                        60,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        756,
                        24,
                        48,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanInputChannel",
                            "parameter_mmax": 16,
                            "parameter_mmin": 0,
                            "parameter_shortname": "InCh",
                            "parameter_type": 1,
                            "parameter_unitstyle": 0
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-prep-inputChannel",
                    "maxclass": "newobj",
                    "text": "prepend setParam inputChannel",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1100,
                        210,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-lbl-seed",
                    "maxclass": "comment",
                    "text": "SEED",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "fontname": "Andale Mono",
                    "fontsize": 9,
                    "textcolor": [
                        0.929,
                        0.91,
                        0.863,
                        0.85
                    ],
                    "patching_rect": [
                        970,
                        390,
                        60,
                        14
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        756,
                        128,
                        40,
                        14
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-seed",
                    "maxclass": "live.numbox",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        970,
                        390,
                        60,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        756,
                        144,
                        160,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_initial": [
                                42
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanSeed",
                            "parameter_mmax": 16777215,
                            "parameter_mmin": 0,
                            "parameter_shortname": "Seed",
                            "parameter_steps": 16777216,
                            "parameter_type": 1,
                            "parameter_unitstyle": 0
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-prep-seed",
                    "maxclass": "newobj",
                    "text": "prepend setParam seed",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1100,
                        390,
                        180,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-harmonyV1Interval",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        40,
                        700,
                        100,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        104,
                        80,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "3rd",
                                "4th",
                                "5th",
                                "6th"
                            ],
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanHarmonyV1Interval",
                            "parameter_shortname": "V1Iv",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-harmonyV1Interval",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2 3",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        730,
                        120,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Interval-3rd",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Interval 3rd",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        760,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Interval-4th",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Interval 4th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        790,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Interval-5th",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Interval 5th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        820,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Interval-6th",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Interval 6th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        850,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-harmonyV1Direction",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        40,
                        880,
                        100,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        108,
                        104,
                        164,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "off",
                                "above",
                                "below"
                            ],
                            "parameter_initial": [
                                1
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanHarmonyV1Direction",
                            "parameter_shortname": "V1Dr",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-harmonyV1Direction",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        40,
                        910,
                        100,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Direction-off",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Direction off",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        940,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Direction-above",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Direction above",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        970,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV1Direction-below",
                    "maxclass": "message",
                    "text": "setParam harmonyV1Direction below",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        40,
                        1000,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-harmonyV2Interval",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        300,
                        700,
                        100,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        124,
                        80,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "3rd",
                                "4th",
                                "5th",
                                "6th"
                            ],
                            "parameter_initial": [
                                2
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanHarmonyV2Interval",
                            "parameter_shortname": "V2Iv",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-harmonyV2Interval",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2 3",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        300,
                        730,
                        120,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Interval-3rd",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Interval 3rd",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        760,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Interval-4th",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Interval 4th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        790,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Interval-5th",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Interval 5th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        820,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Interval-6th",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Interval 6th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        850,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-harmonyV2Direction",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        300,
                        880,
                        100,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        108,
                        124,
                        164,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "off",
                                "above",
                                "below"
                            ],
                            "parameter_initial": [
                                1
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanHarmonyV2Direction",
                            "parameter_shortname": "V2Dr",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-harmonyV2Direction",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        300,
                        910,
                        100,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Direction-off",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Direction off",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        940,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Direction-above",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Direction above",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        970,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV2Direction-below",
                    "maxclass": "message",
                    "text": "setParam harmonyV2Direction below",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        300,
                        1000,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-harmonyV3Interval",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        560,
                        700,
                        100,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        144,
                        80,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "3rd",
                                "4th",
                                "5th",
                                "6th"
                            ],
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanHarmonyV3Interval",
                            "parameter_shortname": "V3Iv",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-harmonyV3Interval",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2 3",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        560,
                        730,
                        120,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Interval-3rd",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Interval 3rd",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        760,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Interval-4th",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Interval 4th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        790,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Interval-5th",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Interval 5th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        820,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Interval-6th",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Interval 6th",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        850,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-harmonyV3Direction",
                    "maxclass": "live.menu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [
                        "",
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        560,
                        880,
                        100,
                        22
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        108,
                        144,
                        164,
                        16
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_enum": [
                                "off",
                                "above",
                                "below"
                            ],
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanHarmonyV3Direction",
                            "parameter_shortname": "V3Dr",
                            "parameter_type": 2
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-sel-harmonyV3Direction",
                    "maxclass": "newobj",
                    "text": "sel 0 1 2",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [
                        "bang",
                        "bang",
                        "bang",
                        ""
                    ],
                    "patching_rect": [
                        560,
                        910,
                        100,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Direction-off",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Direction off",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        940,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Direction-above",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Direction above",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        970,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-msg-harmonyV3Direction-below",
                    "maxclass": "message",
                    "text": "setParam harmonyV3Direction below",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        560,
                        1000,
                        220,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-w-feel",
                    "maxclass": "live.dial",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        970,
                        270,
                        36,
                        52
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        760,
                        64,
                        36,
                        52
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanFeel",
                            "parameter_mmax": 1,
                            "parameter_mmin": 0,
                            "parameter_shortname": "FEEL",
                            "parameter_type": 0,
                            "parameter_unitstyle": 1
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-w-drift",
                    "maxclass": "live.dial",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [
                        "",
                        "float"
                    ],
                    "parameter_enable": 1,
                    "patching_rect": [
                        1020,
                        270,
                        36,
                        52
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        810,
                        64,
                        36,
                        52
                    ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_initial": [
                                0
                            ],
                            "parameter_initial_enable": 1,
                            "parameter_longname": "PointsmanDrift",
                            "parameter_mmax": 1,
                            "parameter_mmin": 0,
                            "parameter_shortname": "DRIFT",
                            "parameter_type": 0,
                            "parameter_unitstyle": 1
                        }
                    }
                }
            },
            {
                "box": {
                    "id": "obj-prep-feel",
                    "maxclass": "newobj",
                    "text": "prepend setParam feel",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1100,
                        270,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-prep-drift",
                    "maxclass": "newobj",
                    "text": "prepend setParam drift",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [
                        ""
                    ],
                    "patching_rect": [
                        1100,
                        300,
                        200,
                        22
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-jsui-sep1",
                    "maxclass": "jsui",
                    "filename": "separator.jsui.js",
                    "border": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [
                        970,
                        240,
                        1,
                        176
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        284,
                        8,
                        1,
                        176
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-jsui-sep2",
                    "maxclass": "jsui",
                    "filename": "separator.jsui.js",
                    "border": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [
                        970,
                        270,
                        1,
                        176
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        744,
                        8,
                        1,
                        176
                    ]
                }
            },
            {
                "box": {
                    "id": "obj-grplbl-voices",
                    "maxclass": "comment",
                    "text": "VOICES",
                    "patching_rect": [
                        970,
                        200,
                        56,
                        14
                    ],
                    "presentation": 1,
                    "presentation_rect": [
                        20,
                        88,
                        56,
                        14
                    ],
                    "fontface": 0,
                    "fontsize": 9,
                    "fontname": "Andale Mono"
                }
            }
        ],
        "lines": [
            {
                "patchline": {
                    "source": [
                        "obj-thisdevice",
                        0
                    ],
                    "destination": [
                        "obj-msg-getid",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-loadbang",
                        0
                    ],
                    "destination": [
                        "obj-msg-getid",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-getid",
                        0
                    ],
                    "destination": [
                        "obj-livepath",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-livepath",
                        0
                    ],
                    "destination": [
                        "obj-liveobs",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-liveobs",
                        0
                    ],
                    "destination": [
                        "obj-sel-playing",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-playing",
                        0
                    ],
                    "destination": [
                        "obj-msg-tstop",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-playing",
                        1
                    ],
                    "destination": [
                        "obj-msg-tstart",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-tstop",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-tstart",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-panic-btn",
                        0
                    ],
                    "destination": [
                        "obj-msg-panic",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-panic",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-midiin",
                        0
                    ],
                    "destination": [
                        "obj-midiparse",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-midiparse",
                        0
                    ],
                    "destination": [
                        "obj-unpack-mp",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-midiparse",
                        4
                    ],
                    "destination": [
                        "obj-pak-noteargs",
                        2
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-unpack-mp",
                        1
                    ],
                    "destination": [
                        "obj-pak-noteargs",
                        1
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-unpack-mp",
                        0
                    ],
                    "destination": [
                        "obj-pak-noteargs",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-pak-noteargs",
                        0
                    ],
                    "destination": [
                        "obj-if-noteinout",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-if-noteinout",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-nodescript",
                        0
                    ],
                    "destination": [
                        "obj-print-from-node",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-nodescript",
                        0
                    ],
                    "destination": [
                        "obj-route-out",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-route-out",
                        0
                    ],
                    "destination": [
                        "obj-unpack-note",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-unpack-note",
                        0
                    ],
                    "destination": [
                        "obj-noteout",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-unpack-note",
                        1
                    ],
                    "destination": [
                        "obj-noteout",
                        1
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-unpack-note",
                        2
                    ],
                    "destination": [
                        "obj-noteout",
                        2
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-route-out",
                        2
                    ],
                    "destination": [
                        "obj-defer-sc",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-defer-sc",
                        0
                    ],
                    "destination": [
                        "obj-prep-sc",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-sc",
                        0
                    ],
                    "destination": [
                        "obj-jsui",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-route-out",
                        3
                    ],
                    "destination": [
                        "obj-defer-np",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-defer-np",
                        0
                    ],
                    "destination": [
                        "obj-prep-np",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-np",
                        0
                    ],
                    "destination": [
                        "obj-jsui",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-jsui",
                        0
                    ],
                    "destination": [
                        "obj-route-setroot",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-route-setroot",
                        0
                    ],
                    "destination": [
                        "obj-w-root",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-scale",
                        0
                    ],
                    "destination": [
                        "obj-sel-scale",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        0
                    ],
                    "destination": [
                        "obj-msg-scale-major",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        1
                    ],
                    "destination": [
                        "obj-msg-scale-minor",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        2
                    ],
                    "destination": [
                        "obj-msg-scale-dorian",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        3
                    ],
                    "destination": [
                        "obj-msg-scale-phrygian",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        4
                    ],
                    "destination": [
                        "obj-msg-scale-lydian",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        5
                    ],
                    "destination": [
                        "obj-msg-scale-mixolydian",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        6
                    ],
                    "destination": [
                        "obj-msg-scale-locrian",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        7
                    ],
                    "destination": [
                        "obj-msg-scale-pentatonic",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        8
                    ],
                    "destination": [
                        "obj-msg-scale-minor-pentatonic",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        9
                    ],
                    "destination": [
                        "obj-msg-scale-blues",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        10
                    ],
                    "destination": [
                        "obj-msg-scale-harmonic",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        11
                    ],
                    "destination": [
                        "obj-msg-scale-melodic",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        12
                    ],
                    "destination": [
                        "obj-msg-scale-whole",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        13
                    ],
                    "destination": [
                        "obj-msg-scale-chromatic",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-scale",
                        14
                    ],
                    "destination": [
                        "obj-msg-scale-chromatic-half",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-major",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-minor",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-dorian",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-phrygian",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-lydian",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-mixolydian",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-locrian",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-pentatonic",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-minor-pentatonic",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-blues",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-harmonic",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-melodic",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-whole",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-chromatic",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-scale-chromatic-half",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-root",
                        0
                    ],
                    "destination": [
                        "obj-prep-root",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-root",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-mode",
                        0
                    ],
                    "destination": [
                        "obj-sel-mode",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-mode",
                        0
                    ],
                    "destination": [
                        "obj-msg-mode-scale",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-mode",
                        1
                    ],
                    "destination": [
                        "obj-msg-mode-chord",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-mode-scale",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-mode-chord",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-inputChannel",
                        0
                    ],
                    "destination": [
                        "obj-prep-inputChannel",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-inputChannel",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-seed",
                        0
                    ],
                    "destination": [
                        "obj-prep-seed",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-seed",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-route-out",
                        1
                    ],
                    "destination": [
                        "obj-trig-ready",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-scale",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-root",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-mode",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-inputChannel",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-seed",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-harmonyV1Interval",
                        0
                    ],
                    "destination": [
                        "obj-sel-harmonyV1Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Interval",
                        0
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Interval-3rd",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Interval",
                        1
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Interval-4th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Interval",
                        2
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Interval-5th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Interval",
                        3
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Interval-6th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Interval-3rd",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Interval-4th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Interval-5th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Interval-6th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-harmonyV1Direction",
                        0
                    ],
                    "destination": [
                        "obj-sel-harmonyV1Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Direction",
                        0
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Direction-off",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Direction",
                        1
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Direction-above",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV1Direction",
                        2
                    ],
                    "destination": [
                        "obj-msg-harmonyV1Direction-below",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Direction-off",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Direction-above",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV1Direction-below",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-harmonyV2Interval",
                        0
                    ],
                    "destination": [
                        "obj-sel-harmonyV2Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Interval",
                        0
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Interval-3rd",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Interval",
                        1
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Interval-4th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Interval",
                        2
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Interval-5th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Interval",
                        3
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Interval-6th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Interval-3rd",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Interval-4th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Interval-5th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Interval-6th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-harmonyV2Direction",
                        0
                    ],
                    "destination": [
                        "obj-sel-harmonyV2Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Direction",
                        0
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Direction-off",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Direction",
                        1
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Direction-above",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV2Direction",
                        2
                    ],
                    "destination": [
                        "obj-msg-harmonyV2Direction-below",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Direction-off",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Direction-above",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV2Direction-below",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-harmonyV3Interval",
                        0
                    ],
                    "destination": [
                        "obj-sel-harmonyV3Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Interval",
                        0
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Interval-3rd",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Interval",
                        1
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Interval-4th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Interval",
                        2
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Interval-5th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Interval",
                        3
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Interval-6th",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Interval-3rd",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Interval-4th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Interval-5th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Interval-6th",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-harmonyV3Direction",
                        0
                    ],
                    "destination": [
                        "obj-sel-harmonyV3Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Direction",
                        0
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Direction-off",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Direction",
                        1
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Direction-above",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-harmonyV3Direction",
                        2
                    ],
                    "destination": [
                        "obj-msg-harmonyV3Direction-below",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Direction-off",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Direction-above",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-harmonyV3Direction-below",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV1Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV1Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV2Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV2Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV3Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV3Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-mode",
                        0
                    ],
                    "destination": [
                        "obj-sel-mode-harmony",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-mode-harmony",
                        0
                    ],
                    "destination": [
                        "obj-msg-voices-hidden-0",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-sel-mode-harmony",
                        1
                    ],
                    "destination": [
                        "obj-msg-voices-hidden-1",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-0",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV1Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-0",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV1Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-0",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV2Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-0",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV2Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-0",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV3Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-0",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV3Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-1",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV1Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-1",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV1Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-1",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV2Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-1",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV2Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-1",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV3Interval",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-msg-voices-hidden-1",
                        0
                    ],
                    "destination": [
                        "obj-w-harmonyV3Direction",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-feel",
                        0
                    ],
                    "destination": [
                        "obj-prep-feel",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-feel",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-w-drift",
                        0
                    ],
                    "destination": [
                        "obj-prep-drift",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-prep-drift",
                        0
                    ],
                    "destination": [
                        "obj-nodescript",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-feel",
                        0
                    ]
                }
            },
            {
                "patchline": {
                    "source": [
                        "obj-trig-ready",
                        0
                    ],
                    "destination": [
                        "obj-w-drift",
                        0
                    ]
                }
            }
        ]
    }
}
