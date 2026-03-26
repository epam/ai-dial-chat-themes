#!/bin/sh

set -e

ME="$(basename "$0")"


entrypoint_log() {
    if [ -z "${NGINX_ENTRYPOINT_QUIET_LOGS:-}" ]; then
        echo "$@"
    fi
}


rewrite_otel_conf_if_disabled() {
    if [ -z "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]; then
        entrypoint_log "$ME: OTEL_EXPORTER_OTLP_ENDPOINT is not set. Rewrite /tmp/otel.conf"
        cat > /tmp/otel.conf << 'EOF'
otel_trace off;

otel_exporter {
  endpoint localhost:4317;
}
EOF
    else
        entrypoint_log "$ME: OTEL_EXPORTER_OTLP_ENDPOINT is set ('$OTEL_EXPORTER_OTLP_ENDPOINT'). Keep existing /tmp/otel.conf"
    fi
}

rewrite_otel_conf_if_disabled

exit 0
