#!/bin/sh
# Container start (Railway): cache config, migrate, load the data once, ensure the demo account, serve.
set -e
php artisan config:cache
php artisan route:cache
php artisan migrate --force --no-interaction
php artisan mc:import --if-empty --no-interaction
php artisan mc:demo-user --no-interaction
exec php artisan serve --host=0.0.0.0 --port="${PORT:-8080}" --no-reload
