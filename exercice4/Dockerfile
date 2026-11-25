# Mission Control web app — production image for Railway (build context: exercice4/).
# Stage 1 builds the React frontend into backend/public/app; stage 2 runs Laravel on PHP 8.5.

FROM node:22-bookworm-slim AS web
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN mkdir -p ../backend/public && node node_modules/vite/bin/vite.js build

FROM php:8.5-cli-bookworm
COPY --from=mlocati/php-extension-installer /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_mysql intl zip opcache pcntl
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1 APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr PHP_CLI_SERVER_WORKERS=4
WORKDIR /app
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --no-progress
COPY backend/ ./
COPY --from=web /build/backend/public/app ./public/app
RUN composer dump-autoload --optimize --no-dev --no-scripts \
    && php artisan package:discover --ansi \
    && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chmod +x docker/start.sh
EXPOSE 8080
CMD ["sh", "docker/start.sh"]
