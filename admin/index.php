<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/inc/auth.php';
require_once dirname(__DIR__) . '/inc/schema.php';

auth_start();

/* Если админов ещё нет — отправляем на установку */
if (!users_exist()) {
    header('Location: ' . url('install.php'));
    exit;
}

$action = $_GET['action'] ?? 'dashboard';
$notice = '';
$error  = '';

/* ==================== ВЫХОД ==================== */
if ($action === 'logout') {
    logout();
    header('Location: ' . url('admin/?action=login'));
    exit;
}

/* ==================== ВХОД ==================== */
if ($action === 'login') {
    if (current_user()) {
        header('Location: ' . url('admin/'));
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        csrf_check();
        $wait = login_blocked();
        if ($wait > 0) {
            $error = 'Слишком много попыток. Попробуйте через ' . ceil($wait / 60) . ' мин.';
        } elseif (attempt_login((string)($_POST['login'] ?? ''), (string)($_POST['password'] ?? ''))) {
            header('Location: ' . url('admin/'));
            exit;
        } else {
            $error = 'Неверный логин или пароль';
        }
    }

    render_login($error);
    exit;
}

/* Дальше — только для авторизованных */
$user = require_login();

/* ==================== СОХРАНЕНИЕ РАЗДЕЛА ==================== */
if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $key = (string)($_POST['section'] ?? '');
    $sections = schema();

    if (!isset($sections[$key])) {
        http_response_code(404);
        exit('Раздел не найден');
    }
    if (!empty($sections[$key]['admin_only']) && !is_admin()) {
        http_response_code(403);
        exit('Недостаточно прав');
    }

    $data = content();

    // Обычные поля
    foreach ((array)($_POST['f'] ?? []) as $path => $value) {
        $def = $sections[$key]['fields'][$path] ?? null;
        if (!$def) continue;
        arr_set($data, (string)$path, cast_value($value, $def['type'] ?? 'text'));
    }

    // Повторяющиеся блоки
    foreach ($sections[$key]['repeaters'] ?? [] as $rep) {
        $path = $rep['path'];
        $rows = $_POST['r'][$path] ?? [];
        $clean = [];

        foreach ((array)$rows as $row) {
            if (!is_array($row)) continue;
            $item = [];
            $hasContent = false;
            foreach ($rep['fields'] as $fk => $fdef) {
                $val = cast_value($row[$fk] ?? '', $fdef['type'] ?? 'text');
                $item[$fk] = $val;
                if (!in_array($fdef['type'] ?? 'text', ['check'], true) && trim((string)$val) !== '') {
                    $hasContent = true;
                }
            }
            if ($hasContent) $clean[] = $item;   // Полностью пустые строки не сохраняем
        }
        arr_set($data, $path, $clean);
    }

    if (content_save($data)) {
        header('Location: ' . url('admin/?action=edit&s=' . urlencode($key) . '&saved=1'));
    } else {
        header('Location: ' . url('admin/?action=edit&s=' . urlencode($key) . '&err=1'));
    }
    exit;
}

function cast_value($value, string $type)
{
    if ($type === 'check')  return !empty($value) && $value !== '0';
    if ($type === 'number') return is_numeric($value) ? (int)$value : 0;
    return is_string($value) ? str_replace("\r\n", "\n", trim($value)) : '';
}

/* ==================== ДЕЙСТВИЯ С ЗАЯВКАМИ ==================== */
if ($action === 'lead' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $id   = (string)($_POST['id'] ?? '');
    $mode = (string)($_POST['mode'] ?? '');
    $items = leads_all();

    if ($mode === 'delete') {
        $items = array_filter($items, fn($l) => ($l['id'] ?? '') !== $id);
    } else {
        foreach ($items as &$l) {
            if (($l['id'] ?? '') === $id) $l['done'] = ($mode === 'done');
        }
        unset($l);
    }
    leads_save($items);
    header('Location: ' . url('admin/?action=leads'));
    exit;
}

