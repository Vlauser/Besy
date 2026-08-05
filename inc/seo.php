<?php
declare(strict_types=1);
require_once __DIR__ . '/store.php';

/**
 * SEO: канонизация адресов, мета-теги, микроразметка, карта сайта и robots.txt.
 * Всё, что видит поисковик, собирается здесь. Настройки — в админке,
 * разделы «SEO — страницы» и «SEO — общие».
 */

/* ==================== Адреса ==================== */

/** Основной адрес сайта без слэша в конце. */
function seo_base(): string
{
    $host = trim((string)c('seo.canonical_host'));
    if ($host === '') return SITE_URL . BASE_PATH;
    return rtrim($host, '/');
}

/** Схема и домен основного адреса, без пути: https://axiomantic.ru */
function seo_origin(): string
{
    $host = trim((string)c('seo.canonical_host'));
    if ($host === '') return SITE_URL;

    $p = parse_url(rtrim($host, '/'));
    if (empty($p['host'])) return SITE_URL;

    return ($p['scheme'] ?? 'https') . '://' . $p['host']
         . (isset($p['port']) ? ':' . $p['port'] : '');
}

/** Полный адрес страницы по её slug. */
function seo_url(string $slug = ''): string
{
    $slug = trim($slug, '/');
    return seo_base() . ($slug === '' ? '/' : '/' . $slug);
}

