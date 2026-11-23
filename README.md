<h1 align="center">
         DIAL Chat Themes
    </h1>
    <p align="center">
        <p align="center">
        <a href="https://dialx.ai/">
          <img src="https://dialx.ai/logo/dialx_logo.svg" alt="About DIALX">
        </a>
    </p>
<h4 align="center">
    <a href="https://discord.gg/ukzj9U9tEe">
        <img src="https://img.shields.io/static/v1?label=DIALX%20Community%20on&message=Discord&color=blue&logo=Discord&style=flat-square" alt="Discord">
    </a>
</h4>

- [Overview](#overview)
- [OTEL Integration](#otel-integration)
- [Set Up Developer Environment](#set-up-developer-environment)
  - [Build](#build)
  - [Run](#run)
- [Helm Deployment and Configuration](#helm-deployment-and-configuration)
- [Working with Themes](#working-with-themes)
  - [Add Theme](#add-theme)
  - [Customize Image URLs](#customize-image-urls)
  - [Customize Theme Colors](#customize-theme-colors)
  - [Colors for the Sign in Page (authColors)](#colors-for-the-sign-in-page-authcolors)
  - [Customizing Banner Images (banners)](#customizing-banner-images-banners)
- [Celebration Packs](#celebration-packs)
  - [Layout](#layout)
  - [Composer-carry scenes](#composer-carry-scenes)
  - [Check](#check)
  - [Publish a Pack Version](#publish-a-pack-version)
  - [Caching](#caching)
  - [Retention](#retention)

## Overview

> [!NOTE]
> A theme is a collection of static resources including images, fonts, and color palettes that you can utilize to personalize the appearance of your [AI DIAL Chat](https://github.com/epam/ai-dial-chat) application. These resources can be stored anywhere and accessed by the chat application via the internet. We provide the AI DIAL Chat Themes service as a convenient method for hosting these static resources and making them accessible for the chat application(s). However, you have the flexibility to choose your own method for accomplishing this.
>
> This approach, having static resources externally, enables developers and designers to work concurrently and implement changes to themes without having to rebuild the chat application Docker image.

> [!IMPORTANT]
> **Note**: after making changes into themes, it is necessary to restart the chat application to apply changes.

> [!TIP]
> Chat application users can then select themes in [user settings](https://github.com/epam/ai-dial/blob/main/docs/user-guide.md#user-settings).

## OTEL Integration

Added for your Env variables the next variables with the proper values. Trigger a redeploy of your Themes instance.

```bash
  OTEL_EXPORTER_OTLP_ENDPOINT: "<otlp_endpoint_url>" # OTEL endpoint URL
  OTEL_SERVICE_NAME: "<service_name>" # Key-value pairs to be used as resource attributes, default values ai-dial-chat-themes. The value can be overridden if necessary.
```

> [!TIP]
> Refer to the Official [OTLP Exporter Configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/) documentation for more details.

> [!TIP]
> Refer to the DIAL [Observability and Monitoring](https://docs.dialx.ai/tutorials/devops/observability-config) documentation for more details.

> [!TIP]
> Refer to the Official [Module ngx_otel_module](https://nginx.org/en/docs/ngx_otel_module.html#variables) documentation for more details.

## Set Up Developer Environment

The HTTP server is run in Docker container. All you need is to [install the latest Docker engine](https://docs.docker.com/engine/install/).

### Build

Run the `build` command to build a Docker image with the tag `dial-chat-themes:latest`

```bash
make build
```

### Run

Execute this command to run the Docker container available at `http://localhost:8080`:

```bash
make run
```

## Helm Deployment and Configuration

1. You can deploy AI DIAL Chat Themes service using a common [dial](https://github.com/epam/ai-dial-helm/tree/main/charts/dial) Helm chart or using a stand-alone chart [dial-extension](https://github.com/epam/ai-dial-helm/tree/main/charts/dial-extension).

    > [!TIP]
    > Refer to [AI DIAL Helm](https://github.com/epam/ai-dial-helm) to learn about the deployment options and view the examples of charts.

1. In the [config.json](./static/config.json) file, you can define and configure custom themes or use (edit) default ones. Images can be stored in the **static** folder as well. However, you can store images anywhere and provide URLs in the config file.
1. Further, it is necessary to configure AI DIAL Chat to access the static resources and the themes configuration. To do that, add `THEMES_CONFIG_HOST` to the chat configuration - refer to [documentation](https://github.com/epam/ai-dial-chat/blob/development/apps/chat/README.md) for details. `THEMES_CONFIG_HOST` environment variable contains the URL to your nginx server with the configuration and images (this is the case when you use AI DIAL Chat Themes to provide static resources for the chat application). This ensures that the application fetches your configuration file during loading. If the environment variable is not provided, [default themes and model icons]((./static/config.json)) will be applied.
1. After applying changes, it is necessary to redeploy the themes server. Changes will take effect automatically on the chat UI after 24hrs or upon the page reload. All the configured themes will be available in the chat application in [user settings](https://github.com/epam/ai-dial/blob/main/docs/user-guide.md#user-settings).

## Working with Themes

### Add Theme

> [!NOTE]
> In the [config.json](./static/config.json) file you can find two default themes: light☀️ and dark🌒 (default theme).

> [!TIP]
> To declare a new theme, create an object inside the `themes` property and fill all the required fields as shown on the example:

> [!IMPORTANT]
> **Note**: if you create a list of custom themes, the first theme in the `themes` array will be used as a default one for **new** users. For other users, the theme will be fetched from a local storage.

```json
  // defined themes as an array
  "themes": [
    {
      "displayName": "Light",   // Displayed name in settings modal on UI
      "id": "light",            // Some kebab case id name
      "colors": {
        // Semantic colors which commonly used across entire application.
        // See default configuration to check available colors
      },
      "font-family":"Inter" //Font for the theme
    },
    // Other themes
  ],
```

### Customize Image URLs

> [!NOTE]
> You can provide image URLs in the configuration file [config.json](./static/config.json). To achieve this, create the following structure:

```json
{
  "themes": [
    // defined themes as an array
  ],
  "images": {
    // common for all themes image urls
    "default-model": "", //default icon for applications without a custom icon configured
    "default-addon": "", //default icon for addons without a custom icon configured
    
    "admin-logo-light": "", //light theme logo for DIAL Admin
    "admin-logo-dark": "", //dark theme logo for DIAL Admin
    "admin-favicon": "", //favicon for DIAL Admin
    "chat-logo-light": "", //light theme logo for DIAL Chat
    "chat-logo-dark": "", //dark theme logo for DIAL Chat
    "chat-favicon": "", //favicon for DIAL Chat
    "model-garden-logo-light": "", //light appearance logo for Model Garden
    "model-garden-logo-dark": "", //dark appearance logo for Model Garden
    "model-garden-favicon": "", //favicon for Model Garden
    "launchpad-logo-light": "", //light appearance logo for DIAL Launchpad
    "launchpad-logo-dark": "", //dark appearance logo for DIAL Launchpad
    "launchpad-favicon": "", //favicon for DIAL Launchpad
    "user-profile-logo-light": "", //light appearance logo for User Profile
    "user-profile-logo-dark": "", //dark appearance logo for User Profile
    "user-profile-favicon": "", //favicon for User Profile
  }
}
```

> [!IMPORTANT]
> Specify a full path to your images (e.g. `https://some-path.svg`) if you are hosting them at the external source; otherwise, a path will be recognized as a relative URL and transformed into `{{host}}/icon.svg`.

Model Garden uses `model-garden-logo-light` and `model-garden-logo-dark`
for its resolved appearance, including when System follows the operating system.
The supplied SVG files live in `static/`; these optional keys do not change Chat
or Admin branding. Garden loads relative filenames through its BFF theme-image
endpoint and uses its bundled light/dark logos when a key or image is unavailable.
The optional `model-garden-favicon` key specifies the favicon; the supplied SVG
is `static/model-garden-favicon.svg`.

DIAL Launchpad uses `launchpad-logo-dark` only for its `dark` theme, including
when System follows a dark operating system, and `launchpad-logo-light` for
every other theme. The supplied SVG files live in `static/`; these optional keys
do not change Chat, Admin or Model Garden branding. Launchpad loads relative
filenames through its BFF theme-image endpoint and shows its built-in logo when
a key or image is unavailable. The optional `launchpad-favicon` key specifies
the favicon; the supplied SVG is `static/launchpad-favicon.svg`.

User Profile uses `user-profile-logo-dark` for the resolved `dark` theme,
including System with a dark operating system, and `user-profile-logo-light`
for other themes. The SVGs include the product mark and wordmark as outlines,
so they require no external font. Relative filenames load through the BFF
image endpoint; missing or failed logos keep the built-in mark and label.
The `user-profile-favicon` key points to the existing
`static/user-portal-favicon.svg`, also used for Launchpad's User Profile card.
The application keeps its bundled favicon until the configured image loads.

### Customize Theme Colors

> [!NOTE]
> Specify a hex value in colors. Refer to [Hex Color](https://developer.mozilla.org/en-US/docs/Web/CSS/hex-color) for reference.
>
> You can customize color palettes in the `colors` property for each object in the list of `themes`:

> [!IMPORTANT]
> **Note**, in the [config.json](./static/config.json) file you can find default color palettes for both dark and light themes.

```json
{
  "themes": [
    {
      "displayName": "Dark",
      "colors": {...}
    },
    {
      "displayName": "Light",
      "colors": {...}
    }
  ]
}
```

### Colors for the Sign in Page (authColors)

> [!NOTE]
> The `authColors` property allows you to define custom color palettes specifically for the Sign in page. These colors can be used to style login, registration, and other authentication screens.

```json
{
  "themes": [
    {
      "displayName": "Dark",
      "colors": {...}
    },
    "authColors": {
      "bg-auth-layer-0": "#FFFFFF",
      "bg-auth-layer-1": "#EFEFEF"
      }
  ]
}
```

### Customizing Banner Images (banners)

> [!NOTE]
> To customize banner images, you can provide image URLs inside the desired theme object:
>
> 1. Locate or create the `banners` property inside the desired theme object in config.json.
> 1. Update or add values for `my-workspace-banner` and `marketplace-banner` with the relative path or full URL of your custom images.

```json
{
  "themes": [
    {
      "displayName": "Dark",
      "colors": {...}
    },
    "banners":{
      "my-workspace-banner": "welcome-dark-my-apps.jpg",
      "marketplace-banner": "welcome-dark.jpg"
      }
  ]
}
```

## Celebration Packs

> [!NOTE]
> Celebration packs are versioned animations for the seasonal start-page celebrations of [AI DIAL Chat](https://github.com/epam/ai-dial-chat). A pack can replace a scene of an event Chat already compiles by its ID, add a new scene to that event's click pool (such as `new-year/bullfinch-couriers`) or describe a whole event Chat has no code for (such as `company-anniversary`). The Chat deployment allowlists every replaced or added scene. A new pack version reaches Chat without a Chat rebuild.

Packs live under [static/celebrations](./static/celebrations) and never in `config.json`, so theme readers (Chat, Admin, Model Garden) are not affected. Only the DIAL Chat backend reads them, from `<THEMES_CONFIG_URL>/celebrations/`. It verifies every size, SHA-256 and media type before it serves a byte, and the Chat deployment decides whether a pack is used at all (`UI_EVENT_DELIVERY_MODE`, `UI_EVENT_EXTERNAL_SCENES`, `UI_EVENT_EXTERNAL_EVENTS`). The default stays the compiled scenes.

### Layout

```text
static/celebrations/
├── index.json                         # mutable: every published version and the default per event
├── new-year-default/
│   ├── 1.0.0/                         # immutable once published
│   ├── 1.1.0/                         # previous version, kept for rollback
│   └── 1.1.1/
│       ├── manifest.json              # scenes, timing, variants and the declared assets
│       ├── bullfinch-couriers.desktop.<sha256 prefix>.json
│       ├── bullfinch-couriers.mobile.<sha256 prefix>.json
│       ├── bullfinch-couriers.poster.<sha256 prefix>.svg
│       ├── gift-wrapping.desktop.<sha256 prefix>.json
│       ├── gift-wrapping.mobile.<sha256 prefix>.json   # variant with its own placement
│       └── gift-wrapping.poster.<sha256 prefix>.svg
├── halloween-default/
│   └── 1.0.0/
│       ├── manifest.json
│       ├── cat.<sha256 prefix>.json   # one composition for every layout and story
│       └── cat.poster.<sha256 prefix>.svg
├── new-year-polar-bears/
│   └── 1.0.0/                         # optional event; does not replace new-year
│       ├── manifest.json
│       ├── polar-bears.desktop.<sha256 prefix>.json
│       ├── polar-bears.mobile.<sha256 prefix>.json
│       └── polar-bears.poster.<sha256 prefix>.svg
└── company-anniversary/
    └── 1.0.0/
        ├── manifest.json
        ├── confetti.desktop.<sha256 prefix>.json
        ├── confetti.poster.<sha256 prefix>.svg
        └── icon.<sha256 prefix>.svg
```

- `index.json` lists each published version with its manifest `path`, `bytes` and `sha256`, and `defaults` names the version each event uses.
- A manifest declares every file of its version directory with `assetId`, `file`, `mediaType`, `bytes` and `sha256`. File names and asset IDs end with the first 16 hex characters of the file's SHA-256, so a changed file always gets a new name.
- Animations are Lottie JSON for the `lottie_light` SVG player: shape, null and precomp layers only, no text, images, expressions or effects, at most 30 layers, 4,000 keyframes, 8,000 vertices and 512 KiB per file. Posters and icons are static SVG without scripts or external references, at most 100 KiB.

New Year `1.1.1` refines the artwork and staging of both existing scenes. The
bullfinches keep their complete silhouette while turning, and their larger,
raised stage uses transparent headroom to bound enlargement on tablets and wide
screens. The elves have softer face and coat shading, warmer outlines, wider
spacing and a loose ribbon that hangs below the greeting during the handoff.
Both static posters match the updated art. The stories, durations, composer
contacts and required capabilities are unchanged. The JSON and SVG files are
the authored source; publication does not generate them from Chat components.

### Composer-anchored scenes

A scene can attach to the Chat composer instead of the viewport (`composer-anchor-v1`). It is authored around a reference composer, `anchorRect`, in its own stage coordinates. Chat measures the real composer once and scales the whole stage uniformly by `clamp(composerWidth / anchorRect.width, scale.min, scale.max)`, aligning the center and `edge` of `anchorRect` with it. A stage is never stretched, so one composition serves every composer width. With no usable composer, `fallback: "stage-anchor"` plays around a synthetic composer of `anchorRect × scale.min` in the lower half of the viewport, and `fallback: "poster"` shows the poster.

```json
"placement": {
  "template": "composer-anchor-v1",
  "anchor": "composer",
  "anchorRect": { "x": 340, "y": 164, "width": 520, "height": 56 },
  "edge": "top",
  "scale": { "min": 0.6, "max": 1 },
  "fallback": "stage-anchor"
}
```

A variant may override `placement` with its own `anchorRect` and `scale`, keeping the template. The New Year `gift-wrapping` scene uses this: its mobile variant is a 720 × 240 stage authored around a 300 × 56 composer, so on a tablet the elves keep their phone size instead of growing with the wider composer. Each variant's `anchorRect` must lie inside its own composition.

A scene that also requires `interaction-composer-outline-v1` (the New Year `gift-wrapping`) gives Chat two layers to fit, found by their layer name:

- `composer-outline`: exactly one top-level shape layer with an identity transform and exactly one static path. Chat redraws the path around the measured composer, starting at the top center. Its stroke, trim paths and timing stay as authored.
- `composer-parcel` (optional): at most one shape layer with an identity transform and one static rectangle. Chat removes it for a real composer and sizes it to the synthetic composer otherwise.

Everything else in the composition is authored motion and plays as published. Keep the manifest's `requiredCapabilities` to capabilities every supported Chat release has (`lottie-light-svg-v1`, `viewport-stage-v1`, `static-poster-v1`), and list `composer-anchor-v1` and `interaction-composer-outline-v1` on the scene only. A Chat release without them then skips just that scene, keeps its compiled version and still plays the rest of the pack.

### Cat-borrow scenes

A scene that requires `interaction-cat-borrow-v1` (the Halloween `cat`) borrows up to two composer or starter buttons through reversible copies: the cat perches on the composer, pushes each copy off, and the copies fall, land and fade back to the untouched originals. Chat picks one of three authored stories from what it measures — `two-prizes`, `one-prize` or `crossing` when no button is reachable — so one composition serves every layout, writing direction and button order. The scene needs `composer-anchor-v1` placement on the scene and every variant, `direction: "none"` (every side comes from physical geometry), and cannot also require `interaction-composer-outline-v1`. The Halloween pack plays the same file on both layouts and fixes the scale through `scale.min = scale.max` (1 on desktop, 0.8 on mobile).

Chat reads these layers by name and changes nothing else:

- `cat-rig`: exactly one unparented top-level precomposition holding the character, starting at frame 0 in a composition that starts at frame 0, with a static anchor and position, an unanimated 100 % scale and 0° rotation, and no time remap of its own. Chat writes its time remap to select the story and to stretch the reaction to the last borrowed button's fall onto the measured landing.
- `cat-root` (inside `cat-rig`): exactly one unparented null whose position keyframes are the stations. Every keyframe has a numeric start value only and no spatial tangents, and lies inside a `cat:bind:<anchor>` range. Chat moves each keyframe by its authored offset from the `anchor:<anchor>` null to the measured anchor, mirrored when the measured side differs.
- `cat-facing` (inside `cat-rig`, and it may hang below `cat-root`): exactly one null whose x-scale hold keyframes carry the facing. They are stations too: each has a numeric start value only and lies inside a `cat:bind:<anchor>` range, and Chat flips its sign with that anchor's measured side.
- `anchor:<name>` (inside `cat-rig`): one unparented null per bound anchor — `entry-edge`, `perch`, `prize-0`, `prize-1`, `move` or `exit-edge` — whose position is static (`a: 0`) and numeric.
- `prize-0`, `prize-1` (inside `cat-rig`): at most one layer each, the authored track of each borrowed copy. A prize with a `cat:release:<n>` needs a `cat:bind:prize-<n>` range with a `cat-root` keyframe inside it, and a keyframed position, since Chat reads the authored stand and push from them. Position, rotation and opacity share keyframe times and easing (compared as Chat does: missing or straight tangents are linear, curves at four decimals), scale is never animated, and the position has a keyframe at every release.
- `cat-floor` (optional): at most one top-level group with one rectangle and one gradient fill, the glow under grounded copies.

Composition markers starting with `cat:` time the stories: `cat:section:<story>` ranges, each at most once and never overlapping, `cat:branch:one-prize` on the frame of the two-prize story's `cat:release:0` where the one-prize tail leaves it, non-overlapping `cat:bind:<anchor>` ranges, and per prize `cat:entry:<n>`, up to four `cat:contact:<n>`, `cat:release:<n>`, `cat:landing:<n>` and `cat:restore`, in that order. A marker on a shared boundary belongs to the section it opens, and a marker without a duration may not sit on the last frame of the rig.

Every story Chat can choose must carry the markers it reads for that story: `cat:entry:<n>` and `cat:release:<n>` for each borrowed button, the last one's `cat:landing:<n>`, and `cat:restore`. Each entry lies between 1% of the story and `cat:restore`, every `prize-<n>` keyframe up to the release plays in that story, and no story lasts longer than the composition's `op`. Only the last borrowed button's landing is elastic: its optional duration is the range that absorbs the measured fall, so that landing must come after its release, and the range must not cross the step from the two-prize story into the one-prize tail.

Chat rejects the scene before playback — and plays the poster — when any of these rules fails; the check below applies all of them for every story. What depends on the measured page stays a runtime decision: a fall that the elastic range cannot absorb at 0.8–1.25 × speed drops that button from the story, and a page with no reachable button and no `crossing` story, or a copy still falling at `cat:restore`, shows the poster.

### Composer-carry scenes

The optional `new-year-polar-bears` event plays `polar-bears-workshop`: two bears
tie a rope to the composer, try a small joint tug, pause, then pull its inert
copy away with a gradually accelerating second tug. They return the decorated
copy, untie the rope, and leave the lights visible briefly before restoring the
page. Desktop artwork attaches beside the composer; mobile artwork attaches
below its lower corners. The authored Lottie JSON and SVG are the source; no
generator or Chat fixture is needed to publish them.

`interaction-composer-carry-v1` requires `composer-anchor-v1` placement,
`edge: "top"`, `fallback: "poster"`, `direction: "none"`, and no other
`interaction-*` capability. Require the adapter on the scene only. The composition
starts at frame zero and lasts at most 29,750 ms. Chat maps these named null layers:

- `composer-carry`: exactly one unparented, opaque null with an identity transform.
  Its position has 2–64 strictly ordered keyframes `[x, 0, 0]`, with `x` in
  0–1000. The first key is `[0, 0, 0]` at frame zero and the last is the same at
  `op`. Chat maps 1000 to an exit beyond the viewport and applies the same timing
  and easing to the inert composer copy.
- `composer-decoration`: exactly one direct child of the carrier, with an identity
  transform and static position `[0, 0, 0]`. Draw its ornament across a 520-unit
  reference width; Chat fits that width to the measured composer. Its opacity may
  animate.
- `composer-side` (optional): at most one opaque null, with an identity transform,
  directly under the carrier. Its position is static or has 1–64 ordered keys
  `[x, y, 0]`, where `x` in −1–1 spans the measured left/right edges and `y` in
  0–1 spans its top/bottom. Put side actors and their contact rope beneath it.

All top-level artwork must descend from the carrier, with unique layer indices
and no missing or cyclic parents. Travel and side keys contain finite start
values, no end values, no spatial tangents except `[0, 0, 0]`, and only hold 0/1.
Paired temporal curves have finite values and x components in 0–1; missing
curves mean linear interpolation. Do not add time remapping, stretch, auto
orientation, rotation or skew to the slots.

For a side composition, keep its full visible artwork below its attachment within
`composition.h - anchorRect.y`. Chat checks room below the lowest authored side
attachment using that extent and a 20 px viewport margin. A bottom-docked mobile
composer without that room shows the poster. The adapter also requires an enabled
textarea, no expanded composer menu, an untransformed composer and ancestors,
and at most 300 nodes in its snapshot. Missing or ineligible composers, reduced
motion and failures before playback starts use the poster. Failures after playback
starts remove the scene. Input cancels the scene and restores the untouched draft,
focus and selection.

#### Enable the polar bears event

`new-year-polar-bears@1.0.0` is an independent event with its own static trigger
and English labels. This publication adds only `defaults.new-year-polar-bears`;
`defaults.new-year`, all existing packs and their scene pools remain unchanged.
It does not automatically add the bears to the ordinary New Year click pool.

Deploy a Chat release that supports `interaction-composer-carry-v1` before
enabling the event. On the Chat API deployment, retain the correct
`THEMES_CONFIG_URL` for this Themes release and set:

```dotenv
UI_EVENT=new-year-polar-bears
UI_EVENT_DELIVERY_MODE=prefer-external
UI_EVENT_EXTERNAL_EVENTS=new-year-polar-bears
UI_EVENT_DELIVERY_REVISION=polar-bears-1-0-0
```

Append the event to any existing `UI_EVENT_EXTERNAL_EVENTS` allowlist; no
`UI_EVENT_EXTERNAL_SCENES` entry is needed for an external-only event. After the
deployment configuration takes effect, reload Chat. The start-page button
"Play polar bears workshop" plays the single scene. Clients without the adapter
cannot activate this event; there is no compiled bears fallback. Disable it by
restoring the previous `UI_EVENT` and delivery policy, then reload open clients.
The mutable index cache does not by itself refresh an already resolved event in
an open tab.

The 28-second assets have 7 layers each. Desktop is 255,420 B with 1,585
keyframes and 1,957 authored vertices; mobile is 241,991 B with 1,409 keyframes
and 1,965 vertices. The poster is 3,246 B. Native browser review measured 353 SVG
nodes, within the scene's 800-node hard budget; the 320-node and 200 KiB targets
were exceeded to retain separate foot/contact poses and the flexible wire and
small bulbs. Review covered actual light/dark palettes at 360 and 1280 px,
LTR/RTL, readable faces and composer text, poster fallback, cancellation, and
natural-speed completion. These are correctness checks in a local development
environment, not deployment performance benchmarks.

### Check

Run the check before every pull request; CI runs it too:

```bash
node scripts/check-celebration-packs.mjs
node --test scripts/check-celebration-packs.test.mjs
```

The first command recomputes every size and hash and applies the same rules the Chat backend applies, plus the Lottie limits, the composer-anchor and slot rules, and the retention rule below. The second breaks one thing at a time in a copy of the published packs and proves that the first one rejects it: each kind of broken composer-anchor placement and outline slot, the cat-borrow rules, and composer-carry hierarchy, travel, side-slot and placement rules. It also proves that tangents Chat treats as linear are accepted and that a file shared by two variants is reported once.

### Publish a Pack Version

A published version is never edited. To change a pack, publish a new version:

1. Add the resources and the `manifest.json` under `static/celebrations/<packId>/<new version>/`.
2. Add the version to `index.json` `packs`, with the manifest's byte size and SHA-256.
3. Point `defaults.<eventId>` at the new version and bump `revision`.
4. Run `node scripts/check-celebration-packs.mjs`.

Publish in this order: resources, then the manifest, then `index.json`. Chat only follows the index, so every file a new index names already exists when the index changes. To roll back, point `defaults` back at the previous version and bump `revision`. Deleting `index.json` returns every event to its compiled scenes within a minute and leaves themes untouched.

### Caching

`index.json` is served with `Cache-Control: public, max-age=60, must-revalidate`, and every other file under `/celebrations/` with `public, max-age=31536000, immutable`, so a CDN or proxy in front of this service never holds a stale index for long and never refetches a version. These locations do not change the caching of `config.json` and the images.

### Retention

Keep the version `defaults` names plus the previous one, so a rollback is one index change. The check fails when a pack directory holds more than three versions. Delete an older version, together with its `index.json` entry, in a separate change, and only once no `index.json` revision from the last 30 days names it.

