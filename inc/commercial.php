<?php
declare(strict_types=1);

/**
 * Коммерческие посадочные: /landing, /landing-price, /website-for-lawyers и другие.
 *
 * Страницы лежат в общем контенте (раздел «Коммерческие страницы» в админке),
 * поэтому правятся без программиста, попадают в резервные копии и переживают
 * обновление сборки наравне с остальным содержимым.
 *
 * Списки внутри страницы редактируются построчно: «слева | справа».
 * Вложенные списки админка не умеет, а такая запись остаётся понятной
 * человеку и разбирается однозначно.
 */

/** Строки вида «Заголовок | Текст» → список пар. */
function commercial_pairs(array $lines, string $keyA, string $keyB): array
{
    $out = [];
    foreach ($lines as $line) {
        $line = trim((string)$line);
        if ($line === '') continue;

        $parts = explode('|', $line, 2);
        $a = trim($parts[0]);
        $b = isset($parts[1]) ? trim($parts[1]) : '';
        if ($a === '' && $b === '') continue;

        $out[] = [$keyA => $a, $keyB => $b];
    }
    return $out;
}

/** Непустые строки списка. */
function commercial_lines($value): array
{
    $out = [];
    foreach ((array)$value as $line) {
        $line = trim((string)$line);
        if ($line !== '') $out[] = $line;
    }
    return $out;
}

/** Все страницы: ключ адреса => готовая к выводу структура. */
function commercial_pages(): array
{
    static $pages = null;
    if ($pages !== null) return $pages;

    $pages = [];
    foreach ((array)c('commercial.items', []) as $item) {
        if (!is_array($item)) continue;

        // Без адреса и заголовка страницу не построить
        $slug = trim((string)($item['slug'] ?? ''), '/');
        if ($slug === '' || trim((string)($item['h1'] ?? '')) === '') continue;

        $item['facts']        = commercial_lines($item['facts'] ?? []);
        $item['fit']          = commercial_lines($item['fit'] ?? []);
        $item['projectSlugs'] = commercial_lines($item['projectSlugs'] ?? []);
        $item['included']     = commercial_pairs(commercial_lines($item['included'] ?? []), 'title', 'text');
        $item['steps']        = commercial_pairs(commercial_lines($item['steps'] ?? []), 'title', 'text');
        $item['faq']          = commercial_pairs(commercial_lines($item['faq'] ?? []), 'question', 'answer');
        $item['related']      = commercial_pairs(commercial_lines($item['related'] ?? []), 'href', 'label');

        $pages[$slug] = $item;
    }

    return $pages;
}

/** Одна страница по адресу или null. */
function commercial_page(string $slug): ?array
{
    $page = commercial_pages()[trim($slug, '/')] ?? null;
    return is_array($page) ? $page : null;
}