/** Схема текущего запроса с учётом обратного прокси. */
function seo_current_scheme(): string
{
    $fwd = strtolower(trim((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));
    if ($fwd !== '') return trim(explode(',', $fwd)[0]);
    return (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
}

/** Локальный адрес или голый IP — такие домены не канонизируем. */
function seo_is_local_host(string $host): bool
{
    $host = strtolower(explode(':', $host)[0]);
    if ($host === '' || $host === 'localhost') return true;
    if (str_ends_with($host, '.local') || str_ends_with($host, '.test')) return true;
    return (bool)filter_var($host, FILTER_VALIDATE_IP);
}

/**
 * Одна страница — один адрес.
 *
 * Без этого /services, /services/, /Services и /index.php отдают одну и ту же
 * страницу с кодом 200. Для Вебмастера это четыре дубля: вес размазывается,
 * в выдачу попадает случайный вариант. Всё лишнее уводим 301-м.
 *
 * @param string $path путь запроса уже без BASE_PATH
 */
function seo_canonicalize(string $path): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') return;

    $target = $path === '' ? '/' : $path;

    // /index.php на конце — служебный вход, наружу его не показываем
    $target = (string)preg_replace('~/index\.php$~i', '/', $target);
    // повторные слэши: //services///
    $target = (string)preg_replace('~/{2,}~', '/', $target);
    // хвостовой слэш у всего, кроме корня
    if (strlen($target) > 1) $target = rtrim($target, '/');
    if ($target === '') $target = '/';
    // верхний регистр в адресе
    $target = mb_strtolower($target, 'UTF-8');

    // Домен: www → без www, http → https. Работает, только если основной адрес
    // задан в админке и включена галочка. На localhost не срабатывает никогда.
    $needOrigin = false;
    $host = (string)($_SERVER['HTTP_HOST'] ?? '');

    if (!empty(c('seo.force_host'))
        && trim((string)c('seo.canonical_host')) !== ''
        && !seo_is_local_host($host)) {

        $want       = parse_url(seo_origin());
        $wantHost   = strtolower((string)($want['host'] ?? ''));
        $wantScheme = (string)($want['scheme'] ?? 'https');

        if ($wantHost !== ''
            && (strtolower(explode(':', $host)[0]) !== $wantHost
                || seo_current_scheme() !== $wantScheme)) {
            $needOrigin = true;
        }
    }

    if ($target === $path && !$needOrigin) return;

    $query = (string)($_SERVER['QUERY_STRING'] ?? '');
    $to = ($needOrigin ? seo_origin() : '') . BASE_PATH . $target
        . ($query !== '' ? '?' . $query : '');

    header('Location: ' . $to, true, 301);
    exit;
}

/* ==================== Мета-теги ==================== */

/** Title страницы с приставкой. */
function seo_title(string $key): string
{
    $title = trim((string)c('meta.' . $key . '_title'));
    if ($title === '') {
        $title = trim((string)c('seo.title_fallback')) ?: (string)c('site.brand', 'AXIOMANTIC');
    }
    $suffix = trim((string)c('seo.title_suffix'));
    if ($suffix !== '' && $key !== 'home' && !str_contains($title, $suffix)) {
        $title .= $suffix;
    }
    return $title;
}

function seo_desc(string $key): string
{
    return trim((string)c('meta.' . $key . '_desc'));
}

/** Картинка для соцсетей: своя у страницы, иначе общая. */
function seo_image(string $key): string
{
    $img = trim((string)c('meta.' . $key . '_og'));
    if ($img === '') $img = trim((string)c('seo.og_image'));
    if ($img === '') return '';
    if (str_starts_with($img, 'http://') || str_starts_with($img, 'https://')) return $img;
    return seo_base() . '/' . ltrim($img, '/');
}

/** Нужно ли закрывать страницу от индексации. */
function seo_noindex(string $key): bool
{
    if (!empty(c('seo.noindex_all'))) return true;
    return !empty(c('meta.' . $key . '_noindex'));
}

/* ==================== Хлебные крошки ==================== */

/**
 * Цепочка «Главная → раздел». Яндекс показывает её в выдаче вместо
 * голого адреса, а человеку видно, куда он попал.
 *
 * url — абсолютный адрес для микроразметки, path — относительный для ссылки
 * на странице: так сайт остаётся рабочим на тестовом домене.
 *
 * @return array<int, array{name: string, url: string, path: string}> пусто на главной
 */
function seo_crumbs(string $slug): array
{
    $slug = trim($slug, '/');
    if ($slug === '') return [];

    $names = [
        'projects' => trim((string)c('site.nav_projects')) ?: 'Проекты',
        'services' => trim((string)c('site.nav_services')) ?: 'Услуги',
        'contacts' => trim((string)c('site.nav_contacts')) ?: 'Контакты',
        'privacy'  => trim((string)c('legal.privacy_title')) ?: 'Политика обработки данных',
        'consent'  => trim((string)c('legal.consent_title')) ?: 'Согласие на обработку данных',
    ];
    if (!isset($names[$slug])) return [];

    return [
        [
            'name' => trim((string)c('site.nav_home')) ?: 'Главная',
            'url'  => seo_url(''),
            'path' => url(''),
        ],
        [
            'name' => $names[$slug],
            'url'  => seo_url($slug),
            'path' => url($slug),
        ],
    ];
}

/* ==================== Микроразметка ==================== */

/** «30 000 ₽» → «30000». «По задаче» → пусто. */
function seo_price_number(string $raw): string
{
    return (string)preg_replace('/\D+/u', '', $raw);
}

/** Организация — карточка компании, на неё ссылаются остальные сущности. */
function seo_node_org(): array
{
    $base = seo_base();
    $name = trim((string)c('seo.org_name')) ?: (string)c('site.brand', 'AXIOMANTIC');

    $node = [
        '@type' => ['Organization', 'ProfessionalService'],
        '@id'   => $base . '/#organization',
        'name'  => $name,
        'url'   => $base,
        'description' => seo_desc('home'),
    ];

    if ($img = seo_image('home')) {
        $node['image'] = $img;
        $node['logo']  = ['@type' => 'ImageObject', 'url' => $img];
    }
    if ($p = trim((string)c('seo.org_price')))   $node['priceRange'] = $p;
    if ($y = trim((string)c('seo.org_founded'))) $node['foundingDate'] = $y;
    if ($m = trim((string)c('site.email')))      $node['email'] = $m;
    if ($t = trim((string)c('site.phone')))      $node['telephone'] = $t;

    // Юридические данные из подвала — Яндекс сверяет их с реестрами
    if ($ln = trim((string)c('site.legal_name'))) $node['legalName'] = $ln;
    if ($inn = trim((string)c('site.inn')))       $node['taxID'] = $inn;

    if ($city = trim((string)c('seo.org_city'))) {
        $node['address'] = [
            '@type'           => 'PostalAddress',
            'addressLocality' => $city,
            'addressCountry'  => 'RU',
        ];
        $node['areaServed'] = ['@type' => 'Country', 'name' => 'Россия'];
    }

    // Способы связи из «Контакты и шапка»
    $points = [];
    foreach ((array)c('site.channels', []) as $ch) {
        $u = trim((string)($ch['url'] ?? ''));
        if ($u === '') continue;

        if (str_starts_with($u, 'mailto:')) {
            $points[] = [
                '@type'             => 'ContactPoint',
                'contactType'       => 'customer support',
                'email'             => substr($u, 7),
                'availableLanguage' => 'Russian',
            ];
        } elseif (str_starts_with($u, 'tel:')) {
            $points[] = [
                '@type'             => 'ContactPoint',
                'contactType'       => 'customer support',
                'telephone'         => substr($u, 4),
                'availableLanguage' => 'Russian',
            ];
        }
    }
    if ($points) $node['contactPoint'] = $points;

    $same = [];
    foreach ((array)c('site.channels', []) as $ch) {
        $u = trim((string)($ch['url'] ?? ''));
        if ($u !== '' && str_starts_with($u, 'http')) $same[] = $u;
    }
    foreach ((array)c('site.socials', []) as $s) {
        $u = trim((string)($s['url'] ?? ''));
        if ($u !== '' && str_starts_with($u, 'http')) $same[] = $u;
    }
    if ($same) $node['sameAs'] = array_values(array_unique($same));

    return $node;
}

/** Сайт целиком — связывает страницы с организацией. */
function seo_node_website(): array
{
    $base = seo_base();
    return [
        '@type'      => 'WebSite',
        '@id'        => $base . '/#website',
        'url'        => $base,
        'name'       => (string)c('site.brand', 'AXIOMANTIC'),
        'inLanguage' => 'ru-RU',
        'publisher'  => ['@id' => $base . '/#organization'],
    ];
}

/** Текущая страница. */
function seo_node_webpage(string $slug, string $key, array $crumbs): array
{
    $base = seo_base();
    $url  = seo_url($slug);

    $node = [
        '@type'       => $slug === 'contacts' ? 'ContactPage' : 'WebPage',
        '@id'         => $url . '#webpage',
        'url'         => $url,
        'name'        => seo_title($key),
        'description' => seo_desc($key),
        'inLanguage'  => 'ru-RU',
        'isPartOf'    => ['@id' => $base . '/#website'],
        'about'       => ['@id' => $base . '/#organization'],
    ];

    if ($img = seo_image($key)) {
        $node['primaryImageOfPage'] = ['@type' => 'ImageObject', 'url' => $img];
    }
    if ($crumbs) {
        $node['breadcrumb'] = ['@id' => $url . '#breadcrumb'];
    }
    if ($t = @filemtime(DATA_DIR . '/content.json')) {
        $node['dateModified'] = date('c', $t);
    }

    return $node;
}

/** Цепочка хлебных крошек в разметке. */
function seo_node_breadcrumb(string $slug, array $crumbs): array
{
    $items = [];
    foreach ($crumbs as $i => $cr) {
        $items[] = [
            '@type'    => 'ListItem',
            'position' => $i + 1,
            'name'     => $cr['name'],
            'item'     => $cr['url'],
        ];
    }

    return [
        '@type'           => 'BreadcrumbList',
        '@id'             => seo_url($slug) . '#breadcrumb',
        'itemListElement' => $items,
    ];
}

/** Вопросы и ответы: Яндекс разворачивает их прямо в выдаче. */
function seo_node_faq(string $slug): ?array
{
    $list = [];
    foreach ((array)c('faq.items', []) as $q) {
        $question = trim((string)($q['q'] ?? ''));
        $answer   = trim((string)($q['a'] ?? ''));
        if ($question === '' || $answer === '') continue;

        $list[] = [
            '@type'          => 'Question',
            'name'           => $question,
            'acceptedAnswer' => ['@type' => 'Answer', 'text' => $answer],
        ];
    }
    if (!$list) return null;

    return [
        '@type'      => 'FAQPage',
        '@id'        => seo_url($slug) . '#faq',
        'mainEntity' => $list,
    ];
}

/** Услуги с ценами — сниппет может показать «30 000 ₽». */
function seo_node_services(string $slug, string $path): ?array
{
    $base = seo_base();
    $list = [];
    $pos  = 0;

    foreach ((array)c($path, []) as $s) {
        $name = trim((string)($s['name'] ?? ''));
        if ($name === '') continue;
        $pos++;

        $service = [
            '@type'    => 'Service',
            'name'     => $name,
            'provider' => ['@id' => $base . '/#organization'],
        ];
        if ($txt = trim((string)($s['text'] ?? ''))) $service['description'] = $txt;
        if ($city = trim((string)c('seo.org_city'))) $service['areaServed'] = $city;

        // «По задаче» цифр не содержит — тогда предложение не размечаем
        $price = seo_price_number((string)($s['price'] ?? ''));
        if ($price !== '') {
            $service['offers'] = [
                '@type'         => 'Offer',
                'price'         => $price,
                'priceCurrency' => 'RUB',
                'availability'  => 'https://schema.org/InStock',
                'url'           => seo_url('services'),
            ];
        }

        $list[] = ['@type' => 'ListItem', 'position' => $pos, 'item' => $service];
    }
    if (!$list) return null;

    return [
        '@type'           => 'ItemList',
        '@id'             => seo_url($slug) . '#services',
        'name'            => trim((string)c('services.title')) ?: 'Услуги',
        'itemListElement' => $list,
    ];
}

/** Портфолио: список работ студии. */
function seo_node_portfolio(string $slug): ?array
{
    $base = seo_base();
    $list = [];
    $pos  = 0;

    foreach ((array)c('work.items', []) as $p) {
        $name = trim((string)($p['name'] ?? ''));
        if ($name === '') continue;
        $pos++;

        $work = [
            '@type'   => 'CreativeWork',
            'name'    => $name,
            'creator' => ['@id' => $base . '/#organization'],
        ];

        $desc = trim((string)($p['description'] ?? '')) ?: trim((string)($p['short'] ?? ''));
        if ($desc !== '')                            $work['description'] = $desc;
        if ($u = trim((string)($p['url'] ?? '')))    $work['url'] = $u;
        if ($cat = trim((string)($p['category'] ?? ''))) $work['genre'] = $cat;
        if ($img = trim((string)($p['image'] ?? ''))) {
            $work['image'] = $base . '/' . ltrim($img, '/');
        }

        $list[] = ['@type' => 'ListItem', 'position' => $pos, 'item' => $work];
    }
    if (!$list) return null;

    return [
        '@type'           => 'ItemList',
        '@id'             => seo_url($slug) . '#portfolio',
        'name'            => trim((string)c('work.title')) ?: 'Портфолио',
        'itemListElement' => $list,
    ];
}

/**
 * Вся микроразметка страницы одним графом.
 *
 * Раньше отдавался одиночный ProfessionalService. Граф связывает сущности
 * через @id, поэтому поисковик понимает: это одна и та же компания,
 * вот её сайт, вот конкретная страница и её место в структуре.
 */
function seo_jsonld(string $slug = '', string $key = 'home'): string
{
    $crumbs = seo_crumbs($slug);

    $graph = [
        seo_node_org(),
        seo_node_website(),
        seo_node_webpage($slug, $key, $crumbs),
    ];

    if ($crumbs) $graph[] = seo_node_breadcrumb($slug, $crumbs);

    // Вопросы выводятся на главной и в контактах — размечаем их там же
    if ($slug === '' || $slug === 'contacts') {
        if ($n = seo_node_faq($slug)) $graph[] = $n;
    }

    if ($slug === 'services') {
        if ($n = seo_node_services($slug, 'services.items')) $graph[] = $n;
    } elseif ($slug === '') {
        if ($n = seo_node_services($slug, 'home_services.items')) $graph[] = $n;
    }

    if ($slug === 'projects' || $slug === '') {
        if ($n = seo_node_portfolio($slug)) $graph[] = $n;
    }

    return json_encode(
        ['@context' => 'https://schema.org', '@graph' => $graph],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
}

/* ==================== Карта сайта ==================== */

/** Страницы для карты сайта: slug => [приоритет, частота, ключ настроек]. */
function seo_pages(): array
{
    return [
        ''          => ['1.0', 'weekly',  'home'],
        'projects'  => ['0.9', 'weekly',  'work'],
        'services'  => ['0.9', 'monthly', 'services'],
        'contacts'  => ['0.7', 'monthly', 'contacts'],
        'privacy'   => ['0.2', 'yearly',  'privacy'],
        'consent'   => ['0.2', 'yearly',  'consent'],
    ];
}

/** Отдаёт sitemap.xml и завершает выполнение. */
function seo_render_sitemap(): never
{
    if (empty(c('seo.sitemap_on'))) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        exit("Карта сайта отключена в настройках\n");
    }

    $mtime   = @filemtime(DATA_DIR . '/content.json') ?: time();
    $lastmod = date('Y-m-d', $mtime);

    header('Content-Type: application/xml; charset=utf-8');
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('X-Robots-Tag: noindex');

    // Робот спрашивает «менялось ли с прошлого раза» и при 304 не качает файл
    $ims = strtotime((string)($_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '')) ?: 0;
    if ($ims && $ims >= $mtime) {
        http_response_code(304);
        exit;
    }

    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
       . ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";

    foreach (seo_pages() as $slug => [$priority, $freq, $key]) {
        if (seo_noindex($key)) continue;

        echo "  <url>\n";
        echo '    <loc>' . e(seo_url($slug)) . "</loc>\n";
        echo '    <lastmod>' . $lastmod . "</lastmod>\n";
        echo '    <changefreq>' . $freq . "</changefreq>\n";
        echo '    <priority>' . $priority . "</priority>\n";

        // Работы отдаём вместе со страницей портфолио —
        // так они попадают в поиск по картинкам
        if ($slug === 'projects') {
            foreach ((array)c('work.items', []) as $p) {
                $img = trim((string)($p['image'] ?? ''));
                if ($img === '') continue;

                echo "    <image:image>\n";
                echo '      <image:loc>' . e(seo_base() . '/' . ltrim($img, '/')) . "</image:loc>\n";
                if ($t = trim((string)($p['name'] ?? ''))) {
                    echo '      <image:title>' . e($t) . "</image:title>\n";
                }
                echo "    </image:image>\n";
            }
        }

        echo "  </url>\n";
    }

    echo '</urlset>';
    exit;
}

/* ==================== robots.txt ==================== */

/**
 * Параметры, которые не меняют содержимое страницы.
 *
 * Директива Clean-param решает конкретную боль: Директ дописывает к адресу
 * yclid, и Яндекс считает /?yclid=123 отдельной страницей. Тысяча кликов —
 * тысяча дублей главной, исходная страница проседает.
 */
function seo_clean_params(): array
{
    return [
        'yclid', 'ymclid', 'yadclid', 'yadordid', 'gclid', 'fbclid',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'utm_referrer', '_openstat', 'from', 'roistat', 'etext', 'calltouch_tm',
    ];
}

/** Отдаёт robots.txt и завершает выполнение. */
function seo_render_robots(): never
{
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Robots-Tag: noindex');

    $custom = trim((string)c('seo.robots_txt'));

    if (!empty(c('seo.noindex_all'))) {
        echo "User-agent: *\nDisallow: /\n";
        exit;
    }

    if ($custom !== '') {
        echo $custom . "\n";
    } else {
        $closed = ['/admin/', '/api/', '/install.php', '/data/', '/inc/'];

        echo "User-agent: *\n";
        foreach ($closed as $d) echo "Disallow: {$d}\n";
        echo "Allow: /assets/\n";
        echo "Allow: /uploads/\n";
        echo "\n";

        // Отдельная секция: Clean-param понимает только Яндекс,
        // в общей секции остальные роботы сочли бы её ошибкой
        echo "User-agent: Yandex\n";
        foreach ($closed as $d) echo "Disallow: {$d}\n";
        echo "Allow: /assets/\n";
        echo "Allow: /uploads/\n";
        foreach (array_chunk(seo_clean_params(), 8) as $chunk) {
            echo 'Clean-param: ' . implode('&', $chunk) . " /\n";
        }
        echo "\n";
    }

    if (!empty(c('seo.sitemap_on')) && !str_contains($custom, 'Sitemap:')) {
        echo 'Sitemap: ' . seo_url('sitemap.xml') . "\n";
    }
    exit;
}
