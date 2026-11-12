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
│   └── 1.0.0/                         # immutable once published
│       ├── manifest.json              # scenes, timing, variants and the declared assets
│       ├── bullfinch-couriers.desktop.<sha256 prefix>.json
│       ├── bullfinch-couriers.mobile.<sha256 prefix>.json
│       └── bullfinch-couriers.poster.<sha256 prefix>.svg
└── company-anniversary/
    └── 1.0.0/
        ├── manifest.json
        ├── confetti.desktop.<sha256 prefix>.json
        ├── confetti.poster.<sha256 prefix>.svg
        └── icon.<sha256 prefix>.svg
```

- `index.json` lists each published version with its manifest `path`, `bytes` and `sha256`, and `defaults` names the version each event uses.
- A manifest declares every file of its version directory with `assetId`, `file`, `mediaType`, `bytes` and `sha256`. File names and asset IDs end with the first 16 hex characters of the file's SHA-256, so a changed file always gets a new name.
- Animations are Lottie JSON for the `lottie_light` SVG player: shape, null and precomp layers only, no text, images, expressions or effects, at most 30 layers, 300 KiB per file. Posters and icons are static SVG without scripts or external references, at most 100 KiB.

Run the check before every pull request; CI runs it too:

```bash
node scripts/check-celebration-packs.mjs
```

It recomputes every size and hash and applies the same rules the Chat backend applies, plus the Lottie limits and the retention rule below.

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

