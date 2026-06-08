# Image du frontend statique servi par Nginx, avec reverse-proxy de l'API.
FROM nginx:1.27-alpine

# Config Nginx (statique + proxy /api,/health + /config.js same-origin).
COPY --chown=nginx:nginx frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Fichiers de la SPA.
COPY --chown=nginx:nginx Version /usr/share/nginx/html/Version
COPY --chown=nginx:nginx frontend/index.html /usr/share/nginx/html/index.html
COPY --chown=nginx:nginx frontend/config.js /usr/share/nginx/html/config.js
COPY --chown=nginx:nginx frontend/src /usr/share/nginx/html/src

RUN touch /run/nginx.pid \
    && chown nginx:nginx /run/nginx.pid \
    && chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

USER nginx
