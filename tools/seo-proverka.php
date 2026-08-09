<?php
declare(strict_types=1);

/**
 * Проверка сайта глазами поисковика.
 *
 *   php tools/seo-proverka.php
 *   php tools/seo-proverka.php https://axiomantic.ru
 *
 * Берёт список страниц из sitemap.xml и по каждой смотрит то, из-за чего
 * страница хуже показывается в поиске: заголовок, описание, единственность
 * h1, разметку, картинки без подписи. Отдельно ищет повторы заголовков
 * между страницами, битые внутренние ссылки и страницы-сироты, на которые
 * никто не ссылается.
 *
 * Ничего не меняет. Запускать можно сколько угодно.
 */

const T_MIN = 20;   // короче — поисковик подставит своё
const T_MAX = 65;   // длиннее — обрежет в выдаче
const D_MIN = 70;
const D_MAX = 165;

$root = dirname(__DIR__);

// Адрес сайта: из аргумента, иначе из настроек
$base = $argv[1] ?? '';
if ($base === '') {
    require $root . '/inc/config.php';
    require $root . '/inc/store.php';
    // «Основной адрес сайта» из раздела SEO — общие. Если не заполнен,
    // движок подставляет адрес текущего запроса, но из командной строки
    // запроса нет, поэтому там окажется localhost.
    $base = trim((string)c('seo.canonical_host'));
}
$base = rtrim($base, '/');
if ($base === '') {
    fwrite(STDERR, "Не знаю адрес сайта. Запустите: php tools/seo-proverka.php https://ваш-сайт.ru\n");
    exit(1);
}

$ok = 0;
$problems = [];

/** Загрузить страницу. Возвращает [код, тело]. */
function fetch(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_USERAGENT      => 'seo-proverka/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [$code, is_string($body) ? $body : ''];
}

/** Только код ответа — для проверки ссылок. */
function head_code(string $url): int
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_NOBODY         => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_USERAGENT      => 'seo-proverka/1.0',
    ]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return $code;
}

function say_ok(string $text): void
{
    global $ok;
    $ok++;
    echo "  \033[32mОК\033[0m   $text\n";
}

function say_bad(string $text): void
{
    global $problems;
    $problems[] = $text;
    echo "  \033[31m!!\033[0m   $text\n";
}

echo "Проверяю $base\n\n";

// ---------- Служебные файлы ----------
echo "== Служебные файлы ==\n";

[$c, $robots] = fetch("$base/robots.txt");
$c === 200 ? say_ok('robots.txt отдаётся') : say_bad("robots.txt не отдаётся (код $c)");

if ($c === 200) {
    str_contains($robots, 'Sitemap:')
        ? say_ok('в robots.txt указан адрес карты сайта')
        : say_bad('в robots.txt нет строки Sitemap');
    str_contains($robots, 'Disallow: /admin/')
        ? say_ok('админка закрыта от поисковиков')
        : say_bad('админка не закрыта в robots.txt');
}

[$c, $xml] = fetch("$base/sitemap.xml");
if ($c !== 200) {
    say_bad("sitemap.xml не отдаётся (код $c) — дальше проверять нечего");
    exit(1);
}

preg_match_all('~<loc>([^<]+)</loc>~', $xml, $m);
$urls = array_values(array_unique($m[1]));
$urls ? say_ok('в карте сайта страниц: ' . count($urls))
      : say_bad('карта сайта пустая');

if (!$urls) exit(1);

// ---------- Страницы ----------
echo "\n== Страницы ==\n";
printf("  %-34s %-4s %-6s %-6s %-3s %s\n", 'адрес', 'код', 'загол', 'опис', 'h1', 'замечания');

$titles = [];
$descs  = [];
$links  = [];   // куда ссылаются -> откуда
$pages  = [];   // адрес -> путь

