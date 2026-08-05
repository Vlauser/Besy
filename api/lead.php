<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/inc/store.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function fail(string $msg, int $code = 400): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail('Метод не поддерживается', 405);
}

$raw = file_get_contents('php://input') ?: '';
$in  = json_decode($raw, true);
if (!is_array($in)) $in = $_POST;

/* --- Ловушка для ботов: поле скрыто, живой человек его не заполнит --- */
if (trim((string)($in['website'] ?? '')) !== '') {
    echo json_encode(['ok' => true]);   // Боту показываем успех, заявку не сохраняем
    exit;
}

/* --- Ограничение частоты: не больше 5 заявок с одного IP в час --- */
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$rl = store_read('ratelimit', []);
$key = md5($ip);
$now = time();
$rec = $rl[$key] ?? ['count' => 0, 'start' => $now];

if ($now - $rec['start'] > 3600) $rec = ['count' => 0, 'start' => $now];
if ($rec['count'] >= 5) fail('Слишком много заявок. Напишите нам в Telegram.', 429);

$rec['count']++;
$rl[$key] = $rec;
foreach ($rl as $k => $v) {
    if ($now - ($v['start'] ?? 0) > 7200) unset($rl[$k]);
}
store_write('ratelimit', $rl);

/* --- Проверка полей --- */
$clean = function ($v, int $max = 2000): string {
    $v = trim((string)$v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $v) ?? '';
    return mb_substr($v, 0, $max);
};

$name    = $clean($in['name'] ?? '', 120);
$contact = $clean($in['contact'] ?? '', 160);
$service = $clean($in['service'] ?? '', 160);
$message = $clean($in['message'] ?? '', 4000);
$form    = $clean($in['form'] ?? 'site', 40);
$page    = $clean($in['page'] ?? '', 200);

if ($contact === '') fail('Укажите, как с вами связаться');
if ($name !== '' && mb_strlen($name) < 2) fail('Слишком короткое имя');

/* --- Согласие по 152-ФЗ: без него заявку не принимаем --- */
if (empty($in['agree'])) {
    fail('Без согласия на обработку персональных данных мы не можем принять заявку');
}
$agreeText = $clean($in['agree_text'] ?? '', 500);
if ($agreeText === '') $agreeText = (string)c('forms.agree');

/* --- Откуда пришёл человек ---
   Метки рекламной кампании: без них не понять, какое объявление Директа
   принесло заявку и стоит ли оно денег. Берём только известные ключи,
   всё остальное из запроса отбрасываем. */
$markKeys = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'yclid', 'gclid', 'roistat', '_openstat', 'etext',
];

$source = [];
$src = $in['source'] ?? null;

if (is_array($src)) {
    $marks = [];
    foreach ((array)($src['marks'] ?? []) as $k => $v) {
        if (!in_array($k, $markKeys, true)) continue;
        if (!is_scalar($v)) continue;
        $val = $clean($v, 200);
        if ($val !== '') $marks[$k] = $val;
    }

    if ($marks) $source['marks'] = $marks;
    if ($r = $clean($src['ref'] ?? '', 300))     $source['ref'] = $r;
    if ($l = $clean($src['landing'] ?? '', 200)) $source['landing'] = $l;
    if ($a = $clean($src['at'] ?? '', 40))       $source['at'] = $a;
    $source['repeat'] = !empty($src['repeat']);
}

/* --- Сохраняем --- */
$lead = [
    'id'      => bin2hex(random_bytes(8)),
    'date'    => date('c'),
    'name'    => $name,
    'contact' => $contact,
    'contact_mode' => in_array($in['contact_mode'] ?? '', ['call', 'write'], true)
                      ? (string)$in['contact_mode'] : '',
    'messenger'    => $clean($in['messenger'] ?? '', 40),
    'service' => $service,
    'message' => $message,
    'form'    => $form,
    'page'    => $page,
    'ip'      => $ip,
    'ua'      => mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
    'ref'     => mb_substr((string)($_SERVER['HTTP_REFERER'] ?? ''), 0, 200),
    'done'    => false,

    // Рекламная кампания, приведшая человека на сайт
    'source'  => $source,

    // Подтверждение согласия — на случай проверки по 152-ФЗ
    'agree'      => true,
    'agree_text' => $agreeText,
    'policy_rev' => (string)c('legal.privacy_updated'),

    // Отдельное согласие на рекламу по ч.1 ст.18 38-ФЗ «О рекламе»
    'marketing'  => !empty($in['marketing']),
];

