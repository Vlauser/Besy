<?php
declare(strict_types=1);

/**
 * Обновление контента до новой версии сборки.
 *
 * Запуск из корня сайта:  php tools/upgrade.php
 *
 * Зачем нужен. В новой сборке появились разделы, которых на сайте
 * ещё нет: страница цены, отзывы, поля проектов. Просто заменить
 * data/content.json нельзя — вместе с ним потеряются все тексты,
 * которые правили через админку.
 *
 * Что делает: берёт ваш data/content.json и дописывает в него только
 * недостающие ключи из data/content.default.json. Ни одно заполненное
 * значение не трогается. Списки (проекты, услуги, вопросы) остаются
 * вашими целиком.
 *
 * Запускать можно сколько угодно раз: второй запуск ничего не меняет.
 */

require_once dirname(__DIR__) . '/inc/store.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Только из командной строки\n");
}

$defaultFile = DATA_DIR . '/content.default.json';
if (!is_file($defaultFile)) {
    exit("Не найден data/content.default.json — он идёт в архиве сборки.\n");
}

$defaults = json_decode((string)file_get_contents($defaultFile), true);
if (!is_array($defaults)) {
    exit("data/content.default.json повреждён.\n");
}

$current = store_read('content');

if (!$current) {
    echo "Своего контента нет — ставим сборку целиком.\n";
    $current = [];
}

/**
 * Дописывает недостающее, не трогая заполненное.
 *
 * Списки (проекты, услуги, вопросы) не сливаются по элементам:
 * порядок и состав — ваши, новые поля внутри карточек просто
 * останутся пустыми, а пустое поле сайт не показывает.
 *
 * @param array $target ваш контент
 * @param array $source контент из сборки
 * @param string $path  для отчёта
 */
function merge_missing(array $target, array $source, string $path, array &$added): array
{
    foreach ($source as $key => $value) {
        $here = $path === '' ? (string)$key : $path . '.' . $key;

        if (!array_key_exists($key, $target)) {
            $target[$key] = $value;
            $added[] = $here;
            continue;
        }

        // Оба — словари: идём внутрь. Списки оставляем как есть
        if (is_array($value) && is_array($target[$key])
            && !array_is_list($value) && !array_is_list($target[$key])) {
            $target[$key] = merge_missing($target[$key], $value, $here, $added);
        }
    }

    return $target;
}

$added = [];
$merged = merge_missing($current, $defaults, '', $added);

if (!$added) {
    exit("Всё на месте, добавлять нечего.\n");
}

if (!content_save($merged)) {
    exit("Не удалось записать data/content.json. Проверьте права на папку data.\n");
}

echo "Добавлено настроек: " . count($added) . "\n";

// Показываем только верхние уровни, иначе список на сотню строк
$tops = [];
foreach ($added as $a) {
    $tops[explode('.', $a)[0]] = true;
}
echo "Затронутые разделы: " . implode(', ', array_keys($tops)) . "\n";
echo "Предыдущая версия сохранена как data/content.bak.json\n";
