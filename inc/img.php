<?php
declare(strict_types=1);
require_once __DIR__ . '/webp.php';

/**
 * Вывод картинок.
 *
 * Делает три вещи, которых не хватало в шаблонах:
 *
 * 1. Отдаёт WebP тем, кто его понимает, а остальным — исходный файл.
 * 2. Проставляет width и height. Без них браузер не знает высоту картинки
 *    заранее, текст под ней прыгает при загрузке — это CLS, один из трёх
 *    показателей, по которым Яндекс оценивает удобство сайта.
 * 3. Отмечает картинку первого экрана как приоритетную, остальные — как
 *    отложенные, чтобы они не отнимали канал у главного.
 */

/** Размеры картинки, посчитанные один раз за запрос. */
function img_size(string $file): array
{
    static $cache = [];

    if (!isset($cache[$file])) {
        $s = @getimagesize($file);
        $cache[$file] = $s ? ['w' => (int)$s[0], 'h' => (int)$s[1]] : ['w' => 0, 'h' => 0];
    }

    return $cache[$file];
}

/**
 * Готовый тег картинки.
 *
 * @param string $src путь от корня сайта: assets/img/foo.png
 * @param string $alt описание для поиска по картинкам и для читалок экрана
 * @param array{
 *     class?: string,
 *     lcp?: bool,
 *     sizes?: string,
 *     width?: int,
 *     height?: int,
 *     attrs?: string
 * } $opt lcp — картинка первого экрана, грузится в первую очередь
 */
function img_html(string $src, string $alt, array $opt = []): string
{
    $src = ltrim(trim($src), '/');
    if ($src === '') return '';

    $file  = ROOT . '/' . $src;
    $mtime = @filemtime($file) ?: 0;
    $ver   = $mtime ? '?v=' . $mtime : '';

    $size = img_size($file);
    $w = (int)($opt['width']  ?? $size['w']);
    $h = (int)($opt['height'] ?? $size['h']);

    $isLcp = !empty($opt['lcp']);

    $attrs = [];
    if (!empty($opt['class'])) $attrs[] = 'class="' . e($opt['class']) . '"';
    $attrs[] = 'src="' . e(url($src) . $ver) . '"';
    $attrs[] = 'alt="' . e($alt) . '"';
    if ($w > 0 && $h > 0) {
        $attrs[] = 'width="' . $w . '"';
        $attrs[] = 'height="' . $h . '"';
    }
    // Картинка первого экрана грузится сразу, остальные — по мере прокрутки
    $attrs[] = $isLcp ? 'fetchpriority="high"' : 'loading="lazy"';
    $attrs[] = 'decoding="async"';
    if (!empty($opt['sizes'])) $attrs[] = 'sizes="' . e($opt['sizes']) . '"';
    if (!empty($opt['attrs'])) $attrs[] = trim((string)$opt['attrs']);

    $img = '<img ' . implode(' ', $attrs) . '>';

    $webp = webp_path($file);
    if (!is_file($webp)) return $img;

    $wver = ($t = @filemtime($webp)) ? '?v=' . $t : '';

    return '<picture>'
         . '<source srcset="' . e(url($src) . '.webp' . $wver) . '" type="image/webp">'
         . $img
         . '</picture>';
}

/** Путь к WebP-двойнику для preload в <head>, если он есть. */
function img_preload_src(string $src): array
{
    $src  = ltrim(trim($src), '/');
    if ($src === '') return ['', ''];

    $file = ROOT . '/' . $src;
    if (is_file(webp_path($file))) {
        return [$src . '.webp', 'image/webp'];
    }

    return [$src, ''];
}