foreach ($urls as $url) {
    // В карте сайта записан боевой домен. Ходим не по нему, а по тому
    // адресу, который передали скрипту, — иначе проверка копии сайта
    // молча проверяла бы боевой.
    $path = parse_url($url, PHP_URL_PATH) ?: '/';
    $pages[rtrim($path, '/') ?: '/'] = $url;

    [$code, $html] = fetch($base . $path);
    $short = mb_strimwidth($path, 0, 34);

    if ($code !== 200 || $html === '') {
        printf("  %-34s %-4s\n", $short, $code);
        say_bad("$path — страница отдаёт код $code");
        continue;
    }

    preg_match('~<title>(.*?)</title>~s', $html, $t);
    $title = html_entity_decode(trim($t[1] ?? ''), ENT_QUOTES | ENT_HTML5);

    preg_match('~<meta name="description" content="(.*?)"~s', $html, $d);
    $desc = html_entity_decode(trim($d[1] ?? ''), ENT_QUOTES | ENT_HTML5);

    $h1 = preg_match_all('~<h1[\s>]~', $html);

    // Считаем только картинки совсем без alt. Пустой alt="" — не ошибка,
    // а пометка «картинка декоративная»: читалка экрана её пропустит,
    // вместо того чтобы зачитывать адрес файла. Так помечены пиксели
    // счётчиков и фоновые украшения.
    preg_match_all('~<img\b[^>]*>~i', $html, $imgs);
    $noalt = 0;
    foreach ($imgs[0] as $tag) {
        if (!preg_match('~\salt\s*=~i', $tag)) $noalt++;
    }

    $notes = [];
    $lt = mb_strlen($title);
    $ld = mb_strlen($desc);

    if ($title === '')          $notes[] = 'нет заголовка';
    elseif ($lt > T_MAX)        $notes[] = "заголовок длинный ($lt, обрежется)";
    elseif ($lt < T_MIN)        $notes[] = "заголовок короткий ($lt)";

    if ($desc === '')           $notes[] = 'нет описания';
    elseif ($ld > D_MAX)        $notes[] = "описание длинное ($ld)";
    elseif ($ld < D_MIN)        $notes[] = "описание короткое ($ld)";

    if ($h1 === 0)              $notes[] = 'нет h1';
    elseif ($h1 > 1)            $notes[] = "h1 несколько ($h1)";

    if (!preg_match('~<link rel="canonical"~', $html))        $notes[] = 'нет canonical';
    if (!preg_match('~application/ld\+json~', $html))         $notes[] = 'нет микроразметки';
    if (!preg_match('~<meta property="og:image"~', $html))    $notes[] = 'нет картинки для соцсетей';
    if (!preg_match('~<html lang=~', $html))                  $notes[] = 'не указан язык страницы';
    if ($noalt > 0)                                           $notes[] = "картинок без подписи: $noalt";

    // разметка должна разбираться, иначе поисковик её просто пропустит
    preg_match_all('~<script type="application/ld\+json">(.*?)</script>~s', $html, $j);
    foreach ($j[1] as $blob) {
        json_decode($blob);
        if (json_last_error() !== JSON_ERROR_NONE) {
            $notes[] = 'микроразметка с ошибкой';
            break;
        }
    }

    // заголовки не должны прыгать через уровень
    preg_match_all('~<h([1-6])[\s>]~', $html, $hh);
    $prev = 0;
    foreach ($hh[1] as $lvl) {
        $lvl = (int)$lvl;
        if ($prev && $lvl > $prev + 1) { $notes[] = "заголовки прыгают с h$prev на h$lvl"; break; }
        $prev = $lvl;
    }

    if ($title !== '') $titles[$title][] = $path;
    if ($desc !== '')  $descs[$desc][]   = $path;

    // внутренние ссылки — для поиска битых и сирот
    preg_match_all('~<a\b[^>]+href="([^"]+)"~', $html, $a);
    foreach ($a[1] as $href) {
        // Отрезаем якорь и параметры. Именно explode, а не strtok:
        // strtok пропускает разделитель в начале и превращает
        // href="#request" в путь "request" — ссылка на свой же экран
        // выглядела бы как битая страница.
        $href = explode('#', $href)[0];
        $href = explode('?', $href)[0];
        if ($href === '') continue;
        if (preg_match('~^(https?:)?//~', $href)) {
            if (!str_starts_with($href, $base)) continue;      // чужой сайт не наше дело
            $href = parse_url($href, PHP_URL_PATH) ?: '/';
        }
        if (preg_match('~^(mailto:|tel:|javascript:)~i', $href)) continue;
        $href = '/' . ltrim($href, '/');
        $links[rtrim($href, '/') ?: '/'][] = $path;
    }

    printf("  %-34s %-4s %-6s %-6s %-3s %s\n", $short, $code, $lt, $ld, $h1, implode('; ', $notes));
    $notes ? say_bad("$path — " . implode('; ', $notes)) : $ok++;
}

// ---------- Повторы ----------
echo "\n== Повторы между страницами ==\n";

$dupT = array_filter($titles, fn($u) => count($u) > 1);
$dupD = array_filter($descs,  fn($u) => count($u) > 1);

if ($dupT) {
    foreach ($dupT as $t => $where) {
        say_bad('одинаковый заголовок «' . mb_strimwidth($t, 0, 45, '…') . '»: ' . implode(', ', $where));
    }
} else {
    say_ok('заголовки не повторяются');
}

if ($dupD) {
    foreach ($dupD as $t => $where) {
        say_bad('одинаковое описание «' . mb_strimwidth($t, 0, 45, '…') . '»: ' . implode(', ', $where));
    }
} else {
    say_ok('описания не повторяются');
}

// ---------- Ссылки ----------
echo "\n== Внутренние ссылки ==\n";

$broken = 0;
$checked = [];
foreach ($links as $path => $from) {
    if (isset($pages[$path])) continue;                 // страница из карты, уже проверена
    if (preg_match('~\.(pdf|jpe?g|png|webp|svg|ico|css|js|xml|txt|zip)$~i', $path)) {
        // файлы тоже стоит проверить: битая ссылка на политику — это жалоба, а не мелочь
    }
    if (isset($checked[$path])) continue;
    $checked[$path] = true;

    $code = head_code($base . $path);
    if ($code !== 200) {
        say_bad("битая ссылка $path (код $code) — со страниц: " . implode(', ', array_slice(array_unique($from), 0, 3)));
        $broken++;
    }
}
$broken === 0 and say_ok('битых внутренних ссылок нет');

$orphans = [];
foreach ($pages as $path => $_) {
    if ($path === '/') continue;
    if (!isset($links[$path])) $orphans[] = $path;
}
$orphans
    ? say_bad('на эти страницы никто не ссылается: ' . implode(', ', $orphans))
    : say_ok('все страницы карты доступны по ссылкам с сайта');

// ---------- Итог ----------
echo "\n== Итог: успешно $ok, проблем " . count($problems) . " ==\n";

if (!$problems) {
    echo "Всё в порядке.\n";
    exit(0);
}

echo "\nЧто поправить:\n";
foreach (array_slice($problems, 0, 40) as $p) echo "  - $p\n";
if (count($problems) > 40) echo '  … и ещё ' . (count($problems) - 40) . "\n";

exit(1);
