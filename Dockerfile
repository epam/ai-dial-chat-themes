FROM nginxinc/nginx-unprivileged:1.25-alpine-slim
RUN rm /etc/nginx/conf.d/default.conf
COPY static /var/www
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/themes.conf.template /etc/nginx/templates/themes.conf.template
