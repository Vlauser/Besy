<?php
declare(strict_types=1);

/**
 * Досыпает в data/content.json разделы, которых там ещё нет.
 * Нужен после обновления, когда в шаблонах появились новые блоки,
 * а контент остался от прошлой версии.
 *
 * Запуск:  php /var/www/axiomantic/inc/seed.php
 *
 * Существующие значения не трогает — дописывает только отсутствующие ключи.
 */

$file = __DIR__ . '/../data/content.json';

if (!is_file($file)) {
    fwrite(STDERR, "Не найден $file\n");
    exit(1);
}

$data = json_decode((string)file_get_contents($file), true);
if (!is_array($data)) {
    fwrite(STDERR, "content.json повреждён — прервано\n");
    exit(1);
}

/* Значения по умолчанию для новых разделов */
$defaults = [
    'error404' => [
        'code'         => '404',
        'title'        => 'Страница не найдена',
        'text'         => "Похоже, ссылка устарела\nили страница была перемещена.",
        'btn_home'     => 'На главную',
        'btn_projects' => 'Посмотреть проекты',
        'image'        => 'assets/img/axiomantic-404-scene-v4.png',
    ],
    'success' => [
        'title'  => 'Ваша заявка отправлена',
        'text'   => 'Перезвоним вам в ближайшее время.',
        'button' => 'Хорошо',
        'image'  => 'assets/img/axiomantic-success-character.png',
    ],
    'forms' => [
        'mode_label'      => 'Как с вами связаться?',
        'mode_call'       => 'Позвонить',
        'mode_write'      => 'Написать',
        'label_phone'     => 'Номер телефона',
        'ph_phone'        => '+7 999 000-00-00',
        'label_messenger' => 'Куда вам написать?',
        'err_contact'     => 'Укажите, как с вами связаться',
        'optional_note'   => '(необязательно)',
        'label_name'      => 'Имя',
        'ph_name'         => 'Как к вам обращаться',
        'label_message'   => 'Комментарий',
        'ph_message'      => 'Можно коротко рассказать о задаче',
        'messengers'      => [
            ['key' => 'telegram', 'label' => 'Telegram', 'placeholder' => 'Ваш @username или телефон'],
            ['key' => 'max',      'label' => 'MAX',      'placeholder' => 'Ваш номер в MAX'],
        ],
    ],
    'modal' => [
        'kicker' => 'Оставить заявку',
        'title'  => 'Как с вами связаться?',
        'text'   => 'Выберите удобный способ — ответим в течение рабочего часа.',
    ],
    'site' => [
        'socials'              => [],
        'footer_socials_title' => 'Соцсети',
    ],
];

$added = [];

foreach ($defaults as $section => $fields) {
    if (!isset($data[$section]) || !is_array($data[$section])) {
        $data[$section] = $fields;
        $added[] = $section . ' (раздел целиком)';
        continue;
    }
    foreach ($fields as $key => $value) {
        if (!array_key_exists($key, $data[$section])) {
            $data[$section][$key] = $value;
            $added[] = $section . '.' . $key;
        }
    }
}

if (!$added) {
    echo "Всё на месте, добавлять нечего.\n";
    exit(0);
}

/* Копия на всякий случай */
@copy($file, $file . '.bak.json');

$json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
if ($json === false || file_put_contents($file, $json) === false) {
    fwrite(STDERR, "Не удалось записать файл. Проверьте права на папку data\n");
    exit(1);
}

echo "Добавлено:\n";
foreach ($added as $a) echo "  · $a\n";
echo "Копия прежней версии: content.json.bak.json\n";