if (!lead_add($lead)) fail('Не удалось сохранить заявку', 500);

/* --- Уведомление в Telegram --- */
$token = trim((string)c('integrations.telegram_token'));
$chat  = trim((string)c('integrations.telegram_chat_id'));

if ($token !== '' && $chat !== '') {
    $lines = [
        '🔔 *Новая заявка*',
        '',
        '*Имя:* ' . ($name !== '' ? $name : 'не указано'),
        '*Контакт:* ' . $contact . ($lead['contact_mode'] === 'call'
            ? ' — просит позвонить'
            : ($lead['messenger'] !== '' ? ' — написать в ' . $lead['messenger'] : '')),
    ];
    if ($service !== '') $lines[] = '*Услуга:* ' . $service;
    if ($message !== '') $lines[] = '*Задача:* ' . $message;

    // Реклама: сразу видно, окупается ли кампания
    if (!empty($source['marks'])) {
        $m = $source['marks'];
        $campaign = trim(implode(' / ', array_filter([
            $m['utm_source']   ?? '',
            $m['utm_medium']   ?? '',
            $m['utm_campaign'] ?? '',
        ])));
        if ($campaign !== '') $lines[] = '*Реклама:* ' . $campaign;
        if (!empty($m['utm_term'])) $lines[] = '*Запрос:* ' . $m['utm_term'];
        if (!empty($m['yclid']))    $lines[] = '*yclid:* ' . $m['yclid'];
    } elseif (!empty($source['ref'])) {
        $lines[] = '*Переход с:* ' . $source['ref'];
    }

    $lines[] = '';
    $lines[] = '_' . date('d.m.Y H:i') . ' · ' . ($page !== '' ? $page : '/') . '_';

    $text = implode("\n", $lines);
    // Экранируем спецсимволы Markdown, кроме наших звёздочек и подчёркиваний
    $text = str_replace(['[', ']', '`'], ['(', ')', "'"], $text);

    $payload = http_build_query([
        'chat_id'    => $chat,
        'text'       => $text,
        'parse_mode' => 'Markdown',
    ]);

    $url = "https://api.telegram.org/bot{$token}/sendMessage";

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 6,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_exec($ch);
        curl_close($ch);
    } else {
        @file_get_contents($url, false, stream_context_create([
            'http' => [
                'method'        => 'POST',
                'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
                'content'       => $payload,
                'timeout'       => 6,
                'ignore_errors' => true,
            ],
        ]));
    }
}

/* --- Дублирование на почту --- */
$mailTo = trim((string)c('integrations.notify_email'));
if ($mailTo !== '' && filter_var($mailTo, FILTER_VALIDATE_EMAIL)) {
    $subject = 'Новая заявка с сайта' . ($name !== '' ? ' — ' . $name : '');
    $how = $lead['contact_mode'] === 'call' ? 'просит позвонить'
         : ($lead['messenger'] !== '' ? 'написать в ' . $lead['messenger'] : '');
    $campaign = '';
    if (!empty($source['marks'])) {
        $pairs = [];
        foreach ($source['marks'] as $k => $v) $pairs[] = "{$k}={$v}";
        $campaign = "Реклама: " . implode(', ', $pairs) . "\n";
    }

    $body = "Имя: " . ($name !== '' ? $name : 'не указано') . "\nКонтакт: {$contact}\n"
        . ($how !== '' ? "Способ связи: {$how}\n" : '')
        . ($service !== '' ? "Услуга: {$service}\n" : '')
        . ($message !== '' ? "Задача: {$message}\n" : '')
        . $campaign
        . "\nСтраница: {$page}\nДата: " . date('d.m.Y H:i');

    $headers = "From: no-reply@" . ($_SERVER['HTTP_HOST'] ?? 'localhost') . "\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n";
    @mail($mailTo, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
