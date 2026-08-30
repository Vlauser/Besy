<?php
declare(strict_types=1);
require_once __DIR__ . '/store.php';

/**
 * Авторизация в админке.
 * Пароли хранятся только в виде хеша, в открытом виде нигде не сохраняются.
 */

function auth_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;

    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_name('axm_admin');
    session_start();
}

function users(): array
{
    return store_read('users', ['users' => []])['users'] ?? [];
}

function users_exist(): bool
{
    return count(users()) > 0;
}

function user_create(string $login, string $password, string $role = 'admin', string $name = ''): bool
{
    $data = store_read('users', ['users' => []]);
    $login = strtolower(trim($login));

    foreach ($data['users'] as $u) {
        if ($u['login'] === $login) return false;
    }

    $data['users'][] = [
        'login'   => $login,
        'name'    => $name !== '' ? $name : $login,
        'hash'    => password_hash($password, PASSWORD_DEFAULT),
        'role'    => $role,               // admin — всё, editor — только контент
        'created' => date('c'),
    ];
    return store_write('users', $data);
}

function user_update_password(string $login, string $password): bool
{
    $data = store_read('users', ['users' => []]);
    foreach ($data['users'] as &$u) {
        if ($u['login'] === strtolower(trim($login))) {
            $u['hash'] = password_hash($password, PASSWORD_DEFAULT);
            return store_write('users', $data);
        }
    }
    return false;
}

function user_delete(string $login): bool
{
    $data = store_read('users', ['users' => []]);
    $data['users'] = array_values(array_filter(
        $data['users'],
        fn($u) => $u['login'] !== strtolower(trim($login))
    ));
    if (count($data['users']) === 0) return false; // последнего админа не удаляем
    return store_write('users', $data);
}

/* ---------- вход ---------- */

function throttle_key(): string
{
    return 'lg_' . md5(($_SERVER['REMOTE_ADDR'] ?? '0') . ($_SERVER['HTTP_USER_AGENT'] ?? ''));
}

function login_blocked(): int
{
    $t = store_read('throttle', []);
    $rec = $t[throttle_key()] ?? null;
    if (!$rec) return 0;
    if (($rec['count'] ?? 0) < 5) return 0;
    $left = ($rec['until'] ?? 0) - time();
    return $left > 0 ? $left : 0;
}

function login_fail(): void
{
    $t = store_read('throttle', []);
    $k = throttle_key();
    $rec = $t[$k] ?? ['count' => 0, 'until' => 0];
    $rec['count']++;
    if ($rec['count'] >= 5) $rec['until'] = time() + 300; // 5 минут паузы
    $t[$k] = $rec;

    // Чистим просроченные записи, чтобы файл не рос
    foreach ($t as $key => $v) {
        if (($v['until'] ?? 0) < time() - 3600) unset($t[$key]);
    }
    store_write('throttle', $t);
}

function login_ok(string $login): void
{
    $t = store_read('throttle', []);
    unset($t[throttle_key()]);
    store_write('throttle', $t);

    session_regenerate_id(true);
    foreach (users() as $u) {
        if ($u['login'] === $login) {
            $_SESSION['user'] = ['login' => $u['login'], 'name' => $u['name'], 'role' => $u['role']];
            break;
        }
    }
    $_SESSION['last'] = time();
}

function attempt_login(string $login, string $password): bool
{
    $login = strtolower(trim($login));
    foreach (users() as $u) {
        if ($u['login'] === $login && password_verify($password, $u['hash'])) {
            login_ok($login);
            return true;
        }
    }
    login_fail();
    return false;
}

function logout(): void
{
    auth_start();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        setcookie(session_name(), '', time() - 42000, '/');
    }
    session_destroy();
}

function current_user(): ?array
{
    auth_start();
    if (empty($_SESSION['user'])) return null;

    // Автовыход после 8 часов бездействия
    if (isset($_SESSION['last']) && time() - $_SESSION['last'] > 28800) {
        logout();
        return null;
    }
    $_SESSION['last'] = time();
    return $_SESSION['user'];
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        header('Location: ' . url('admin/?action=login'));
        exit;
    }
    return $u;
}

function is_admin(): bool
{
    $u = current_user();
    return $u && ($u['role'] ?? '') === 'admin';
}

/* ---------- CSRF ---------- */

function csrf_token(): string
{
    auth_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function csrf_check(): void
{
    auth_start();
    $sent = $_POST['_csrf'] ?? '';
    if (!is_string($sent) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
        http_response_code(419);
        exit('Сессия устарела. Обновите страницу и попробуйте ещё раз.');
    }
}
