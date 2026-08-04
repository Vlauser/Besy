<?php
declare(strict_types=1);
require_once __DIR__ . '/store.php';

/**
 * SEO: сборка мета-тегов, карты сайта и robots.txt.
 * Всё берётся из админки, раздел «Настройки → SEO».
 */

/** Основной адрес сайта без слэша в конце. */
function seo_base(): string
{
    $host = trim((string)c('seo.canonical_host'));
    if ($host === '') return SITE_URL . BASE_PATH;
    return rtrim($host, '/');
}

/** Полный адрес страницы по её slug. */
function seo_url(string $slug = ''): string
{
    $slug = trim($slug, '/');
    return seo_base() . ($slug === '' ? '/' : '/' . $slug);
}

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

/** Страницы для карты сайта: slug => приоритет. */
function seo_pages(): array
{
    return [
        ''          => ['1.0', 'weekly'],
        'projects'  => ['0.8', 'monthly'],
        'services'  => ['0.8', 'monthly'],
        'contacts'  => ['0.6', 'yearly'],
        'privacy'   => ['0.2', 'yearly'],
        'consent'   => ['0.2', 'yearly'],
    ];
}

/** Микроразметка организации — помогает поисковику понять, кто вы. */
function seo_jsonld(): string
{
    $name = trim((string)c('seo.org_name')) ?: (string)c('site.brand', 'AXIOMANTIC');

    $data = [
        '@context' => 'https://schema.org',
        '@type'    => 'ProfessionalService',
        'name'     => $name,
        'url'      => seo_base(),
        'description' => seo_desc('home'),
    ];

    if ($img = seo_image('home'))                  $data['image'] = $img;
    if ($p = trim((string)c('seo.org_price')))     $data['priceRange'] = $p;
    if ($y = trim((string)c('seo.org_founded')))   $data['foundingDate'] = $y;
    if ($e = trim((string)c('site.email')))        $data['email'] = $e;

    if ($city = trim((string)c('seo.org_city'))) {
        $data['address'] = ['@type' => 'PostalAddress', 'addressLocality' => $city];
        $data['areaServed'] = $city;
    }

    $same = [];
    foreach ((array)c('site.channels', []) as $ch) {
        $u = trim((string)($ch['url'] ?? ''));
        if ($u !== '' && str_starts_with($u, 'http')) $same[] = $u;
    }
    if ($same) $data['sameAs'] = array_values(array_unique($same));

    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Отдаёт sitemap.xml и завершает выполнение. */
function seo_render_sitemap(): never
{
    if (empty(c('seo.sitemap_on'))) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        exit("Карта сайта отключена в настройках\n");
    }

    $lastmod = date('Y-m-d', @filemtime(DATA_DIR . '/content.json') ?: time());

    header('Content-Type: application/xml; charset=utf-8');
    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

    foreach (seo_pages() as $slug => [$priority, $freq]) {
        $key = $slug === '' ? 'home' : ($slug === 'projects' ? 'work' : $slug);
        if (seo_noindex($key)) continue;

        echo "  <url>\n";
        echo '    <loc>' . e(seo_url($slug)) . "</loc>\n";
        echo '    <lastmod>' . $lastmod . "</lastmod>\n";
        echo '    <changefreq>' . $freq . "</changefreq>\n";
        echo '    <priority>' . $priority . "</priority>\n";
        echo "  </url>\n";
    }

    echo '</urlset>';
    exit;
}

/** Отдаёт robots.txt и завершает выполнение. */
function seo_render_robots(): never
{
    header('Content-Type: text/plain; charset=utf-8');

    $custom = trim((string)c('seo.robots_txt'));

    if (!empty(c('seo.noindex_all'))) {
        echo "User-agent: *\nDisallow: /\n";
        exit;
    }

    if ($custom !== '') {
        echo $custom . "\n";
    } else {
        echo "User-agent: *\n";
        echo "Allow: /\n";
        echo "Disallow: /admin/\n";
        echo "Disallow: /api/\n";
        echo "Disallow: /install.php\n";
    }

    if (!empty(c('seo.sitemap_on')) && !str_contains($custom, 'Sitemap:')) {
        echo "\nSitemap: " . seo_url('sitemap.xml') . "\n";
    }
    exit;
}
