<?php
declare(strict_types=1);

/**
 * Пережимает все картинки сайта в WebP.
 *
 * Запуск из корня сайта:  php tools/make-webp.php
 *
 * Оригиналы не трогаются, рядом появляются файлы вида foo.png.webp.
 * Шаблоны сами отдадут WebP тем, кто его понимает. Повторный запуск
 * пропускает уже пережатое, так что гонять можно сколько угодно.
 */

require_once dirname(__DIR__) . '/inc/config.php';
require_once dirname(__DIR__) . '/inc/webp.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Только из командной строки\n");
}

if (!webp_supported()) {
    exit("PHP собран без поддержки WebP. Нужно расширение gd с включённым WebP.\n");
}

$dirs = [ROOT . '/assets/img', UPLOAD_DIR];
$before = $after = $count = 0;

foreach ($dirs as $dir) {
    if (!is_dir($dir)) continue;

    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));

    foreach ($files as $f) {
        /** @var SplFileInfo $f */
        if (!$f->isFile()) continue;
        if (!in_array(strtolower($f->getExtension()), ['png', 'jpg', 'jpeg'], true)) continue;

        $src = $f->getPathname();
        $out = webp_make($src);

        if ($out === null) {
            printf("  пропущено  %s\n", str_replace(ROOT . '/', '', $src));
            continue;
        }

        $wasSize = filesize($src);
        $nowSize = filesize($out);
        $before += $wasSize;
        $after  += $nowSize;
        $count++;

        printf(
            "  %-58s %6d КБ → %5d КБ  (−%d%%)\n",
            str_replace(ROOT . '/', '', $src),
            (int)round($wasSize / 1024),
            (int)round($nowSize / 1024),
            $wasSize > 0 ? (int)round((1 - $nowSize / $wasSize) * 100) : 0
        );
    }
}

if ($count === 0) {
    exit("Нечего пережимать.\n");
}

printf(
    "\nГотово: %d картинок, %d КБ → %d КБ, экономия %d%%\n",
    $count,
    (int)round($before / 1024),
    (int)round($after / 1024),
    (int)round((1 - $after / $before) * 100)
);
