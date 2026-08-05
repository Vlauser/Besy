<?php
declare(strict_types=1);

/**
 * Кнопка «оставить заявку».
 *
 * Открывает всплывающее окно с формой. Так человеку не нужно
 * прокручивать страницу вниз и терять то, что он читал.
 *
 * @param string $label текст кнопки; пустой — кнопка не выводится
 * @param string $class классы оформления
 */
function cta_button(string $label, string $class): string
{
    $label = trim($label);
    if ($label === '') return '';

    return '<button type="button" data-ax-open class="' . e($class) . '">'
         . e($label) . '</button>';
}

/**
 * Проект портфолио по его ключу.
 *
 * Ключ берётся из адреса /projects/<ключ>, поэтому пустой или неизвестный
 * ключ должен вернуть null — роутер покажет 404, а не пустую страницу.
 */
function work_item(string $slug): ?array
{
    $slug = trim($slug);
    if ($slug === '') return null;

    foreach ((array)c('work.items', []) as $i => $item) {
        if (!is_array($item)) continue;
        if (trim((string)($item['slug'] ?? '')) === $slug) {
            $item['_index'] = $i;
            return $item;
        }
    }

    return null;
}

/** Соседние проекты — для переходов внизу страницы. */
function work_neighbours(int $index): array
{
    $items = array_values(array_filter(
        (array)c('work.items', []),
        fn($i) => is_array($i) && trim((string)($i['slug'] ?? '')) !== ''
    ));
    $total = count($items);
    if ($total < 2) return ['prev' => null, 'next' => null];

    // По кругу: с последнего проекта «дальше» ведёт на первый
    return [
        'prev' => $items[($index - 1 + $total) % $total] ?? null,
        'next' => $items[($index + 1) % $total] ?? null,
    ];
}

/** Ссылка на страницу проекта внутри сайта. */
function work_url(string $slug): string
{
    return url('projects/' . trim($slug, '/'));
}

/* ==================== Блог ==================== */

/**
 * Опубликованные статьи, свежие сверху.
 *
 * Черновики и записи без адреса не показываются нигде: ни в списке,
 * ни по прямой ссылке, ни в карте сайта.
 */
function blog_posts(): array
{
    static $cache = null;
    if ($cache !== null) return $cache;

    $out = [];
    foreach ((array)c('blog.items', []) as $p) {
        if (!is_array($p)) continue;
        if (!empty($p['draft'])) continue;
        if (trim((string)($p['slug'] ?? '')) === '') continue;
        if (trim((string)($p['title'] ?? '')) === '') continue;
        $out[] = $p;
    }

    // Свежие вперёд; статьи без даты уходят в конец
    usort($out, function ($a, $b) {
        return strcmp(trim((string)($b['date'] ?? '')), trim((string)($a['date'] ?? '')));
    });

    return $cache = $out;
}

/** Статья по адресу. */
function blog_post(string $slug): ?array
{
    $slug = trim($slug);
    if ($slug === '') return null;

    foreach (blog_posts() as $i => $p) {
        if (trim((string)$p['slug']) === $slug) {
            $p['_index'] = $i;
            return $p;
        }
    }

    return null;
}

/** Ссылка на статью. */
function blog_url(string $slug): string
{
    return url('blog/' . trim($slug, '/'));
}

/** Дата статьи по-человечески: 5 августа 2026. */
function blog_date(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') return '';

    $ts = strtotime($raw);
    if ($ts === false) return $raw;

    $months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
               'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    return (int)date('j', $ts) . ' ' . $months[(int)date('n', $ts) - 1] . ' ' . date('Y', $ts);
}

/**
 * Есть ли в разделе хоть что-то заполненное.
 *
 * Правило всего сайта: очистили все поля блока в админке — блок
 * не выводится. Иначе на странице остаётся пустая полоса с отступами,
 * и человеку кажется, что сайт сломался.
 *
 * @param string ...$paths пути к настройкам: 'hero.title_1', 'faq.items'
 */
function has_any(string ...$paths): bool
{
    foreach ($paths as $path) {
        $v = c($path);

        if (is_array($v)) {
            // Список считается заполненным, если хоть в одном пункте есть текст
            foreach ($v as $item) {
                if (is_array($item)) {
                    foreach ($item as $field) {
                        if (is_string($field) && trim($field) !== '') return true;
                    }
                } elseif (is_string($item) && trim($item) !== '') {
                    return true;
                }
            }
            continue;
        }

        if (trim((string)$v) !== '') return true;
    }

    return false;
}
