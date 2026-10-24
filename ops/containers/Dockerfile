# Build context is the repository root; dist must already be tested and prepared.
ARG NGINX_BASE
FROM ${NGINX_BASE}
ARG SOURCE_COMMIT
ARG APP_RELEASE
USER root
# jq is used to validate bounded release receipts. No app build runs here.
# Alpine package floors fix CVE-2026-85091 (zlib), CVE-2026-77214
# (libexpat), CVE-2026-88806 (libx11) and CVE-2026-94287 (libxpm).
# CVE-2026-107891 requires patched musl and musl-utils.
# Serving/staging do not use curl/libcurl; HTTP checks run on the CI runner.
RUN apk del --no-cache curl libcurl \
    && apk add --no-cache jq 'zlib>=1.3.2-r1' \
    'libexpat>=2.9.0-r0' 'libx11>=1.8.14-r0' 'libxpm>=3.5.20-r0' \
    'musl>=1.2.6-r3' 'musl-utils>=1.2.6-r3' \
    && ! apk info --exists curl \
    && ! apk info --exists libcurl \
    && mkdir -p /opt/site /opt/app-releases \
    && chown -R 101:101 /opt/site /opt/app-releases
COPY --chown=101:101 dist/ /opt/site/
COPY ops/containers/nginx.conf /etc/nginx/nginx.conf
COPY ops/containers/entrypoint.sh ops/containers/stage-release.sh ops/containers/release-common.sh /usr/local/bin/
RUN chmod 0555 /usr/local/bin/entrypoint.sh /usr/local/bin/stage-release.sh /usr/local/bin/release-common.sh \
    && test "$(jq -r .sourceCommit /opt/site/release-meta.json)" = "${SOURCE_COMMIT}" \
    && test "$(jq -r .appRelease /opt/site/release-meta.json)" = "${APP_RELEASE}" \
    && ln -s /opt/site "/opt/app-releases/${APP_RELEASE}"
LABEL org.opencontainers.image.title="Japan Price Basket" \
      org.opencontainers.image.source="https://github.com/ZionLangan/japan-price-basket" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="MIT"
USER 101:101
EXPOSE 8080
STOPSIGNAL SIGQUIT
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["serve"]
