<?php
declare(strict_types=1);

/**
 * Переводит ссылки в портфолио со сторонних адресов на свои поддомены
 * и правит название проекта PRAVO → ДОВОД.
 *
 * Запуск:  sudo -u www-data php /var/www/axiomantic/inc/fix-links.php
 *
 * Ищет проекты по slug, поэтому порядок и прочие поля не важны.
 * Уже правильные значения не трогает.
 */

$file = __DIR__ . '/../data/content.json';

if (!is_file($file)) {
    fwrite(STDERR, "Не найден $file\n");
    exit(1);
}

$data = json_decode((string)file_get_contents($file), true);
if (!is_array($data) || !isset($data['work']['items'])) {
    fwrite(STDERR, "content.json повреждён или не содержит портфолио\n");
    exit(1);
}

/* slug => [новая ссылка, новое название или null] */
$map = [
    'raid-38'        => ['https://raid38.axiomantic.ru',   null],
    'besy-esim'      => ['https://besy.axiomantic.ru',     null],
    'forma'          => ['https://forma.axiomantic.ru',    null],
    'pravo-legal'    => ['https://pravo.axiomantic.ru',    'ДОВОД'],
    'mellow-coffee'  => ['https://mellow.axiomantic.ru',   null],
    'rewind'         => ['https://rewind.axiomantic.ru',   null],
    'pottery-studio' => ['https://keramika.axiomantic.ru', null],
    'cupcake-studio' => ['https://cupcake.axiomantic.ru',  null],
];

$changed = [];

foreach ($data['work']['items'] as &$item) {
    $slug = (string)($item['slug'] ?? '');
    if (!isset($map[$slug])) continue;

    [$url, $name] = $map[$slug];

    if (($item['url'] ?? '') !== $url) {
        $item['url'] = $url;
        $changed[] = "$slug — ссылка → $url";
    }

    if ($name !== null && ($item['name'] ?? '') !== $name) {
        $changed[] = "$slug — название «" . ($item['name'] ?? '') . "» → «$name»";
        $item['name'] = $name;
    }
}
unset($item);

if (!$changed) {
    echo "Всё уже на месте, менять нечего.\n";
    exit(0);
}

@copy($file, $file . '.bak.json');

$json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
if ($json === false || file_put_contents($file, $json) === false) {
    fwrite(STDERR, "Не удалось записать файл. Проверьте права на папку data\n");
    exit(1);
}

echo "Изменено:\n";
foreach ($changed as $c) echo "  · $c\n";
echo "Копия прежней версии: content.json.bak.json\n";
