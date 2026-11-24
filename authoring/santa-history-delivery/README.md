# Santa History Delivery

Maintained native artwork and animation source for an additive New Year scene.
These JSON and SVG files are edited directly. Chat owns the generic player,
history geometry binding, inert row copy and restoration; it does not generate
Santa's artwork or choreography.

## Story and variants

Santa D carries a gift sack as he descends the left edge of visible conversation rows (mirrored in RTL). A row gives way; he catches
himself, recovers and reaches the bottom. He leaves three presents, attempts to
climb back up, calls for help and departs in a sleigh pulled by two reindeer.
The complete story lasts 27 seconds. With no eligible history, the same story
uses a rope running in from beyond the top of the visible window beside the composer. The rope remains visible throughout
the descent and Santa grips it instead of stepping on drawn history cards. Reduced motion or insufficient
space selects a safe static poster; if even that would obstruct the composer,
Chat shows only the festive notification.

| File | Purpose |
| --- | --- |
| `santa-history-delivery.full.desktop.lottie.json` | Complete desktop variant, 510 × 442 |
| `santa-history-delivery.full.mobile.lottie.json` | Complete mobile/rope-fallback variant |
| `santa-history-delivery.desktop.lottie.json` | Accepted 12-second desktop descent/catch study |
| `santa-history-delivery.mobile.lottie.json` | Accepted 12-second mobile descent/catch study |
| `santa-history-delivery.poster.svg` | Static rope-and-sack fallback |
| `scene.json` | Unpublished descriptor, English label and stable source asset IDs |
| `source-inventory.json` | Source byte counts, SHA-256 values and dimensions |
| `desktop-compact-report.json` | 85% desktop spatial adjustment and preserved timing/topology |

The full desktop was reduced spatially to 85% to clear the real 1280 × 800 Chat
composer. Timing, easing, character proportions, colors and the story remain
unchanged. The later artwork revision adds a simple shoulder sack with a gold
tie and visible present, and keeps the head upright in neutral poses; brief
reaction tilts stay within 5 degrees. The sack follows the same body transform
through the catch, gifts and sleigh departure.

The viewport-travel revision uses a fixed-scale entrance from beyond the inline-start
edge (left in LTR), easing to a complete stop at 21.8 seconds. Santa boards before
the shared 23.8–26.2 second accelerating departure through the inline-end edge. The sleigh,
reindeer and seated Santa retain their size and opacity until fully offscreen.
This horizontal route clears history-header controls during departure. Authored reference
points keep the grips just inside the left border of real 16 px-inset rows and keep
the gift/boarding beat inside the screen. The copied row moves slightly inward
before rotating, then returns exactly to its original position.
The native `hl-track:flight` shares viewport references with the actor on departure;
`hl-flight-bounds` encloses the vehicle and rider. `hl:edge-start` selects the row
support/copy pivot. A strict `hl-if:drawn:top-line:row-0` slot extends the rope to
the real window top instead of leaving its tip suspended inside the stage.
The checker validates these optional additions; earlier assets retain their pivot.

Current SHA-256 identities are recorded in `source-inventory.json`. Chat's
preview fixtures must contain these exact bytes.

## Validate

From the Themes repository root:

```sh
node authoring/santa-history-delivery/check.mjs
node --test scripts/check-celebration-packs.test.mjs
```

The first command packages the complete variants and poster into a temporary
catalog, computes hashed asset names and manifest metadata, runs the publication
checker and removes the temporary catalog. It does not generate animation or
write to `static/celebrations`. The shorter studies are retained as visual review
sources, not included in the complete-scene descriptor.

## Integration status

This scene requires `interaction-history-ladder-v1` on a `viewport-stage-v1`
placement. The corresponding generic Chat adapter was implemented in
`add-new-year-santa-chimney`, archived on 2026-11-24 after user acceptance of the
revised animation (the change retained its original name after the chimney story
was replaced). This directory and validator support do not imply
that a released Chat supports the capability.

Publication into the ordinary New Year pack remains a separate release step:
complete the pack-retention prerequisite and runtime acceptance, then prepare a
new immutable version containing the existing scenes plus Santa. Existing
published versions and defaults remain unchanged. The local Chat preview uses
an ignored catalog overlay. The compiled New Year event routes an admitted
`santa-history-delivery` to the existing `happy new year` secret pool; a gift click
never selects Santa. The existing click and secret scenes remain available.
