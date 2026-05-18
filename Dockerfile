FROM nginxinc/nginx-unprivileged:1.30.1-alpine-otel

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/*.template /etc/nginx/templates/
COPY --chmod=+x scripts/*.sh /docker-entrypoint.d/

COPY static /var/www

ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates \
    OTEL_SERVICE_NAME=ai-dial-chat-themes

EXPOSE 8080