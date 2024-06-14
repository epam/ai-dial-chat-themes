# Overview

A theme is a collection of static resources including images, fonts, and color palettes that you can utilize to personalize the appearance of your [AI DIAL Chat](https://github.com/epam/ai-dial-chat) application. These resources can be stored anywhere and accessed by the chat application via the internet. We provide the AI DIAL Chat Themes service as a convenient method for hosting these static resources and making them accessible for the chat application. However, you have the flexibility to choose your own method for accomplishing this. 

This approach, having static resources externally, enables developers and designers to work concurrently and implement changes to themes without needing to redeploy the AI DIAL Chat application.

Chat application users can then select themes in [user settings](https://github.com/epam/ai-dial/blob/main/docs/user-guide.md#user-settings).

# Set Up Developer Environment

The HTTP server is run in Docker container. All you need is to [install the latest Docker engine](https://docs.docker.com/engine/install/).

# Build

Run the `build` command to build a Docker image with the tag `dial-chat-themes:latest`

```bash
make build
```

# Run

Execute this command to run the Docker container and bind the container port 8080 to the host network interface localhost:80

```bash
make run
```

# Helm Deployment and Configuration

1. You can deploy AI DIAL Chat Themes service using a common [dial](https://github.com/epam/ai-dial-helm/tree/main/charts/dial) Helm chart or using a stand-alone chart [dial-extension](https://github.com/epam/ai-dial-helm/tree/main/charts/dial-extension).

> Refer to [AI DIAL Helm](https://github.com/epam/ai-dial-helm) to learn about the deployment options and view the examples of charts.

2. In the [config.json](./static/config.json) file, you can define and configure custom themes or use (edit) default ones. Images can be stored in the **static** folder as well. However, you can store images anywhere and provide URLs in the config file.

3. Further, it is necessary to configure AI DIAL Chat to access the static resources and the themes configuration. To do that, add `THEMES_CONFIG_HOST` to the chat configuration - refer to [documentation](https://github.com/epam/ai-dial-chat/blob/development/apps/chat/README.md) for details. `THEMES_CONFIG_HOST` environment variable contains the URL to your nginx server with the configuration and images (this is the case when you use AI DIAL Chat Themes to provide static resoures for the chat application). This ensures that the application fetches your configuration file during loading. If the environment variable is not provided, [default themes and model icons]((./static/config.json)) will be applied.

4. After applying changes, it is necessary to redeploy the themes server. Changes will take effect automatically on the chat UI after 24hrs or upon the page reload. All the configured themes will be available in the chat application in [user settings](https://github.com/epam/ai-dial/blob/main/docs/user-guide.md#user-settings).

# Working with Themes

## Add Theme

In the [config.json](./static/config.json) file you can find two default themes: light and dark (default theme).

To declare a new theme, create an object inside the `themes` property and fill all the required fields as shown on the example:

> **Note**: if you create a list of custom themes, the first theme in the `themes` array will be used as a default one for **new** users. For other users, the theme will be fetched from a local storage.

```json
  // defined themes as an array
  "themes": [
    {
      "displayName": "Light",   // Displayed name in settings modal on UI
      "id": "light",            // Some kebab case id name
      "app-logo": "logo.svg",   // URL for website logo displayed
      "colors": {
        // Semantic colors which commonly used across entire application.
        // See default configuration to check available colors
      },
      "font-family":"Inter" //Font for the theme
    },
    // Other themes
  ],
```

The URL for `app-logo` will be recognized as a relative URL and transformed into `{{host}}/app-logo.svg`. You can also specify a full path to your images like `https://some-path.svg`, if you are hosting them at the external source.

## Customize Image URLs

You can provide image URLs in the configuration file [config.json](./static/config.json). To achieve this, create the following structure:

```json
{
  "themes": [
    // defined themes as an array
  ],
  "images": {
    // common for all themes image urls
    "default-model": "", //default icon for applications without a custom icon configured
    "default-addon": "", //default icon for addons without a custom icon configured
    "favicon": "favicon.png" // Chat application favicon
  }
}
```
Specify a full path to your images (e.g. `https://some-path.svg`) if you are hosting them at the external source; otherwise, a path be recognized as a relative URL and transformed into `{{host}}/app-logo.svg`. 

## Customize Theme Colors

> Specify a hex value in colors. Refer to [Hex Color](https://developer.mozilla.org/en-US/docs/Web/CSS/hex-color) for reference.

You can customize color palettes in the `colors` property for each object in the list of `themes`:

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
