# JDR development image: Apache + mod_php, close to a standard shared host.
# Build arg PHP_VERSION: 8.1 (minimum supported) by default, 8.3/8.4 to test newer runtimes.
ARG PHP_VERSION=8.1
FROM php:${PHP_VERSION}-apache

# Extensions required by the app (§6.3): pdo_mysql, gd (jpeg, webp, freetype), zip.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        libpng-dev \
        libwebp-dev \
        libzip-dev \
        unzip; \
    docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp; \
    docker-php-ext-install -j"$(nproc)" gd pdo_mysql zip; \
    rm -rf /var/lib/apt/lists/*

# mod_rewrite + mod_headers (mod_deflate is already enabled by Debian, like on most hosts:
# useful to check that /api/v1/stream is excluded from compression).
RUN a2enmod rewrite headers

# Honour the project's .htaccess files (AllowOverride All), as shared hosts do.
COPY apache-jdr.conf /etc/apache2/conf-available/jdr.conf
RUN a2enconf jdr

# PHP settings close to a typical shared host (see php.ini).
COPY php.ini /usr/local/etc/php/conf.d/zz-jdr.ini

WORKDIR /var/www/html
