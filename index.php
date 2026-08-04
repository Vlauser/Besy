<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/store.php';
require_once __DIR__ . '/inc/seo.php';
require_once __DIR__ . '/inc/design.php';
require_once __DIR__ . '/inc/icons.php';
require_once __DIR__ . '/inc/view.php';

/* Определяем страницу по адресу */
$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (BASE_PATH !== '' && str_starts_with($uri, BASE_PATH)) {
    $uri = substr($uri, strlen(BASE_PATH));
}
$slug = trim($uri, '/');

/* Служебные адреса для поисковиков */
if ($slug === 'sitemap.xml') seo_render_sitemap();
if ($slug === 'robots.txt')  seo_render_robots();

$routes = [
    ''          => ['tpl' => 'home',     'meta' => 'home',     'nav' => 'home'],
    'projects'  => ['tpl' => 'projects', 'meta' => 'work',     'nav' => 'work'],
    'services'  => ['tpl' => 'services', 'meta' => 'services', 'nav' => 'services'],
    'contacts'  => ['tpl' => 'contacts', 'meta' => 'contacts', 'nav' => 'contacts'],
    'privacy'   => ['tpl' => 'privacy',  'meta' => 'privacy',  'nav' => ''],
    'consent'   => ['tpl' => 'consent',  'meta' => 'consent',  'nav' => ''],
];

if (!isset($routes[$slug])) {
    http_response_code(404);
    $page = ['tpl' => '404', 'meta' => 'home', 'nav' => ''];
} else {
    $page = $routes[$slug];
}

$METAKEY      = $page['meta'];
$PAGE_TITLE   = seo_title($METAKEY);
$PAGE_DESC    = seo_desc($METAKEY);
$PAGE_IMAGE   = seo_image($METAKEY);
$PAGE_NOINDEX = seo_noindex($METAKEY) || $page['tpl'] === '404';
$NAV          = $page['nav'];
$CANONICAL    = seo_url($slug);

require __DIR__ . '/tpl/_head.php';
require __DIR__ . '/tpl/_nav.php';

$tplFile = __DIR__ . '/tpl/' . $page['tpl'] . '.php';
if (is_file($tplFile)) {
    require $tplFile;
} else {
    echo '<main><section class="sec"><div class="wrap"><h1>Страница не найдена</h1></div></section></main>';
}

require __DIR__ . '/tpl/_footer.php';
