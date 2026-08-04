<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/auth.php';

auth_start();

/* Установка возможна только пока нет ни одного администратора */
if (users_exist()) {
    http_response_code(403);
    $done = true;
} else {
    $done = false;
}

/* ---------- Проверка окружения ---------- */
$checks = [
    'PHP 8.1 или новее' => [
        'ok'   => PHP_VERSION_ID >= 80100,
        'hint' => 'Сейчас ' . PHP_VERSION . '. Обновите PHP или переключите версию в панели хостинга.',
    ],
    'Расширение json' => [
        'ok'   => extension_loaded('json'),
        'hint' => 'Установите php-json.',
    ],
    'Расширение mbstring' => [
        'ok'   => extension_loaded('mbstring'),
        'hint' => 'Установите php-mbstring — без него ломаются русские тексты.',
    ],
    'Папка /data доступна для записи' => [
        'ok'   => is_dir(DATA_DIR) ? is_writable(DATA_DIR) : @mkdir(DATA_DIR, 0775, true),
        'hint' => 'Выполните: chmod 775 data && chown www-data:www-data data',
    ],
    'Папка /uploads доступна для записи' => [
        'ok'   => is_dir(UPLOAD_DIR) ? is_writable(UPLOAD_DIR) : @mkdir(UPLOAD_DIR, 0775, true),
        'hint' => 'Выполните: chmod 775 uploads && chown www-data:www-data uploads',
    ],
    'Файл data/content.json на месте' => [
        'ok'   => is_file(DATA_DIR . '/content.json'),
        'hint' => 'Загрузите папку data целиком из архива.',
    ],
];

$envOk = true;
foreach ($checks as $c) {
    if (!$c['ok']) $envOk = false;
}

/* ---------- Создание администратора ---------- */
$error = '';
if (!$done && $envOk && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    csrf_check();

    $login = strtolower(trim((string)($_POST['login'] ?? '')));
    $name  = trim((string)($_POST['name'] ?? ''));
    $pass  = (string)($_POST['password'] ?? '');
    $pass2 = (string)($_POST['password2'] ?? '');

    if (!preg_match('/^[a-z0-9_.-]{3,32}$/', $login)) {
        $error = 'Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание.';
    } elseif (mb_strlen($pass) < 10) {
        $error = 'Пароль должен быть не короче 10 символов.';
    } elseif ($pass !== $pass2) {
        $error = 'Пароли не совпадают.';
    } elseif (!user_create($login, $pass, 'admin', $name)) {
        $error = 'Не удалось создать пользователя. Проверьте права на папку /data.';
    } else {
        header('Location: ' . url('admin/?action=login'));
        exit;
    }
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Установка — AXIOMANTIC</title>
<style>
:root{--ink:#131518;--paper:#EEEDEA;--chalk:#FBFAF8;--klein:#0B2CCB;--rule:#D5D3CD;--mut:#6E7178}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:40px 20px;-webkit-font-smoothing:antialiased}
.box{max-width:560px;margin:0 auto}
.brand{font-weight:700;letter-spacing:-.02em;font-size:15px;margin-bottom:28px}
h1{font-size:clamp(26px,5vw,38px);letter-spacing:-.03em;font-weight:400;line-height:1.1;margin-bottom:12px}
.sub{color:var(--mut);margin-bottom:30px}
.card{background:var(--chalk);border:1px solid var(--rule);border-radius:6px;padding:clamp(20px,4vw,32px);margin-bottom:20px}
.card h2{font-size:15px;font-weight:600;margin-bottom:16px;letter-spacing:.02em}
.chk{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--rule);font-size:15px}
.chk:last-child{border-bottom:0}
.chk .st{flex:none;width:20px;font-weight:700}
.chk .st.y{color:#1B7F4B}
.chk .st.n{color:#C0392B}
.chk .hint{display:block;color:#C0392B;font-size:13.5px;margin-top:4px;font-family:ui-monospace,monospace}
label{display:block;font-size:13px;color:var(--mut);margin:16px 0 7px;text-transform:uppercase;letter-spacing:.1em}
input{width:100%;padding:13px 15px;font-size:16px;border:1px solid var(--rule);border-radius:4px;background:#fff;font-family:inherit}
input:focus{outline:0;border-color:var(--klein);box-shadow:0 0 0 3px rgba(11,44,203,.13)}
button{width:100%;margin-top:24px;padding:15px;background:var(--klein);color:#fff;border:0;border-radius:999px;font-size:16px;font-weight:500;cursor:pointer}
button:hover{opacity:.92}
button:disabled{opacity:.4;cursor:not-allowed}
.err{background:#FDECEA;border:1px solid #E7A9A2;color:#9B2C20;padding:13px 16px;border-radius:4px;margin-top:18px;font-size:15px}
.warn{background:#FFF8E1;border:1px solid #E8D48B;padding:14px 16px;border-radius:4px;font-size:14.5px;margin-top:20px}
code{background:#E6E5E1;padding:2px 6px;border-radius:3px;font-size:13.5px}
a{color:var(--klein)}
</style>
</head>
<body>
<div class="box">
  <div class="brand">AXIOMANTIC®</div>

<?php if ($done): ?>
  <h1>Установка уже выполнена</h1>
  <p class="sub">Администратор создан ранее. Повторная установка заблокирована.</p>
  <div class="card">
    <p>Перейдите в <a href="<?= e(url('admin/')) ?>">админку</a>.</p>
    <div class="warn"><b>Удалите файл <code>install.php</code></b> с сервера — он больше не нужен.</div>
  </div>

<?php else: ?>
  <h1>Установка</h1>
  <p class="sub">Проверим сервер и создадим первого администратора.</p>

  <div class="card">
    <h2>Проверка сервера</h2>
    <?php foreach ($checks as $label => $c): ?>
      <div class="chk">
        <span class="st <?= $c['ok'] ? 'y' : 'n' ?>"><?= $c['ok'] ? '✓' : '✕' ?></span>
        <span>
          <?= e($label) ?>
          <?php if (!$c['ok']): ?><span class="hint"><?= e($c['hint']) ?></span><?php endif; ?>
        </span>
      </div>
    <?php endforeach; ?>
  </div>

  <form class="card" method="post" autocomplete="off">
    <h2>Администратор</h2>
    <?= csrf_field() ?>

    <label for="login">Логин</label>
    <input id="login" name="login" required pattern="[a-z0-9_.\-]{3,32}"
           value="<?= e((string)($_POST['login'] ?? '')) ?>" placeholder="admin">

    <label for="name">Имя (видно в админке)</label>
    <input id="name" name="name" value="<?= e((string)($_POST['name'] ?? '')) ?>" placeholder="Полина">

    <label for="password">Пароль — минимум 10 символов</label>
    <input id="password" name="password" type="password" required minlength="10" autocomplete="new-password">

    <label for="password2">Повторите пароль</label>
    <input id="password2" name="password2" type="password" required minlength="10" autocomplete="new-password">

    <?php if ($error !== ''): ?><div class="err"><?= e($error) ?></div><?php endif; ?>

    <button type="submit" <?= $envOk ? '' : 'disabled' ?>>
      <?= $envOk ? 'Создать администратора' : 'Сначала исправьте ошибки выше' ?>
    </button>

    <div class="warn">После установки <b>удалите <code>install.php</code></b> с сервера. Пароль восстановить нельзя — сохраните его в менеджере паролей.</div>
  </form>
<?php endif; ?>
</div>
</body>
</html>
