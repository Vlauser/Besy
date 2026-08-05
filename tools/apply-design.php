<?php
declare(strict_types=1);

/**
 * Применение новых текстов от дизайнера.
 *
 * Запуск из корня сайта:  php tools/apply-design.php
 * Посмотреть, что изменится, ничего не трогая:
 *                         php tools/apply-design.php --dry
 *
 * Зачем нужен. tools/upgrade.php добавляет только недостающие настройки
 * и никогда не переписывает заполненные — иначе он затирал бы тексты,
 * написанные владельцем сайта. Обратная сторона: если дизайнер поменяла
 * формулировку, которая на сайте уже была, эта правка не применится.
 *
 * Скрипт разбирает такие случаи по одному:
 *
 *   значение на сайте = исходное  → правка дизайнера применяется
 *   значение на сайте изменено вами → остаётся ваше, случай попадает в отчёт
 *
 * Так ваши тексты не теряются, а всё, до чего вы не дотрагивались,
 * подтягивается к новому оформлению.
 */

require_once dirname(__DIR__) . '/inc/store.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Только из командной строки\n");
}

$dry = in_array('--dry', $argv, true);

$baseFile = DATA_DIR . '/design-base.json';
$newFile  = DATA_DIR . '/content.default.json';

foreach ([$baseFile, $newFile] as $f) {
    if (!is_file($f)) exit("Не найден " . basename($f) . " — он идёт в архиве сборки.\n");
}

$base = json_decode((string)file_get_contents($baseFile), true);
$new  = json_decode((string)file_get_contents($newFile), true);
if (!is_array($base) || !is_array($new)) exit("Файлы сборки повреждены.\n");

$data = content();
if (!$data) exit("Не найден собственный контент сайта.\n");

$applied = [];
$kept    = [];

foreach ($base as $path => $baseValue) {
    $live = arr_get($data, (string)$path, null);
    $want = arr_get($new,  (string)$path, null);

    if ($want === null || $live === null) continue;
    if ($live === $want) continue;              // уже совпадает

    if ($live === $baseValue) {
        // Владелец это поле не трогал — можно обновлять
        if (!$dry) arr_set($data, (string)$path, $want);
        $applied[] = [$path, $live, $want];
    } else {
        // Здесь текст правил владелец, его не трогаем
        $kept[] = [$path, $live, $want];
    }
}

$short = function ($v): string {
    $s = is_scalar($v) ? (string)$v : json_encode($v, JSON_UNESCAPED_UNICODE);
    $s = trim(preg_replace('/\s+/u', ' ', (string)$s) ?? '');
    return mb_strlen($s) > 60 ? mb_substr($s, 0, 57) . '…' : $s;
};

if ($applied) {
    echo ($dry ? "Будет обновлено" : "Обновлено") . ": " . count($applied) . "\n\n";
    foreach ($applied as [$p, $was, $now]) {
        echo "  {$p}\n";
        echo "    было : " . $short($was) . "\n";
        echo "    стало: " . $short($now) . "\n";
    }
    echo "\n";
}

if ($kept) {
    echo "Оставлено без изменений (здесь ваш текст, он важнее): " . count($kept) . "\n\n";
    foreach ($kept as [$p, $was, $now]) {
        echo "  {$p}\n";
        echo "    у вас        : " . $short($was) . "\n";
        echo "    предлагалось : " . $short($now) . "\n";
    }
    echo "\nЕсли какой-то из этих текстов хотите взять — поправьте вручную в админке.\n\n";
}

/* Отдельная проверка: ключи проектов на главной должны существовать
   в портфолио. Если ключ не найден, карточка молча не выводится —
   и в блоке оказывается два проекта вместо трёх. */
require_once ROOT . '/inc/view.php';
$missing = [];
foreach ((array)arr_get($data, 'projects_home.slugs', []) as $slug) {
    $slug = trim((string)$slug);
    if ($slug !== '' && !work_item($slug)) $missing[] = $slug;
}
if ($missing) {
    echo "Проекты на главной: не найдены в портфолио — " . implode(', ', $missing) . "\n";
    echo "Из-за этого в блоке «Наши работы» показывается меньше карточек, чем задано.\n";
    echo "Поправьте раздел «Проекты на главной»: ключи должны совпадать\n";
    echo "с ключами проектов в разделе «Портфолио».\n\n";
}

if (!$applied && !$kept && !$missing) {
    exit("Все тексты уже совпадают с новой версией.\n");
}

if ($dry) {
    echo "Это была проверка. Чтобы применить, запустите без --dry\n";
    exit;
}

if (!$applied) exit("Нечего применять.\n");

if (!content_save($data)) {
    exit("Не удалось записать data/content.json. Проверьте права на папку data.\n");
}

echo "Предыдущая версия сохранена как data/content.bak.json\n";
