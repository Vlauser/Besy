<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/store.php';
require_once __DIR__ . '/inc/seo.php';
require_once __DIR__ . '/inc/design.php';
require_once __DIR__ . '/inc/icons.php';
require_once __DIR__ . '/inc/img.php';
require_once __DIR__ . '/inc/view.php';
require_once __DIR__ . '/inc/commercial.php';

/* Определяем страницу по адресу.
   Query и якорь отрезаем вручную: parse_url принял бы адрес вида
   //projects за протокол-относительный и вернул бы «projects» доменом. */
$uri = (string)($_SERVER['REQUEST_URI'] ?? '/');
$uri = explode('#', explode('?', $uri, 2)[0], 2)[0];
if ($uri === '') $uri = '/';

if (BASE_PATH !== '' && str_starts_with($uri, BASE_PATH)) {
    $uri = substr($uri, strlen(BASE_PATH));
}

/* Лишние варианты адреса уводим 301-м, чтобы не плодить дубли в индексе */
seo_canonicalize($uri);

$slug = trim($uri, '/');

/* Предпросмотр из админки: страница показывается внутри панели.
   В этом режиме прячем баннер cookie и не запускаем счётчик, чтобы
   правки редактора не попадали в статистику и не мешали смотреть блок. */
$PREVIEW = isset($_GET['preview']);

/* Служебные адреса для поисковиков */
if ($slug === 'sitemap.xml') seo_render_sitemap();
if ($slug === 'robots.txt')  seo_render_robots();

$routes = [
    ''          => ['tpl' => 'home',     'meta' => 'home',     'nav' => 'home'],
    'projects'  => ['tpl' => 'projects', 'meta' => 'work',     'nav' => 'work'],
    'services'  => ['tpl' => 'services', 'meta' => 'services', 'nav' => 'services'],
    'about'     => ['tpl' => 'about',    'meta' => 'about',    'nav' => 'about'],
    'blog'      => ['tpl' => 'blog',     'meta' => 'blog',     'nav' => 'blog'],
    'contacts'  => ['tpl' => 'contacts', 'meta' => 'contacts', 'nav' => 'contacts'],
    'privacy'   => ['tpl' => 'privacy',  'meta' => 'privacy',  'nav' => ''],
    'consent'   => ['tpl' => 'consent',  'meta' => 'consent',  'nav' => ''],
];

/* Отдельная страница проекта: /projects/<ключ>.
   Каждая работа — это готовый уникальный текст, который иначе
   лежал бы мёртвым грузом в карточке на общей странице. */
$PROJECT = null;
if (str_starts_with($slug, 'projects/')) {
    $PROJECT = work_item(substr($slug, strlen('projects/')));
}

/* Статья блога: /blog/<ключ>. Черновики недоступны и по прямой ссылке */
$POST = null;
if (str_starts_with($slug, 'blog/')) {
    $POST = blog_post(substr($slug, strlen('blog/')));
}

/* Пустой блог наружу не показываем: страница со словами «статей пока нет»
   в индексе — это страница без содержания, Яндекс за такие не хвалит */
$blogEmpty = ($slug === 'blog' && !blog_posts());
$COMMERCIAL = commercial_page($slug);

if ($PROJECT !== null) {
    $page = ['tpl' => 'project', 'meta' => 'work', 'nav' => 'work'];
} elseif ($POST !== null) {
    $page = ['tpl' => 'post', 'meta' => 'blog', 'nav' => 'blog'];
} elseif ($COMMERCIAL !== null) {
    $page = ['tpl' => 'commercial', 'meta' => 'services', 'nav' => 'services'];
} elseif (!isset($routes[$slug])) {
    http_response_code(404);
    $page = ['tpl' => '404', 'meta' => 'home', 'nav' => ''];
} else {
    $page = $routes[$slug];
}

$METAKEY = $page['meta'];

if ($PROJECT) {
    $PAGE_TITLE = seo_project_title($PROJECT);
    $PAGE_DESC  = seo_project_desc($PROJECT);
    $PAGE_IMAGE = seo_project_image($PROJECT);
} elseif ($POST) {
    $PAGE_TITLE = seo_post_title($POST);
    $PAGE_DESC  = seo_post_desc($POST);
    $PAGE_IMAGE = seo_post_image($POST);
} elseif ($COMMERCIAL) {
    $PAGE_TITLE = (string)($COMMERCIAL['title'] ?? seo_title('services'));
    $PAGE_DESC  = (string)($COMMERCIAL['description'] ?? seo_desc('services'));
    $PAGE_IMAGE = seo_image('services');
} else {
    $PAGE_TITLE = seo_title($METAKEY);
    $PAGE_DESC  = seo_desc($METAKEY);
    $PAGE_IMAGE = seo_image($METAKEY);
}

$PAGE_NOINDEX = $PREVIEW || !empty(c('seo.noindex_all')) || $page['tpl'] === '404';
if (!$PAGE_NOINDEX) {
    if ($PROJECT)        $PAGE_NOINDEX = !empty($PROJECT['noindex']);
    elseif ($POST)       $PAGE_NOINDEX = seo_noindex('blog');
    // Пустой раздел блога — страница без содержания, в индекс её не пускаем
    elseif ($blogEmpty)  $PAGE_NOINDEX = true;
    else                 $PAGE_NOINDEX = seo_noindex($METAKEY);
}

$NAV          = $page['nav'];
$CANONICAL    = seo_url($slug);
$SLUG         = $page['tpl'] === '404' ? '' : $slug;
$CRUMBS       = seo_crumbs($SLUG, $PROJECT, $POST);

/* Самая крупная картинка первого экрана — по ней считается LCP.
   Просим браузер начать её загрузку из <head>, а не по ходу разметки. */
$LCP_IMAGE = '';
$LCP_TYPE  = '';
if ($page['tpl'] === 'home' && ($heroImg = trim((string)c('hero.image'))) !== '') {
    [$LCP_IMAGE, $LCP_TYPE] = img_preload_src($heroImg);
} elseif ($PROJECT && ($shot = trim((string)($PROJECT['image'] ?? ''))) !== '') {
    [$LCP_IMAGE, $LCP_TYPE] = img_preload_src($shot);
} elseif ($POST && ($cover = trim((string)($POST['image'] ?? ''))) !== '') {
    [$LCP_IMAGE, $LCP_TYPE] = img_preload_src($cover);
}

require __DIR__ . '/tpl/_head.php';
require __DIR__ . '/tpl/_nav.php';
/* Видимые крошки по макету стоят внутри первого экрана: коммерческие
   страницы и статьи рисуют их сами. На остальных страницах их в макете
   нет — но BreadcrumbList в JSON-LD отдаётся везде. */

$tplFile = __DIR__ . '/tpl/' . $page['tpl'] . '.php';
if (is_file($tplFile)) {
    require $tplFile;
} else {
    echo '<main><section class="sec"><div class="wrap"><h1>Страница не найдена</h1></div></section></main>';
}

require __DIR__ . '/tpl/_footer.php';