/* Выгрузка заявок в таблицу */
if ($action === 'export') {
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="leads-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");                    // BOM — чтобы Excel не ломал кириллицу
    fputcsv($out, ['Дата', 'Имя', 'Контакт', 'Услуга', 'Задача', 'Страница', 'Обработана',
        'Согласие на ПДн', 'Текст согласия', 'Редакция политики', 'IP', 'Согласие на рассылку'], ';');
    foreach (leads_all() as $l) {
        fputcsv($out, [
            date('d.m.Y H:i', strtotime($l['date'] ?? 'now')),
            $l['name'] ?? '', $l['contact'] ?? '', $l['service'] ?? '',
            $l['message'] ?? '', $l['page'] ?? '',
            !empty($l['done']) ? 'да' : 'нет',
            !empty($l['agree']) ? 'да' : '—',
            $l['agree_text'] ?? '',
            $l['policy_rev'] ?? '',
            $l['ip'] ?? '',
            !empty($l['marketing']) ? 'да' : 'нет',
        ], ';');
    }
    fclose($out);
    exit;
}

/* ==================== ПОЛЬЗОВАТЕЛИ ==================== */
if ($action === 'users' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    if (!is_admin()) exit('Недостаточно прав');

    $mode = (string)($_POST['mode'] ?? '');

    if ($mode === 'add') {
        $login = (string)($_POST['login'] ?? '');
        $pass  = (string)($_POST['password'] ?? '');
        if (mb_strlen($pass) < 8) {
            $error = 'Пароль должен быть не короче 8 символов';
        } elseif (!preg_match('/^[a-z0-9_.-]{3,32}$/i', $login)) {
            $error = 'Логин: латиница, цифры, 3–32 символа';
        } elseif (!user_create($login, $pass, (string)($_POST['role'] ?? 'editor'), (string)($_POST['name'] ?? ''))) {
            $error = 'Такой логин уже существует';
        } else {
            $notice = 'Пользователь добавлен';
        }
    } elseif ($mode === 'delete') {
        $login = (string)($_POST['login'] ?? '');
        if ($login === $user['login']) {
            $error = 'Нельзя удалить самого себя';
        } elseif (!user_delete($login)) {
            $error = 'Не удалось удалить';
        } else {
            $notice = 'Пользователь удалён';
        }
    }
}

/* ==================== СМЕНА ПАРОЛЯ ==================== */
if ($action === 'password' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $old = (string)($_POST['old'] ?? '');
    $new = (string)($_POST['new'] ?? '');

    $found = false;
    foreach (users() as $u) {
        if ($u['login'] === $user['login'] && password_verify($old, $u['hash'])) $found = true;
    }

    if (!$found) {
        $error = 'Текущий пароль указан неверно';
    } elseif (mb_strlen($new) < 8) {
        $error = 'Новый пароль должен быть не короче 8 символов';
    } elseif (user_update_password($user['login'], $new)) {
        $notice = 'Пароль изменён';
    } else {
        $error = 'Не удалось изменить пароль';
    }
}

if (isset($_GET['saved'])) $notice = 'Изменения сохранены и уже видны на сайте';
if (isset($_GET['err']))   $error  = 'Не удалось записать файл. Проверьте права на папку /data';

/* ==================== РЕЗЕРВНЫЕ КОПИИ ==================== */
if ($action === 'backup') {

    // Скачать текущий контент файлом
    if (isset($_GET['download'])) {
        $f = DATA_DIR . '/content.json';
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="content-' . date('Y-m-d-Hi') . '.json"');
        readfile($f);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        csrf_check();
        if (!is_admin()) exit('Недостаточно прав');
        $mode = (string)($_POST['mode'] ?? '');

        if ($mode === 'restore') {
            $bak = DATA_DIR . '/content.json.bak.json';
            $raw = is_file($bak) ? (string)file_get_contents($bak) : '';
            $data = json_decode($raw, true);
            if (is_array($data) && content_save($data)) {
                $notice = 'Предыдущая версия восстановлена';
            } else {
                $error = 'Не удалось восстановить копию';
            }
        }

        if ($mode === 'upload') {
            $f = $_FILES['file'] ?? null;
            if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) {
                $error = 'Файл не загрузился';
            } else {
                $raw = (string)file_get_contents($f['tmp_name']);
                $data = json_decode($raw, true);
                if (!is_array($data) || !isset($data['site'])) {
                    $error = 'Это не похоже на файл контента сайта';
                } elseif (content_save($data)) {
                    $notice = 'Контент заменён содержимым файла';
                } else {
                    $error = 'Не удалось записать файл. Проверьте права на папку /data';
                }
            }
        }
    }
}

require_once __DIR__ . '/extra.php';

