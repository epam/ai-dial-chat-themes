FROM nginxinc/nginx-unprivileged:1.31.4-alpine-otel

# CVE-2026-14456: the base image still ships openssl 3.5.7-r0. Drop this block once
# an upstream rebuild picks up 3.5.8-r0 from Alpine.
USER root
RUN apk add --no-cache --upgrade "libcrypto3>=3.5.8-r0" "libssl3>=3.5.8-r0"
USER 101

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/*.template /etc/nginx/templates/
COPY --chmod=+x scripts/*.sh /docker-entrypoint.d/

COPY static /var/www

ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates \
    OTEL_SERVICE_NAME=ai-dial-chat-themes

EXPOSE 8080
