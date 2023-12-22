# Overview

The project is an HTTP server hosting themes for the Chat web application. A theme is a suite of static resources of images, fonts or set of colors.

More details about theme customization can be found [here](https://github.com/epam/ai-dial-chat/blob/development/docs/THEME-CUSTOMIZATION.md).

# Developer Environment

The HTTP server is run in Docker container. All you need is to install the latest Docker engine.

# Build

Builds Docker image with the tag dial-chat-themes:latest
```bash
make build
```

# Run

Runs Docker container and binds the container port 8080 to the host network interface localhost:80

```bash
make run
```