/* ==================== ОТРИСОВКА ==================== */
render_header($user, $action);

switch ($action) {
    case 'edit':     render_editor((string)($_GET['s'] ?? ''), $notice, $error); break;
    case 'leads':    render_leads(); break;
    case 'users':    render_users($user, $notice, $error); break;
    case 'password': render_password($notice, $error); break;
    case 'health':   render_health(); break;
    case 'backup':   render_backup($notice, $error); break;
    case 'search':   render_search(); break;
    default:         render_dashboard($user);
}

render_footer();


/* ============================================================
   ФУНКЦИИ ОТРИСОВКИ
   ============================================================ */

function render_login(string $error): void
{
    ?><!DOCTYPE html>
    <html lang="ru"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Вход — <?= e(c('site.brand', 'AXIOMANTIC')) ?></title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="<?= url('admin/assets/admin.css') ?>?v=<?= @filemtime(ROOT . '/admin/assets/admin.css') ?: 1 ?>">
    </head><body class="login-body">
      <div class="login-box">
        <div class="login-brand"><?= e(c('site.brand', 'AXIOMANTIC®')) ?></div>
        <h1>Панель управления</h1>
        <?php if ($error): ?><div class="msg msg--err"><?= e($error) ?></div><?php endif; ?>
        <form method="post" class="stack">
          <?= csrf_field() ?>
          <label class="fieldset">
            <span>Логин</span>
            <input type="text" name="login" required autofocus autocomplete="username">
          </label>
          <label class="fieldset">
            <span>Пароль</span>
            <input type="password" name="password" required autocomplete="current-password">
          </label>
          <button class="btn" type="submit">Войти</button>
        </form>
        <a class="back" href="<?= url('') ?>">← Вернуться на сайт</a>
      </div>
    </body></html><?php
}

function render_header(array $user, string $action): void
{
    $groups = schema_groups();
    $newLeads = leads_new_count();
    $current = $_GET['s'] ?? '';
    ?><!DOCTYPE html>
    <html lang="ru"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Панель управления — <?= e(c('site.brand', 'AXIOMANTIC')) ?></title>
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="<?= url('admin/assets/admin.css') ?>?v=<?= @filemtime(ROOT . '/admin/assets/admin.css') ?: 1 ?>">
    </head><body>
    <div class="shell">
      <aside class="side" id="side">
        <div class="side-top">
          <a class="side-brand" href="<?= url('admin/') ?>"><?= e(c('site.brand', 'AXIOMANTIC®')) ?></a>
          <div class="side-role"><?= e($user['name']) ?> · <?= $user['role'] === 'admin' ? 'администратор' : 'редактор' ?></div>
        </div>

        <nav class="side-nav">
          <a href="<?= url('admin/') ?>" class="<?= $action === 'dashboard' ? 'on' : '' ?>">Обзор</a>
          <a href="<?= url('admin/?action=leads') ?>" class="<?= $action === 'leads' ? 'on' : '' ?>">
            Заявки<?php if ($newLeads): ?><i class="badge"><?= $newLeads ?></i><?php endif; ?>
          </a>

          <?php foreach ($groups as $group => $sections): ?>
            <div class="side-group"><?= e($group) ?></div>
            <?php foreach ($sections as $key => $title):
                if (!empty(schema()[$key]['admin_only']) && !is_admin()) continue; ?>
              <a href="<?= url('admin/?action=edit&s=' . urlencode($key)) ?>"
                 class="<?= ($action === 'edit' && $current === $key) ? 'on' : '' ?>"><?= e($title) ?></a>
            <?php endforeach; ?>
          <?php endforeach; ?>

          <div class="side-group">Доступ</div>
          <?php if (is_admin()): ?>
            <a href="<?= url('admin/?action=users') ?>" class="<?= $action === 'users' ? 'on' : '' ?>">Пользователи</a>
          <?php endif; ?>
          <a href="<?= url('admin/?action=health') ?>" class="<?= $action === 'health' ? 'on' : '' ?>">Проверка сайта</a>
          <a href="<?= url('admin/?action=search') ?>" class="<?= $action === 'search' ? 'on' : '' ?>">Поиск по сайту</a>
          <?php if (is_admin()): ?>
            <a href="<?= url('admin/?action=backup') ?>" class="<?= $action === 'backup' ? 'on' : '' ?>">Резервные копии</a>
          <?php endif; ?>
          <a href="<?= url('admin/?action=password') ?>" class="<?= $action === 'password' ? 'on' : '' ?>">Сменить пароль</a>
          <a href="<?= url('') ?>" target="_blank" rel="noopener">Открыть сайт ↗</a>
          <a href="<?= url('admin/?action=logout') ?>" class="danger">Выйти</a>
        </nav>
      </aside>

      <button class="side-toggle" id="sideToggle" aria-label="Меню">☰</button>
      <main class="main">
    <?php
}

