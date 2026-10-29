<?php
declare(strict_types=1);

/**
 * Разовый инструмент: сравнивает файлы содержимого в папке data
 * и показывает, в каком из них какие настройки заполнены.
 *
 * Открывается только под администратором. После разбора файл
 * нужно удалить с сервера — он больше не нужен.
 */

require_once __DIR__ . '/inc/config.php';
require_once __DIR__ . '/inc/auth.php';
require_once __DIR__ . '/inc/store.php';

require_login();

/** Собираем все .json в data, кроме служебных. */
$files = [];
foreach (glob(DATA_DIR . '/*.json') ?: [] as $path) {
    $base = basename($path);
    if (in_array($base, ['users.json', 'leads.json', 'ratelimit.json',
                         'throttle.json', 'throttle.bak.json', 'design-base.json'], true)) {
        continue;
    }
    $raw = @file_get_contents($path);
    $data = $raw === false ? null : json_decode($raw, true);
    $files[$base] = [
        'path'  => $path,
        'size'  => (int)@filesize($path),
        'time'  => @filemtime($path),
        'data'  => is_array($data) ? $data : null,
    ];
}

/** Настройки, ради которых всё затевалось. */
$watch = [
    'integrations.telegram_token' => 'Telegram — токен бота',
    'integrations.telegram_chat_id' => 'Telegram — chat_id',
    'integrations.notify_email'   => 'Почта для заявок',
    'integrations.metrika_id'     => 'ID Яндекс.Метрики',
    'integrations.head_code'      => 'Код в head',
    'integrations.body_code'      => 'Код перед </body>',
    'seo.yandex_verify'           => 'Яндекс.Вебмастер — код',
    'seo.google_verify'           => 'Search Console — код',
    'seo.canonical_host'          => 'Основной адрес сайта',
];

/** Показываем значение, пряча середину — чтобы токен не светился целиком. */
function mask(string $v): string
{
    $len = mb_strlen($v);
    if ($len === 0) return '';
    if ($len <= 8) return $v;
    return mb_substr($v, 0, 4) . str_repeat('•', min(10, $len - 8)) . mb_substr($v, -4);
}

/** Плоский список «путь => значение», чтобы сравнивать содержимое целиком. */
function flatten(array $arr, string $prefix = ''): array
{
    $out = [];
    foreach ($arr as $k => $v) {
        $key = $prefix === '' ? (string)$k : $prefix . '.' . $k;
        if (is_array($v)) {
            $out += flatten($v, $key);
        } else {
            $out[$key] = is_bool($v) ? ($v ? '1' : '0') : (string)$v;
        }
    }
    return $out;
}

$names = array_keys($files);
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Сравнение файлов содержимого</title>
<style>
  body{margin:0;padding:32px;background:#f4f6fa;color:#111;
       font:15px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  h1{font-size:24px;margin:0 0 6px}
  p.sub{margin:0 0 26px;color:#5c6472}
  .box{background:#fff;border:1px solid #e0e5ed;border-radius:16px;
       padding:22px;margin-bottom:20px;overflow-x:auto}
  h2{font-size:17px;margin:0 0 14px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eef1f6;
        vertical-align:top;white-space:nowrap}
  th{color:#5c6472;font-weight:600}
  td.v{font-family:ui-monospace,Menlo,Consolas,monospace}
  .yes{color:#0a7d32;font-weight:600}
  .no{color:#b4b9c2}
  .win{background:#eaf6ee}
  .note{background:#eef3ff;border:1px solid #c9d9fb;border-radius:12px;
        padding:14px 16px;margin-bottom:20px}
  .warn{background:#fff4e8;border-color:#ffd6a8}
  code{background:#f0f2f7;padding:1px 5px;border-radius:5px}
</style>
</head>
<body>

<h1>Сравнение файлов содержимого</h1>
<p class="sub">Что лежит в папке <code>data</code> и в каком файле сохранились ваши настройки.</p>

<?php if (!$files): ?>
  <div class="note warn">В папке <code>data</code> нет ни одного файла содержимого.</div>
<?php else: ?>

<div class="box">
  <h2>Файлы</h2>
  <table>
    <tr><th>Файл</th><th>Размер</th><th>Изменён</th><th>Читается</th></tr>
    <?php foreach ($files as $n => $f): ?>
      <tr>
        <td><?= e($n) ?><?= $n === 'content.json' ? ' &larr; сайт берёт этот' : '' ?></td>
        <td><?= number_format($f['size'], 0, '.', ' ') ?> Б</td>
        <td><?= $f['time'] ? date('d.m.Y H:i', $f['time']) : '—' ?></td>
        <td><?= $f['data'] === null ? '<span class="no">ошибка JSON</span>' : '<span class="yes">да</span>' ?></td>
      </tr>
    <?php endforeach; ?>
  </table>
</div>

<div class="box">
  <h2>Настройки, которые ищем</h2>
  <table>
    <tr>
      <th>Настройка</th>
      <?php foreach ($names as $n): ?><th><?= e($n) ?></th><?php endforeach; ?>
    </tr>
    <?php foreach ($watch as $path => $label): ?>
      <tr>
        <td><?= e($label) ?></td>
        <?php foreach ($names as $n): ?>
          <?php
          $d = $files[$n]['data'];
          $v = $d === null ? '' : trim((string)(arr_get($d, $path, '') ?? ''));
          ?>
          <td class="v <?= $v !== '' ? 'win' : '' ?>">
            <?= $v !== '' ? '<span class="yes">' . e(mask($v)) . '</span>' : '<span class="no">пусто</span>' ?>
          </td>
        <?php endforeach; ?>
      </tr>
    <?php endforeach; ?>
  </table>
</div>

<?php
/* Разница по текстам — чтобы понять, не потерялись ли правки содержимого */
if (count($names) >= 2):
    $pairs = [];
    for ($i = 0; $i < count($names); $i++) {
        for ($j = $i + 1; $j < count($names); $j++) {
            $a = $files[$names[$i]]['data'];
            $b = $files[$names[$j]]['data'];
            if ($a === null || $b === null) continue;
            $fa = flatten($a);
            $fb = flatten($b);
            $diff = [];
            foreach ($fa + $fb as $k => $_) {
                $va = $fa[$k] ?? '<нет поля>';
                $vb = $fb[$k] ?? '<нет поля>';
                if ($va !== $vb) $diff[$k] = [$va, $vb];
            }
            $pairs[] = [$names[$i], $names[$j], $diff];
        }
    }
?>
  <?php foreach ($pairs as [$na, $nb, $diff]): ?>
    <div class="box">
      <h2>Чем отличается <?= e($na) ?> от <?= e($nb) ?></h2>
      <?php if (!$diff): ?>
        <p>Ничем — содержимое совпадает полностью.</p>
      <?php else: ?>
        <p class="sub">Различий: <?= count($diff) ?>. Показаны первые 60.</p>
        <table>
          <tr><th>Поле</th><th><?= e($na) ?></th><th><?= e($nb) ?></th></tr>
          <?php foreach (array_slice($diff, 0, 60, true) as $k => [$va, $vb]): ?>
            <tr>
              <td class="v"><?= e($k) ?></td>
              <td class="v"><?= e(mb_substr($va, 0, 60)) ?></td>
              <td class="v"><?= e(mb_substr($vb, 0, 60)) ?></td>
            </tr>
          <?php endforeach; ?>
        </table>
      <?php endif; ?>
    </div>
  <?php endforeach; ?>
<?php endif; ?>

<?php endif; ?>

<div class="note warn">
  Когда разберётесь — удалите файл <code>sravnit.php</code> с сервера.
</div>

</body>
</html>
