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
                $type = $fdef['type'] ?? 'text';
                $val  = cast_value($row[$fk] ?? '', $type);
                $item[$fk] = $val;

                // Галочка сама по себе не делает строку заполненной,
                // иначе пустая карточка сохранялась бы из-за одного флажка
                if ($type === 'check') continue;
                if (is_array($val) ? $val !== [] : trim((string)$val) !== '') {
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

    // lines — список, который хранится массивом: задачи проекта,
    // что сделали, технологии. Редактируется как обычный текст,
    // каждая строка становится отдельным пунктом
    if ($type === 'lines') {
        $out = [];
        foreach (preg_split('/\r\n|\r|\n/', (string)$value) as $line) {
            $line = trim($line);
            if ($line !== '') $out[] = $line;
        }
        return $out;
    }

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
        'Источник', 'Канал', 'Кампания', 'Запрос', 'yclid', 'Переход с', 'Точка входа',
        'Согласие на ПДн', 'Текст согласия', 'Редакция политики', 'IP', 'Согласие на рассылку'], ';');
    foreach (leads_all() as $l) {
        $m = (array)($l['source']['marks'] ?? []);
        fputcsv($out, [
            date('d.m.Y H:i', strtotime($l['date'] ?? 'now')),
            $l['name'] ?? '', $l['contact'] ?? '', $l['service'] ?? '',
            $l['message'] ?? '', $l['page'] ?? '',
            !empty($l['done']) ? 'да' : 'нет',
            $m['utm_source'] ?? '',
            $m['utm_medium'] ?? '',
            $m['utm_campaign'] ?? '',
            $m['utm_term'] ?? '',
            $m['yclid'] ?? '',
            $l['source']['ref'] ?? '',
            $l['source']['landing'] ?? '',
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
            /* Берём только те файлы, которые сами же и показали в списке —
               так в имя нельзя подсунуть путь наружу из папки data */
            require_once __DIR__ . '/extra.php';
            $name = basename((string)($_POST['file'] ?? 'content.bak.json'));
            $data = null;
            if (array_key_exists($name, backup_files())) {
                $raw  = (string)@file_get_contents(DATA_DIR . '/' . $name);
                $data = json_decode($raw, true);
            }
            if (is_array($data) && isset($data['site']) && content_save($data)) {
                $notice = 'Восстановлено из «' . $name . '»';
            } else {
                $error = 'Не удалось восстановить копию из «' . $name . '»';
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
    case 'seoindex': render_seo_index(); break;
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
    <link rel="icon" href="<?= url(trim((string)c('seo.favicon')) ?: 'assets/img/favicon.svg') ?>">
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
    <link rel="icon" href="<?= url(trim((string)c('seo.favicon')) ?: 'assets/img/favicon.svg') ?>">
    <link rel="stylesheet" href="<?= url('admin/assets/admin.css') ?>?v=<?= @filemtime(ROOT . '/admin/assets/admin.css') ?: 1 ?>">
    </head><body>
    <div class="shell">
      <aside class="side" id="side">
        <div class="side-top">
          <a class="side-brand" href="<?= url('admin/') ?>"><?= e(c('site.brand', 'AXIOMANTIC®')) ?></a>
          <div class="side-role"><?= e($user['name']) ?> · <?= $user['role'] === 'admin' ? 'администратор' : 'редактор' ?></div>
        </div>

        <div class="side-find">
          <input type="search" id="sideFind" placeholder="Найти настройку…"
                 autocomplete="off" aria-label="Поиск по настройкам">
        </div>

        <nav class="side-nav" id="sideNav">
          <a href="<?= url('admin/') ?>" class="<?= $action === 'dashboard' ? 'on' : '' ?>" data-find="обзор главная">Обзор</a>
          <a href="<?= url('admin/?action=leads') ?>" class="<?= $action === 'leads' ? 'on' : '' ?>" data-find="заявки лиды клиенты">
            Заявки<?php if ($newLeads): ?><i class="badge"><?= $newLeads ?></i><?php endif; ?>
          </a>

          <?php foreach ($groups as $group => $sections): ?>
            <div class="side-group" data-group><?= e($group) ?></div>
            <?php foreach ($sections as $key => $title):
                $secDef = schema()[$key];
                if (!empty($secDef['admin_only']) && !is_admin()) continue;
                $place = schema_place($key);

                /* Строка для поиска: название раздела, где он на сайте
                   и подписи всех его полей — чтобы настройку можно было
                   найти по тому слову, которое человек помнит */
                $find = mb_strtolower($title . ' ' . $place['where'] . ' ' . ($secDef['desc'] ?? ''));
                foreach ($secDef['fields'] ?? [] as $fdef) {
                    $find .= ' ' . mb_strtolower((string)($fdef['label'] ?? ''));
                }
                foreach ($secDef['repeaters'] ?? [] as $rep) {
                    $find .= ' ' . mb_strtolower((string)($rep['label'] ?? ''));
                }
                ?>
              <a href="<?= url('admin/?action=edit&s=' . urlencode($key)) ?>"
                 class="<?= ($action === 'edit' && $current === $key) ? 'on' : '' ?>"
                 data-find="<?= e($find) ?>"><span class="side-ico" aria-hidden="true"><?= e($place['icon']) ?></span><?= e($title) ?></a>
            <?php endforeach; ?>
          <?php endforeach; ?>

          <p class="side-empty" id="sideEmpty" hidden>Ничего не нашлось</p>

          <div class="side-group" data-group>Доступ</div>
          <?php if (is_admin()): ?>
            <a href="<?= url('admin/?action=users') ?>" class="<?= $action === 'users' ? 'on' : '' ?>" data-find="пользователи доступ роли">Пользователи</a>
          <?php endif; ?>
          <a href="<?= url('admin/?action=seoindex') ?>" class="<?= $action === 'seoindex' ? 'on' : '' ?>" data-find="индексация seo сео поиск яндекс выдача title description заголовки">Индексация</a>
          <a href="<?= url('admin/?action=health') ?>" class="<?= $action === 'health' ? 'on' : '' ?>" data-find="проверка сайта диагностика">Проверка сайта</a>
          <a href="<?= url('admin/?action=search') ?>" class="<?= $action === 'search' ? 'on' : '' ?>" data-find="поиск по сайту текст">Поиск по сайту</a>
          <?php if (is_admin()): ?>
            <a href="<?= url('admin/?action=backup') ?>" class="<?= $action === 'backup' ? 'on' : '' ?>" data-find="резервные копии бэкап восстановление">Резервные копии</a>
          <?php endif; ?>
          <a href="<?= url('admin/?action=password') ?>" class="<?= $action === 'password' ? 'on' : '' ?>" data-find="пароль вход безопасность">Сменить пароль</a>
          <a href="<?= url('') ?>" target="_blank" rel="noopener" data-find="открыть сайт посмотреть">Открыть сайт ↗</a>
          <a href="<?= url('admin/?action=logout') ?>" class="danger" data-find="выйти выход">Выйти</a>
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

            <?php
            /* Откуда пришёл человек: по этим строкам считается,
               окупается ли реклама */
            $srcMarks = (array)($l['source']['marks'] ?? []);
            $srcRef   = trim((string)($l['source']['ref'] ?? ''));
            ?>
            <?php if ($srcMarks || $srcRef !== ''): ?>
              <div class="lead-source">
                <?php if ($srcMarks): ?>
                  <b>Реклама</b>
                  <span>
                    <?= e(implode(' / ', array_filter([
                          $srcMarks['utm_source']   ?? '',
                          $srcMarks['utm_medium']   ?? '',
                          $srcMarks['utm_campaign'] ?? '',
                        ]))) ?>
                  </span>
                  <?php if (!empty($srcMarks['utm_term'])): ?>
                    <span>Запрос: <?= e($srcMarks['utm_term']) ?></span>
                  <?php endif; ?>
                  <?php if (!empty($srcMarks['yclid'])): ?>
                    <span>yclid: <?= e($srcMarks['yclid']) ?></span>
                  <?php endif; ?>
                <?php else: ?>
                  <b>Переход</b>
                  <span><?= e($srcRef) ?></span>
                <?php endif; ?>
                <?php if (!empty($l['source']['landing'])): ?>
                  <span>Вошёл на: <?= e($l['source']['landing']) ?></span>
                <?php endif; ?>
              </div>
            <?php endif; ?>

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

    $place = schema_place($key);
    $siteUrl = url($place['page']) . ($place['anchor'] !== '' ? '#' . $place['anchor'] : '');
    ?>
    <form method="post" action="<?= url('admin/?action=save') ?>" class="editor" id="editor">
      <?= csrf_field() ?>
      <input type="hidden" name="section" value="<?= e($key) ?>">

      <div class="head-row">
        <div>
          <h1 class="h1"><?= e($sec['title']) ?></h1>
          <?php if ($place['where'] !== ''): ?>
            <p class="where"><span class="where-ico" aria-hidden="true"><?= e($place['icon']) ?></span><?= e($place['where']) ?></p>
          <?php endif; ?>
          <?php if (!empty($sec['desc'])): ?><p class="sub"><?= e($sec['desc']) ?></p><?php endif; ?>
        </div>
        <div class="head-acts">
          <?php if ($place['page'] !== 'stranica-kotoroy-net'): ?>
            <button class="btn btn--gh" type="button" data-preview-toggle
                    aria-expanded="false">Предпросмотр</button>
          <?php endif; ?>
          <a class="btn btn--gh" href="<?= e($siteUrl) ?>" target="_blank" rel="noopener">Открыть ↗</a>
          <button class="btn" type="submit">Сохранить</button>
        </div>
      </div>

      <?php if ($place['page'] !== 'stranica-kotoroy-net'): ?>
        <?php /* Предпросмотр показывает живую страницу сайта, прокрученную
                 к нужному блоку. Обновляется после сохранения — заодно
                 сразу видно, что правка доехала */ ?>
        <section class="preview" data-preview hidden>
          <div class="preview-bar">
            <span>Так блок выглядит на сайте</span>
            <div class="preview-sizes" role="group" aria-label="Ширина экрана">
              <button type="button" class="mini is-active" data-preview-size="full">Компьютер</button>
              <button type="button" class="mini" data-preview-size="390">Телефон</button>
            </div>
            <button type="button" class="mini" data-preview-reload>Обновить</button>
          </div>
          <div class="preview-stage">
            <iframe data-preview-frame title="Предпросмотр блока"
                    data-src="<?= e(url($place['page']) . '?preview=1' . ($place['anchor'] !== '' ? '#' . $place['anchor'] : '')) ?>"
                    loading="lazy"></iframe>
          </div>
        </section>
      <?php endif; ?>

      <?php if (!empty($sec['note'])): ?>
        <div class="note"><b>Как это работает</b><span><?= e($sec['note']) ?></span></div>
      <?php endif; ?>

      <?php if ($notice): ?><div class="msg msg--ok"><?= e($notice) ?></div><?php endif; ?>
      <?php if ($error): ?><div class="msg msg--err"><?= e($error) ?></div><?php endif; ?>

      <?php if (!empty($sec['fields'])): ?>
        <?php if (!empty($sec['fieldsets'])): ?>
          <?php /* Поля разбиты на смысловые группы: так понятно,
                    какая настройка к какой части блока относится */ ?>
          <?php foreach ($sec['fieldsets'] as $fs): ?>
            <section class="fset">
              <div class="fset-head">
                <h2 class="h2"><?= e($fs['title'] ?? '') ?></h2>
                <?php if (!empty($fs['desc'])): ?><p class="sub"><?= e($fs['desc']) ?></p><?php endif; ?>
              </div>
              <div class="grid">
                <?php foreach ($fs['fields'] ?? [] as $path): ?>
                  <?php if (!isset($sec['fields'][$path])) continue; ?>
                  <?= field_html('f[' . $path . ']', $sec['fields'][$path], arr_get(content(), $path, '')) ?>
                <?php endforeach; ?>
              </div>
            </section>
          <?php endforeach; ?>
        <?php else: ?>
          <div class="grid">
            <?php foreach ($sec['fields'] as $path => $def) {
                echo field_html('f[' . $path . ']', $def, arr_get(content(), $path, ''));
            } ?>
          </div>
        <?php endif; ?>
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
    $hides = $def['hides'] ?? '';
    $limit = (int)($def['limit'] ?? 0);
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

    $out .= '<label for="' . $id . '"><span>' . e($label) . '</span>';
    // Подпись «очистите — пропадёт»: главное правило админки
    if ($hides !== '') {
        $out .= '<i class="tip" title="Очистите поле — с сайта пропадёт ' . e($hides) . '">пусто&nbsp;— скроется</i>';
    }
    $out .= '</label>';

    if ($type === 'textarea' || $type === 'list' || $type === 'lines') {
        // Список, хранящийся массивом, показываем построчно
        $text = is_array($value) ? implode("\n", array_map('strval', $value)) : (string)$value;
        $out .= '<textarea id="' . $id . '" name="' . e($name) . '" rows="' . $rows . '"'
              . ($limit ? ' data-limit="' . $limit . '"' : '') . '>' . e($text) . '</textarea>';
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
        if ($value) {
            // В поле лежит путь от корня сайта. Админка живёт в /admin/,
            // поэтому без url() браузер искал бы картинку в /admin/assets/…
            $src = (string)$value;
            if (!preg_match('~^(https?:)?//~', $src)) $src = url($src);
            $out .= '<img src="' . e($src) . '" alt="">';
        }
        $out .= '</div>';
    } else {
        $out .= '<input id="' . $id . '" type="text" name="' . e($name) . '" value="' . e((string)$value)
              . '"' . ($ph ? ' placeholder="' . e((string)$ph) . '"' : '')
              . ($limit ? ' data-limit="' . $limit . '"' : '') . '>';
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
