<?php
declare(strict_types=1);

function commercial_pages(): array
{
    static $pages = null;
    if ($pages !== null) return $pages;
    $file = ROOT . '/data/commercial.json';
    if (!is_file($file)) return $pages = [];
    $decoded = json_decode((string)file_get_contents($file), true);
    return $pages = is_array($decoded) ? $decoded : [];
}

function commercial_page(string $slug): ?array
{
    $page = commercial_pages()[$slug] ?? null;
    return is_array($page) ? $page : null;
}
