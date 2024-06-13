# Overview

A theme is a suite of static resources of images, fonts or sets of colors. The AI DIAL Chat Themes project is an HTTP server hosting themes for the AI DIAL Chat web application. By having a dedicated server for themes, it enables developers and designers to work concurrently and implement changes to themes without needing to redeploy the AI DIAL Chat application.

> Refer to [AI DIAL Chat](https://github.com/epam/ai-dial-chat) to learn more about it.

# Developer Environment

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

# Deployment and Configuration

1. You can deploy AI DIAL Chat Themes as a part of a [common dial Helm chart](https://github.com/epam/ai-dial-helm/tree/main/charts/dial) or in a [stand-alone chart](https://github.com/epam/ai-dial-helm/tree/main/charts/dial-extension).

> Refer to [AI DIAL Helm](https://github.com/epam/ai-dial-helm) to learn about the deployment options and view the examples of charts.

2. Further, it is necessary to configure AI DIAL Chat to work with AI DIAL Chat Themes. To do that, add `THEMES_CONFIG_HOST` to the chat configuration - refer to [documentation](https://github.com/epam/ai-dial-chat/blob/development/apps/chat/README.md) for details.

3. In the [config.json](./static/config.json) file, you can define and configure custom themes or use default ones. All the configured themes are available in the chat application in [user settings](https://github.com/epam/ai-dial/blob/main/docs/user-guide.md#user-settings). 
