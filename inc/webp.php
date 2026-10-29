<?php
declare(strict_types=1);

/**
 * Пережатие картинок в WebP.
 *
 * WebP весит в 5–10 раз меньше PNG при том же виде. Оригинал остаётся
 * на месте и отдаётся старым браузерам, поэтому ничего не ломается.
 *
 * Вызывается из двух мест: admin/upload.php — для новых картинок,
 * tools/make-webp.php — разом для всех уже лежащих.
 */

/** Умеет ли сервер в WebP. */
function webp_supported(): bool
{
    if (!function_exists('imagewebp')) return false;
    $info = function_exists('gd_info') ? gd_info() : [];
    return !empty($info['WebP Support']);
}

/** Путь к WebP-двойнику: foo.png → foo.png.webp */
function webp_path(string $file): string
{
    return $file . '.webp';
}

/**
 * Делает WebP рядом с оригиналом.
 *
 * @param string $file    абсолютный путь к картинке
 * @param int    $quality 1–100, для иллюстраций 82 неотличимо от оригинала
 * @return string|null путь к готовому файлу или null, если не получилось
 */
function webp_make(string $file, int $quality = 82): ?string
{
    if (!webp_supported() || !is_file($file)) return null;

    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if (!in_array($ext, ['png', 'jpg', 'jpeg'], true)) return null;

    $out = webp_path($file);

    // Уже есть и не старше оригинала — второй раз не жмём
    if (is_file($out) && filemtime($out) >= filemtime($file)) return $out;

    $img = match ($ext) {
        'png'          => @imagecreatefrompng($file),
        'jpg', 'jpeg'  => @imagecreatefromjpeg($file),
        default        => false,
    };
    if (!$img) return null;

    // Палитровый PNG в WebP не переводится напрямую
    if (!imageistruecolor($img)) imagepalettetotruecolor($img);

    // Без этого прозрачный фон станет чёрным
    imagealphablending($img, false);
    imagesavealpha($img, true);

    $ok = @imagewebp($img, $out, $quality);
    imagedestroy($img);

    if (!$ok) {
        @unlink($out);
        return null;
    }

    // Изредка WebP выходит тяжелее оригинала — тогда он не нужен
    if (filesize($out) >= filesize($file)) {
        @unlink($out);
        return null;
    }

    return $out;
}