function render_footer(): void
{
    ?>
      </main>
    </div>
    <script src="<?= url('admin/assets/admin.js') ?>?v=<?= @filemtime(ROOT . '/admin/assets/admin.js') ?: 1 ?>"></script>
    </body></html><?php
}

function render_dashboard(array $user): void
{
    $leads = leads_all();
    $new = leads_new_count();
    $recent = array_slice($leads, 0, 5);
    ?>
    <?php
    // Заявки без отметки «обработана»
    $pending = 0;
    foreach ($leads as $l) { if (empty($l['done'])) $pending++; }

    // Когда в последний раз сохраняли контент
    $ts = @filemtime(DATA_DIR . '/content.json');
    if ($ts) {
        $days = (int)floor((time() - $ts) / 86400);
        if ($days === 0)      $lastEdit = 'сегодня в ' . date('H:i', $ts);
        elseif ($days === 1)  $lastEdit = 'вчера в ' . date('H:i', $ts);
        else {
            $mn = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
            $lastEdit = date('j', $ts) . ' ' . $mn[(int)date('n', $ts) - 1];
        }
    } else {
        $lastEdit = '—';
    }
    ?>

    <h1 class="h1">Здравствуйте, <?= e($user['name']) ?></h1>
    <p class="sub">Правьте тексты сайта в разделах слева. После сохранения изменения появляются сразу — публиковать отдельно не нужно.</p>

    <div class="cards">
      <a class="card" href="<?= url('admin/?action=leads') ?>">
        <div class="card-num"><?= $new ?></div>
        <div class="card-lbl">новых заявок</div>
      </a>
      <div class="card">
        <div class="card-num"><?= count($leads) ?></div>
        <div class="card-lbl">всего заявок</div>
      </div>
      <div class="card">
        <div class="card-num"><?= count((array)c('work.items', [])) ?></div>
        <div class="card-lbl">проектов в портфолио</div>
      </div>
      <a class="card" href="<?= url('admin/?action=leads') ?>">
        <div class="card-num"><?= $pending ?></div>
        <div class="card-lbl">не обработано</div>
      </a>
      <div class="card">
        <div class="card-num" style="font-size:19px;line-height:1.35"><?= e($lastEdit) ?></div>
        <div class="card-lbl">последняя правка</div>
      </div>
    </div>

    <?php $tg = trim((string)c('integrations.telegram_token')); ?>
    <?php if ($tg === '' && is_admin()): ?>
      <div class="msg msg--warn">
        Уведомления в Telegram не подключены — заявки видны только здесь.
        <a href="<?= url('admin/?action=edit&s=integrations') ?>">Подключить</a>
      </div>
    <?php endif; ?>

    <h2 class="h2">Последние заявки</h2>
    <?php if (!$recent): ?>
      <p class="empty">Заявок пока нет. Когда кто-то заполнит форму на сайте, она появится здесь.</p>
    <?php else: ?>
      <div class="table">
        <?php foreach ($recent as $l): ?>
          <div class="tr<?= empty($l['done']) ? ' tr--new' : '' ?>">
            <div class="td td--date"><?= date('d.m H:i', strtotime($l['date'] ?? 'now')) ?></div>
            <div class="td"><b><?= e($l['name'] ?? '') ?></b></div>
            <div class="td"><?= e($l['contact'] ?? '') ?></div>
            <div class="td td--dim"><?= e(mb_substr($l['message'] ?? '', 0, 70)) ?></div>
          </div>
        <?php endforeach; ?>
      </div>
      <a class="btn btn--gh" href="<?= url('admin/?action=leads') ?>">Все заявки</a>
    <?php endif; ?>
    <?php
}

