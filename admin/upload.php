<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/inc/auth.php';
require_once dirname(__DIR__) . '/inc/webp.php';

/**
 * Загрузка картинок из админки.
 * Только для авторизованных, с проверкой CSRF, типа и размера файла.
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function up_fail(string $msg, int $code = 400): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

auth_start();
if (!current_user())                              up_fail('Нужно войти заново', 401);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') up_fail('Метод не поддерживается', 405);

/* CSRF — токен приходит тем же полем, что и в формах */
$sent = $_POST['_csrf'] ?? '';
if (!is_string($sent) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
    up_fail('Сессия устарела, обновите страницу', 419);
}

if (!isset($_FILES['file']) || !is_array($_FILES['file'])) up_fail('Файл не получен');

$f = $_FILES['file'];

if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    $map = [
        UPLOAD_ERR_INI_SIZE   => 'Файл больше, чем разрешает сервер (upload_max_filesize)',
        UPLOAD_ERR_FORM_SIZE  => 'Файл слишком большой',
        UPLOAD_ERR_PARTIAL    => 'Файл загрузился не полностью',
        UPLOAD_ERR_NO_FILE    => 'Файл не выбран',
        UPLOAD_ERR_NO_TMP_DIR => 'На сервере нет временной папки',
        UPLOAD_ERR_CANT_WRITE => 'Сервер не смог записать файл',
    ];
    up_fail($map[$f['error']] ?? 'Ошибка загрузки');
}

if (!is_uploaded_file($f['tmp_name'])) up_fail('Некорректная загрузка');

/* Размер */
$maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
if (($f['size'] ?? 0) > $maxBytes) {
    up_fail('Файл больше ' . MAX_UPLOAD_MB . ' МБ');
}

/* Расширение */
$name = (string)($f['name'] ?? '');
$ext  = strtolower((string)pathinfo($name, PATHINFO_EXTENSION));
if (!in_array($ext, ALLOWED_IMG, true)) {
    up_fail('Можно загружать только: ' . implode(', ', ALLOWED_IMG));
}

/* Содержимое действительно картинка. SVG проверяем отдельно — getimagesize его не читает */
if ($ext === 'svg') {
    $svg = (string)file_get_contents($f['tmp_name'], false, null, 0, 200000);
    // В SVG может быть скрипт — такие файлы не принимаем
    if (preg_match('/<script|javascript:|onload\s*=|<foreignObject/i', $svg)) {
        up_fail('В SVG найден скрипт — загрузите картинку без него');
    }
    if (stripos($svg, '<svg') === false) up_fail('Это не SVG-файл');
} else {
    $info = @getimagesize($f['tmp_name']);
    if ($info === false) up_fail('Файл не похож на изображение');

    $allowedTypes = [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF];
    if (!in_array($info[2], $allowedTypes, true)) up_fail('Неподдерживаемый формат изображения');
}

/* Имя файла: латиница, дата и случайный хвост — исходное имя не используем */
$slug = strtolower((string)pathinfo($name, PATHINFO_FILENAME));
$slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
$slug = trim($slug, '-');
if ($slug === '' || strlen($slug) < 2) $slug = 'image';
$slug = substr($slug, 0, 40);

$dir = UPLOAD_DIR . '/' . date('Y-m');
if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
    up_fail('Не удалось создать папку для загрузок. Проверьте права на /uploads', 500);
}

$file = $slug . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
$dest = $dir . '/' . $file;

if (!@move_uploaded_file($f['tmp_name'], $dest)) {
    up_fail('Не удалось сохранить файл. Проверьте права на /uploads', 500);
}
@chmod($dest, 0644);

/* Сразу делаем WebP-двойника: сайт отдаст его вместо тяжёлого оригинала.
   Не получилось — не беда, картинка просто останется в исходном формате. */
if ($webpFile = webp_make($dest)) {
    @chmod($webpFile, 0644);
}

echo json_encode([
    'ok'  => true,
    'url' => url('uploads/' . date('Y-m') . '/' . $file),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
