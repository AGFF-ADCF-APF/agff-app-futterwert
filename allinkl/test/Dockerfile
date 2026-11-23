# Nachbildung des all-inkl-Webhostings für Tests: PHP 8.4 (wie dort verfügbar) mit Apache, mod_rewrite/headers, pdo_mysql
FROM php:8.4.27-apache-trixie
RUN docker-php-ext-install pdo_mysql >/dev/null && a2enmod rewrite headers >/dev/null \
 && sed -ri 's#AllowOverride None#AllowOverride All#g' /etc/apache2/apache2.conf \
 && printf 'upload_max_filesize=768M\npost_max_size=768M\nmemory_limit=768M\n' > /usr/local/etc/php/conf.d/allinkl.ini
# Auf all-inkl sind /futter und /wiese Symlinks auf public/ (wie Lernherbar/Pratum); hier direkt eingebunden (docker-compose.yml)
