Pointsman — Scale quantizer MIDI effect
im9


About
-----

Pointsman snaps incoming MIDI notes to the nearest pitch in a user-
selected scale, with optional chord mode (single note becomes a
diatonic voice stack) and a per-event humanize layer. Snap is always
nearest (ties round down).

Named after Edward Pointsman from Thomas Pynchon's Gravity's Rainbow
— the railway-pointsman metaphor (routing an incoming train onto a
discrete track) is exact for what a quantizer does: routing input
pitch to a discrete scale degree.

Full musical model: docs/ai/concept.md in the source repository
(https://github.com/im9/pointsman).


Parameters
----------

  scale          enum (15)    scale preset; default major
  root           0..11        root pitch class; default 0 (C)
  mode           scale|chord  output strategy; default scale
  harmonyVoices  0..3 voices  diatonic voice stack emitted in chord
                              mode; each voice is (interval, dir)
                              with interval in {3,4,5,6}. Default
                              is [{3 above}, {5 above}] — a 1-3-5
                              triad, so chord mode ships as
                              "single note becomes a chord".
  feel           0..1         humanize amount across velocity /
                              gate / timing; default 0
  drift          0..1         EMA smoothing for humanize axes;
                              default 0
  inputChannel   0..16        MIDI input channel; 0 = omni
  seed           int          RNG seed for humanize draws.
                              Persisted in plugin state but not
                              exposed in the editor. New instances
                              pick a random seed; preset save /
                              load is bit-exact.


Scales (v1)
-----------

major, minor, dorian, phrygian, lydian, mixolydian, locrian,
pentatonic, minor-pentatonic, blues, harmonic, melodic, whole,
chromatic, chromatic-half.

`chromatic-half` is a no-op identity for passthrough within the
device chain.


License
-------

Proprietary, im9. Personal non-commercial use is permitted for
binaries built from source. Redistribution and commercial use require
written permission. See vst/LICENSE in the source repository:
https://github.com/im9/pointsman/blob/main/vst/LICENSE
