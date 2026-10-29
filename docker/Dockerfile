# PHP 8.3 для сайта в контейнере.
#
# Нужен там, где системный PHP старее 8.1: движок использует тип never
# (появился в 8.1) и str_contains (8.0). На PHP 7.4 сайт не запустится
# вовсе — интерпретатор споткнётся на разборе файла, не дойдя до работы.
#
# Контейнер не трогает системные пакеты: рядом может жить любая другая
# версия PHP, занятая соседними сайтами.
#
# Сборка и запуск:
#
#   docker build -t axiomantic-php /var/www/axiomantic/docker/
#   docker run -d --name axiomantic-php --restart unless-stopped \
#     -p 127.0.0.1:9000:9000 \
#     -v /var/www/axiomantic:/var/www/axiomantic \
#     -v /var/www/axiomantic-data:/var/www/axiomantic-data \
#     axiomantic-php
#
# Пути внутри контейнера намеренно совпадают с путями на сервере:
# nginx передаёт PHP полное имя файла, и если пути разойдутся,
# PHP просто не найдёт то, что ему назвали.
#
# В конфиге nginx вместо сокета указывается:
#   fastcgi_pass 127.0.0.1:9000;

FROM php:8.3-fpm

# gd готовит уменьшенные копии и WebP-двойники картинок.
# В базовом образе его нет, собираем с поддержкой JPEG и WebP.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpng-dev libjpeg62-turbo-dev libwebp-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp \
 && docker-php-ext-install -j"$(nproc)" gd \
 && rm -rf /var/lib/apt/lists/*

COPY php.ini /usr/local/etc/php/conf.d/axiomantic.ini