function render_leads(): void
{
    $leads = leads_all();
    ?>
    <div class="head-row">
      <div>
        <h1 class="h1">Заявки</h1>
        <p class="sub"><?= count($leads) ?> всего · <?= leads_new_count() ?> не обработано</p>
      </div>
      <?php if ($leads): ?>
        <a class="btn btn--gh" href="<?= url('admin/?action=export') ?>">Скачать таблицу</a>
      <?php endif; ?>
    </div>

    <?php if (!$leads): ?>
      <p class="empty">Заявок пока нет.</p>
    <?php else: ?>
      <div class="leads">
        <?php foreach ($leads as $l): ?>
          <article class="lead<?= empty($l['done']) ? ' lead--new' : '' ?>">
            <header class="lead-top">
              <div>
                <b class="lead-name"><?= e($l['name'] ?? '') ?></b>
                <span class="lead-date"><?= date('d.m.Y, H:i', strtotime($l['date'] ?? 'now')) ?></span>
              </div>
              <div class="lead-acts">
                <form method="post" action="<?= url('admin/?action=lead') ?>">
                  <?= csrf_field() ?>
                  <input type="hidden" name="id" value="<?= e($l['id'] ?? '') ?>">
                  <input type="hidden" name="mode" value="<?= empty($l['done']) ? 'done' : 'undone' ?>">
                  <button class="mini" type="submit"><?= empty($l['done']) ? 'Обработана' : 'Вернуть в новые' ?></button>
                </form>
                <form method="post" action="<?= url('admin/?action=lead') ?>" data-confirm="Удалить заявку?">
                  <?= csrf_field() ?>
                  <input type="hidden" name="id" value="<?= e($l['id'] ?? '') ?>">
                  <input type="hidden" name="mode" value="delete">
                  <button class="mini mini--danger" type="submit">Удалить</button>
                </form>
              </div>
            </header>

            <div class="lead-grid">
              <div><span>Контакт</span><b><?= e($l['contact'] ?? '') ?></b></div>
              <?php if (!empty($l['service'])): ?><div><span>Услуга</span><b><?= e($l['service']) ?></b></div><?php endif; ?>
              <div><span>Страница</span><b><?= e($l['page'] ?: '/') ?></b></div>
            </div>

            <?php if (!empty($l['agree'])): ?>
              <div class="lead-consent">
                <b>Согласие получено</b>
                <span><?= e($l['agree_text'] ?? '') ?></span>
                <span>Редакция политики: <?= e($l['policy_rev'] ?: '—') ?> · IP <?= e($l['ip'] ?? '') ?></span>
                <span>Рассылка: <?= !empty($l['marketing']) ? 'разрешена' : 'не разрешена' ?></span>
              </div>
            <?php endif; ?>

            <?php if (!empty($l['message'])): ?>
              <p class="lead-msg"><?= nl($l['message']) ?></p>
            <?php endif; ?>
          </article>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
    <?php
}

function render_editor(string $key, string $notice, string $error): void
{
    $sections = schema();
    if (!isset($sections[$key])) {
        echo '<h1 class="h1">Раздел не найден</h1>';
        return;
    }
    $sec = $sections[$key];
    if (!empty($sec['admin_only']) && !is_admin()) {
        echo '<h1 class="h1">Недостаточно прав</h1><p class="sub">Этот раздел доступен только администратору.</p>';
        return;
    }
    ?>
    <form method="post" action="<?= url('admin/?action=save') ?>" class="editor" id="editor">
      <?= csrf_field() ?>
      <input type="hidden" name="section" value="<?= e($key) ?>">

      <div class="head-row">
        <div>
          <h1 class="h1"><?= e($sec['title']) ?></h1>
          <?php if (!empty($sec['desc'])): ?><p class="sub"><?= e($sec['desc']) ?></p><?php endif; ?>
        </div>
        <button class="btn" type="submit">Сохранить</button>
      </div>

      <?php if ($notice): ?><div class="msg msg--ok"><?= e($notice) ?></div><?php endif; ?>
      <?php if ($error): ?><div class="msg msg--err"><?= e($error) ?></div><?php endif; ?>

      <?php if (!empty($sec['fields'])): ?>
        <div class="grid">
          <?php foreach ($sec['fields'] as $path => $def) {
              echo field_html('f[' . $path . ']', $def, arr_get(content(), $path, ''));
          } ?>
        </div>
      <?php endif; ?>

      <?php foreach ($sec['repeaters'] ?? [] as $ri => $rep): ?>
        <?php
        $items = (array)arr_get(content(), $rep['path'], []);
        $max = $rep['max'] ?? 0;
        ?>
        <section class="rep" data-rep data-path="<?= e($rep['path']) ?>" data-label="<?= e($rep['label']) ?>" data-max="<?= (int)$max ?>">
          <div class="rep-head">
            <h2 class="h2"><?= e($rep['label']) ?> <span class="count"><?= count($items) ?></span></h2>
            <button type="button" class="btn btn--gh" data-add>+ Добавить</button>
          </div>

          <div class="rep-list" data-list>
            <?php foreach ($items as $i => $item): ?>
              <?= repeater_row($rep, $i, $item) ?>
            <?php endforeach; ?>
          </div>

          <template data-tpl><?= repeater_row($rep, '__i__', []) ?></template>
        </section>
      <?php endforeach; ?>

      <div class="save-bar">
        <button class="btn" type="submit">Сохранить изменения</button>
        <a class="btn btn--gh" href="<?= url('') ?>" target="_blank" rel="noopener">Посмотреть сайт ↗</a>
      </div>
    </form>
    <?php
}

