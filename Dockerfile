FROM nginxinc/nginx-unprivileged:1.29-alpine-otel

RUN rm /etc/nginx/conf.d/default.conf

COPY static /var/www

# Default Nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf

COPY nginx/themes.conf.template /etc/nginx/templates/themes.conf.template
COPY nginx/otel.conf.template /etc/nginx/templates/otel.conf.template

COPY scripts/25-rewrite-otel-conf-if-disabled.sh /docker-entrypoint.d/


ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates \
    OTEL_SERVICE_NAME=ai-dial-chat-themes

