FROM nginxinc/nginx-unprivileged:1.29-alpine-otel

RUN rm /etc/nginx/conf.d/default.conf

COPY static /var/www

# Default Nginx config
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Default Themes and OTEL configs
COPY nginx/themes.conf.template /etc/nginx/templates/themes.conf.template
COPY nginx/otel.conf.template /etc/nginx/templates/otel.conf.template

COPY scripts/25-rewrite-otel-conf-if-disabled.sh /docker-entrypoint.d/25-rewrite-otel-conf-if-disabled.sh

USER root
RUN chmod +x /docker-entrypoint.d/25-rewrite-otel-conf-if-disabled.sh \
    && chown -R nginx:nginx /etc/nginx/conf.d /tmp /etc/nginx/templates \
    && chmod -R g+w /etc/nginx/conf.d \
    && chmod -R 644 /etc/nginx/templates/*.template

ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates

USER 1001