function repeater_row(array $rep, $index, array $item): string
{
    $title = $item[$rep['title_field'] ?? ''] ?? '';
    if (!is_string($title) || $title === '') $title = 'Новый пункт';

    $html  = '<article class="row" data-row>';
    $html .= '<header class="row-head">';
    $html .= '<button type="button" class="row-toggle" data-toggle><span class="row-title">' . e(mb_substr($title, 0, 70)) . '</span></button>';
    $html .= '<div class="row-acts">';
    $html .= '<button type="button" class="mini" data-move="-1" title="Выше">↑</button>';
    $html .= '<button type="button" class="mini" data-move="1" title="Ниже">↓</button>';
    $html .= '<button type="button" class="mini" data-dup title="Создать копию">Копия</button>';
    $html .= '<button type="button" class="mini mini--danger" data-del>Удалить</button>';
    $html .= '</div></header>';
    $html .= '<div class="row-body"><div class="grid">';

    foreach ($rep['fields'] as $fk => $def) {
        $name = 'r[' . $rep['path'] . '][' . $index . '][' . $fk . ']';
        $html .= field_html($name, $def, $item[$fk] ?? '');
    }

    $html .= '</div></div></article>';
    return $html;
}

function field_html(string $name, array $def, $value): string
{
    $type  = $def['type'] ?? 'text';
    $label = $def['label'] ?? '';
    $hint  = $def['hint'] ?? '';
    $w     = $def['w'] ?? '';
    $rows  = (int)($def['rows'] ?? 3);
    $ph    = $def['placeholder'] ?? '';
    $min   = $def['min'] ?? 1;
    $max   = $def['max'] ?? 60;
    $id    = 'f' . substr(md5($name), 0, 8);

    $cls = 'fieldset' . ($w ? ' w-' . $w : '');

    $out = '<div class="' . $cls . '">';

    if ($type === 'check') {
        $out .= '<label class="check">';
        $out .= '<input type="hidden" name="' . e($name) . '" value="0">';
        $out .= '<input type="checkbox" name="' . e($name) . '" value="1"' . (!empty($value) ? ' checked' : '') . '>';
        $out .= '<span>' . e($label) . '</span></label>';
        if ($hint) $out .= '<small>' . e($hint) . '</small>';
        return $out . '</div>';
    }

    $out .= '<label for="' . $id . '"><span>' . e($label) . '</span></label>';

    if ($type === 'textarea' || $type === 'list') {
        $out .= '<textarea id="' . $id . '" name="' . e($name) . '" rows="' . $rows . '">' . e((string)$value) . '</textarea>';
    } elseif ($type === 'number') {
        $out .= '<input id="' . $id . '" type="number" name="' . e($name) . '" value="' . e((string)$value) . '" min="' . e((string)$min) . '" max="' . e((string)$max) . '">';
    } elseif ($type === 'color') {
        $hex = preg_match('/^#[0-9a-fA-F]{6}$/', (string)$value) ? (string)$value : ($ph ?: '#000000');
        $out .= '<div class="color-field" data-color>';
        $out .= '<input type="color" value="' . e($hex) . '" data-color-pick aria-label="Палитра">';
        $out .= '<input id="' . $id . '" type="text" name="' . e($name) . '" value="' . e((string)$value)
              . '" placeholder="' . e((string)$ph) . '" data-color-text spellcheck="false">';
        $out .= '</div>';
    } elseif ($type === 'image') {
        $out .= '<div class="img-field" data-img>';
        $out .= '<input id="' . $id . '" type="text" name="' . e($name) . '" value="' . e((string)$value) . '" placeholder="Файл не выбран" data-img-input>';
        $out .= '<button type="button" class="mini" data-img-pick>Загрузить</button>';
        if ($value) $out .= '<button type="button" class="mini mini--danger" data-img-clear>Убрать</button>';
        $out .= '<input type="file" accept="image/*" hidden data-img-file>';
        $out .= '</div>';
        $out .= '<div class="img-prev"' . ($value ? '' : ' hidden') . ' data-img-prev>';
        if ($value) $out .= '<img src="' . e((string)$value) . '" alt="">';
        $out .= '</div>';
    } else {
        $out .= '<input id="' . $id . '" type="text" name="' . e($name) . '" value="' . e((string)$value)
              . '"' . ($ph ? ' placeholder="' . e((string)$ph) . '"' : '') . '>';
    }

    if ($hint) $out .= '<small>' . e($hint) . '</small>';
    return $out . '</div>';
}

