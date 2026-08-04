<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

/**
 * Простое файловое хранилище на JSON.
 * Базы данных не требуется — всё лежит в /data.
 */

function store_path(string $name): string
{
    return DATA_DIR . '/' . basename($name) . '.json';
}

function store_read(string $name, array $fallback = []): array
{
    $file = store_path($name);
    if (!is_file($file)) return $fallback;

    $fh = fopen($file, 'rb');
    if (!$fh) return $fallback;
    flock($fh, LOCK_SH);
    $raw = stream_get_contents($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : $fallback;
}

function store_write(string $name, array $data): bool
{
    if (!is_dir(DATA_DIR)) @mkdir(DATA_DIR, 0775, true);
    $file = store_path($name);

    // Резервная копия предыдущей версии — на случай неудачной правки
    if (is_file($file)) {
        @copy($file, DATA_DIR . '/' . basename($name) . '.bak.json');
    }

    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false) return false;

    // Пишем во временный файл и подменяем — так файл не рвётся при обрыве
    $tmp = $file . '.tmp';
    if (file_put_contents($tmp, $json, LOCK_EX) === false) return false;
    return rename($tmp, $file);
}

/* ---------- доступ по пути вида "axioms.items.0.title" ---------- */

function arr_get(array $arr, string $path, $default = null)
{
    $node = $arr;
    foreach (explode('.', $path) as $key) {
        if (!is_array($node) || !array_key_exists($key, $node)) return $default;
        $node = $node[$key];
    }
    return $node;
}

function arr_set(array &$arr, string $path, $value): void
{
    $node = &$arr;
    $keys = explode('.', $path);
    foreach ($keys as $key) {
        if (!isset($node[$key]) || !is_array($node[$key])) {
            if ($key !== end($keys)) $node[$key] = [];
        }
        $node = &$node[$key];
    }
    $node = $value;
}

/* ---------- контент сайта ---------- */

function content(): array
{
    static $cache = null;
    if ($cache === null) $cache = store_read('content');
    return $cache;
}

function c(string $path, $default = '')
{
    return arr_get(content(), $path, $default);
}

function content_save(array $data): bool
{
    return store_write('content', $data);
}

/* ---------- заявки ---------- */

function leads_all(): array
{
    $d = store_read('leads', ['items' => []]);
    return $d['items'] ?? [];
}

function lead_add(array $lead): bool
{
    $d = store_read('leads', ['items' => []]);
    $items = $d['items'] ?? [];
    array_unshift($items, $lead);
    if (count($items) > LEADS_LIMIT) $items = array_slice($items, 0, LEADS_LIMIT);
    return store_write('leads', ['items' => $items]);
}

function leads_save(array $items): bool
{
    return store_write('leads', ['items' => array_values($items)]);
}

function leads_new_count(): int
{
    $n = 0;
    foreach (leads_all() as $l) {
        if (empty($l['done'])) $n++;
    }
    return $n;
}
