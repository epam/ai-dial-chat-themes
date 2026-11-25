# Snow Circus

A 26-second New Year scene: a penguin removes two buttons, coats them in snow and juggles with a third ball. A snowman intercepts one and hits the penguin's cap. Return shots enlarge the snowman's belly. He raises an oversized ball and buries himself; impact spray reaches the penguin and leaves a snow moustache, then the snowman emerges head-first. Both return the buttons and leave together.

The native `snow-circus.desktop.lottie.json`, `snow-circus.mobile.lottie.json` and `snow-circus.poster.svg` are the maintained source. They were seeded once, then revised by rendered contact/pose inspection. No generator ships or runs on activation. Edit native shapes/keys directly, preserve the contact grammar, and create a new immutable version for later releases. The desktop and mobile art is currently byte-identical; the host scales it uniformly and borrows at most one prop on mobile. The mobile staging retains both characters and every joke.

`scene.json` pins the candidate descriptor. `source-inventory.json` records bytes, hashes and structural costs; `node authoring/snow-circus/check.mjs` checks source/pack identity and the tighter scene budget. The full publication checker remains `node scripts/check-celebration-packs.mjs`, with regression tests `node --test scripts/check-celebration-packs.test.mjs`.

## Contact contract

Requires the new Chat capability `interaction-button-props-v1`, `composer-anchor-v1` and direction `none`. The identity `bp-stage` null carries all artwork. `bp-reference:0/1` declare authored centers; `bp-weight:0/1` opacity tracks declare linear contact weights, totaling at most 100. Direct-child `bp-prop:0/1` nulls contain position/opacity tracks on the same bounded clock (at most 128 keys per track). `bp:entry:N` and `bp:restore:N` markers require a prop at its reference, weight 100; each original has its own restore time. Optional `bp-drawn:N` layers are only removed when that prop is copied. Child art has explicit opacity because Lottie null-layer opacity does not hide descendants.

The paired `bp-bounds:min` / `bp-bounds:max` identity nulls have zero opacity and static positions `[90,160,0]` / `[392,350,0]`. This padded envelope contains the visible native artwork throughout contact motion; the host rejects targets whose translation would move it outside the viewport. Recheck the envelope when changing artwork or poses. Absence falls back to the complete composition rectangle; malformed or incomplete bounds reject playback before borrowing. The new nulls change no shape or choreography and remain within the existing 48-layer budget.

Keep flipper endpoints at pickup/return contacts, broad silhouettes, and the 0.6-second hat reaction. Art uses navy/cream, red fabric, teal accessories and blue-shadowed snow. No filters, masks, bitmap embeds, fonts or scripts. Scene limits: 48 layers, 2500 keys, 160 paths/1000 vertices, 500 generated SVG nodes, 512 KiB animation JSON and 30 KiB poster; two characters, three small balls, one large ball, eight impact flecks and one player.

## Local preview and evidence

Chat's `New Year/Snow Circus` Storybook stories render these bytes through production `LottieScene`, including mobile, RTL and missing-target alternatives. Reduced motion renders the poster without copies. The browser target is `npm exec -- nx run @epam/ai-dial-celebrations:test-snow-circus-browser` from Chat. It checks restoration and interruption, captures actual-size poses and profiles full mobile playback. Structural tests, pose inspection, continuous artistic review and deployment evidence are distinct; a recorded video alone does not establish artistic acceptance.

## Standard New Year pack and rollout

`new-year-default@1.5.1` adds `snow-circus` to all five scenes from the updated
`development` pack `1.4.0` (base commit `e596746`). The catalog selects this
standard pack. Existing scene descriptors, labels and asset bytes are preserved,
including Santa and the polar bears. Draft standalone packs are retained only
under `preview-history`; they are not entries in the served catalog.

After compatible Chat and Themes releases, append `new-year/snow-circus` to
`UI_EVENT_EXTERNAL_SCENES` (or the managed `ui.celebrationDelivery.externalScenes`
list), preserve existing entries, retain `UI_EVENT=new-year` and
`UI_EVENT_DELIVERY_MODE=prefer-external`, change `UI_EVENT_DELIVERY_REVISION`,
and reload clients. See the root README for managed-key activation. This scene
joins the `happy new year` secret pool alongside gift wrapping, reindeer takeoff
and Santa. Ordinary gift clicks exclude Snow Circus and Santa. Use a Chat build
with this secret-scene routing as well as the button-props adapter.

Rollback removes only this allowlist entry or selects retained standard pack
`1.4.0` with a new catalog revision. The new capability belongs to the scene,
not the pack: older clients omit it and retain supported scenes. These are
locally prepared changes, not evidence of remote publication or deployment.

## Character revision (1.0.1)

Both characters follow the existing SnowmanDelivery / polar-bear graphic language: thin ink contours, white forms with broad blue crescent shadows and compact faces. The snowman has three snowballs, a burgundy scarf and blue mittens; the penguin uses a connected pear silhouette, white bib, muted cap and coherent flipper shading. The plot, shared contact tracks and exit keys are retained. The static poster uses the same native contours. Version 1.0.0 remains retained. Actual-size desktop/mobile and dark-background frames were inspected; continuous artistic acceptance is not inferred from screenshots.

## Smaller cast and penguin refinement (1.0.2)

The entire authored action, including reference points, props and effects, is scaled to 75% about the support point (260, 300). Actual UI copies keep their normal size and retargeted contacts. Penguin coat/wing shading and facial features are simpler and softer, matching the other winter characters. Snowman contours remain byte-for-byte identical to 1.0.1. The poster reflects the smaller cast; existing versions are retained.

## Clear oversized-snowball ending (1.0.3)

Preparation, a supported two-handed lift, held wind-up, release, impact pause and head-first recovery are distinct beats. Mittens follow the lower snowball rim while carried and render in front of it. Three bounded snow clumps connect the impact to the penguin's moustache; the detached surprise mitten is removed. The penguin watches from a distance and holds its reaction. Cast size, illustration style, button-return keys and the 26-second duration are retained.

The never-published 1.0.0 draft is retained byte-for-byte under `preview-history/1.0.0`, outside the served catalog. The other standalone drafts are also retained under `preview-history`; the served catalog uses the standard pack. No released asset was deleted.

## Review corrections in the unpublished standard candidate

The 1.5.1 candidate now contains the two native bounds nulls. Existing shapes,
poses and animation keys are unchanged. The inventory records 35 layers and
145,363 bytes per variant. Published 1.2.0–1.4.0 resources remain unchanged.
Chat filters safe controls before pair ranking and validates contact placement
against this envelope; a phone's edge button may use drawn snow instead.

The never-published 1.5.0 preview was replaced by 1.5.1 after local browsers cached its original immutable manifest. Even local preview edits now require a new version once consumed. The new manifest URL avoids stale asset IDs; catalog and delivery revisions alone do not invalidate a cached immutable manifest. Published 1.2.0–1.4.0 are retained unchanged.