function render_users(array $user, string $notice, string $error): void
{
    if (!is_admin()) {
        echo '<h1 class="h1">Недостаточно прав</h1>';
        return;
    }
    ?>
    <h1 class="h1">Пользователи</h1>
    <p class="sub">Редактор может менять весь контент, но не видит настройки интеграций и не управляет доступами.</p>

    <?php if ($notice): ?><div class="msg msg--ok"><?= e($notice) ?></div><?php endif; ?>
    <?php if ($error): ?><div class="msg msg--err"><?= e($error) ?></div><?php endif; ?>

    <div class="table table--users">
      <?php foreach (users() as $u): ?>
        <div class="tr">
          <div class="td"><b><?= e($u['name']) ?></b><span class="td--dim"> · <?= e($u['login']) ?></span></div>
          <div class="td td--dim"><?= $u['role'] === 'admin' ? 'администратор' : 'редактор' ?></div>
          <div class="td td--right">
            <?php if ($u['login'] !== $user['login']): ?>
              <form method="post" data-confirm="Удалить пользователя <?= e($u['login']) ?>?">
                <?= csrf_field() ?>
                <input type="hidden" name="mode" value="delete">
                <input type="hidden" name="login" value="<?= e($u['login']) ?>">
                <button class="mini mini--danger" type="submit">Удалить</button>
              </form>
            <?php else: ?><span class="td--dim">это вы</span><?php endif; ?>
          </div>
        </div>
      <?php endforeach; ?>
    </div>

    <h2 class="h2">Добавить пользователя</h2>
    <form method="post" class="box">
      <?= csrf_field() ?>
      <input type="hidden" name="mode" value="add">
      <div class="grid">
        <div class="fieldset w-m"><label><span>Имя</span></label><input type="text" name="name" placeholder="Полина"></div>
        <div class="fieldset w-m"><label><span>Логин</span></label><input type="text" name="login" required placeholder="polina" autocomplete="off"></div>
        <div class="fieldset w-m"><label><span>Пароль</span></label><input type="text" name="password" required minlength="8" placeholder="минимум 8 символов" autocomplete="new-password"></div>
        <div class="fieldset w-m"><label><span>Роль</span></label>
          <select name="role"><option value="editor">Редактор</option><option value="admin">Администратор</option></select>
        </div>
      </div>
      <button class="btn" type="submit">Добавить</button>
    </form>
    <?php
}

function render_password(string $notice, string $error): void
{
    ?>
    <h1 class="h1">Смена пароля</h1>
    <?php if ($notice): ?><div class="msg msg--ok"><?= e($notice) ?></div><?php endif; ?>
    <?php if ($error): ?><div class="msg msg--err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" class="box box--narrow">
      <?= csrf_field() ?>
      <div class="fieldset"><label><span>Текущий пароль</span></label><input type="password" name="old" required autocomplete="current-password"></div>
      <div class="fieldset"><label><span>Новый пароль</span></label><input type="password" name="new" required minlength="8" autocomplete="new-password"><small>Не короче 8 символов</small></div>
      <button class="btn" type="submit">Сменить пароль</button>
    </form>
    <?php
}
