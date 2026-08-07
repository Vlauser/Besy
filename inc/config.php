<?php
/**
 * AXIOMANTIC CMS — базовая конфигурация.
 * Меняйте только константы ниже. Всё остальное трогать не нужно.
 */

declare(strict_types=1);

// Абсолютный путь к корню проекта
define('ROOT', dirname(__DIR__));

/**
 * Папку с данными можно вынести за пределы сайта — тогда до заявок
 * и паролей нельзя добраться по адресу в браузере даже при ошибке
 * в настройках веб-сервера. Для этого положите рядом с index.php
 * файл config.local.php:
 *
 *     <?php
 *     define('DATA_DIR', '/var/www/axiomantic-data');
 *
 * Папка загрузок так вынесена быть не может: картинки из неё
 * отдаются посетителям по прямым ссылкам.
 */
if (is_file(ROOT . '/config.local.php')) require ROOT . '/config.local.php';

if (!defined('DATA_DIR'))   define('DATA_DIR', ROOT . '/data');
if (!defined('UPLOAD_DIR')) define('UPLOAD_DIR', ROOT . '/uploads');

// Базовый URL сайта без слэша в конце (например, https://axiomantic.ru)
define('SITE_URL', (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http')
    . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));

// Если сайт лежит в подпапке — укажите её здесь, например '/site'
define('BASE_PATH', '');

// Сколько заявок хранить в файле (старые уходят в архив)
define('LEADS_LIMIT', 2000);

// Разрешённые типы картинок для загрузки
define('ALLOWED_IMG', ['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif']);
define('MAX_UPLOAD_MB', 8);

// Часовой пояс — влияет на даты в заявках и на календарь запуска
date_default_timezone_set('Europe/Moscow');

// Экранирование вывода — используется во всех шаблонах
function e(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Текст с переносами строк -> HTML с <br>
function nl(?string $s): string
{
    // Сам перевод строки убираем: nl2br оставлял его после <br>, и в вёрстке
    // появлялся лишний пробел в начале строки — в макете его нет
    return str_replace(["\r\n", "\r", "\n"], '<br>', e($s));
}

// Многострочное поле -> массив непустых строк
function lines(?string $s): array
{
    $out = [];
    foreach (preg_split('/\r\n|\r|\n/', (string)$s) as $l) {
        $l = trim($l);
        if ($l !== '') $out[] = $l;
    }
    return $out;
}

// Ссылка внутри сайта
function url(string $path = ''): string
{
    return BASE_PATH . '/' . ltrim($path, '/');
}
