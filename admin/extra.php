<?php
declare(strict_types=1);

/**
 * Дополнительные разделы админки: индексация, проверка сайта,
 * резервные копии, поиск по контенту. Вынесено отдельно,
 * чтобы не раздувать index.php.
 */

/* Странице «Индексация» нужны те же функции, что и сайту: список статей,
   коммерческие посадочные и вся кухня SEO. Админка их сама не подключает. */
require_once dirname(__DIR__) . '/inc/view.php';
require_once dirname(__DIR__) . '/inc/commercial.php';
require_once dirname(__DIR__) . '/inc/seo.php';

/* ============================================================
   Какой раздел схемы отвечает за ключ контента
   ============================================================ */
function section_for(string $topKey): ?string
{
    foreach (schema() as $secKey => $sec) {
        foreach (array_keys($sec['fields'] ?? []) as $path) {
            if (str_starts_with($path, $topKey . '.')) return $secKey;
        }
        foreach ($sec['repeaters'] ?? [] as $rep) {
            if (str_starts_with((string)$rep['path'], $topKey . '.') || $rep['path'] === $topKey) return $secKey;
        }
    }
    return null;
}

/* ============================================================
   ПРОВЕРКА САЙТА
   ============================================================ */
function health_checks(): array
{
    $out = [];

    $add = function (string $group, string $title, bool $ok, string $hint = '', string $link = '') use (&$out) {
        $out[$group][] = ['title' => $title, 'ok' => $ok, 'hint' => $hint, 'link' => $link];
    };

    /* --- Готовность к запуску --- */
    $g = 'Готовность к запуску';
    $add($g, 'Картинка для соцсетей загружена', trim((string)c('seo.og_image')) !== '',
        'Без неё ссылка на сайт в мессенджерах выглядит серой заглушкой. Размер 1200×630.', 'meta');
    $add($g, 'Фавикон загружен', trim((string)c('seo.favicon')) !== '',
        'Иконка во вкладке браузера.', 'meta');
    $add($g, 'Основной адрес сайта указан', trim((string)c('seo.canonical_host')) !== '',
        'Нужен для canonical и карты сайта.', 'seo');
    $add($g, 'Город организации указан', trim((string)c('seo.org_city')) !== '',
        'Идёт в микроразметку, помогает локальному поиску.', 'seo');
    $add($g, 'Сайт открыт для индексации', empty(c('seo.noindex_all')),
        'Включён запрет индексации всего сайта. Если запуск состоялся — выключите.', 'seo');

    /* --- Заявки доходят --- */
    $g = 'Заявки доходят до вас';
    $tg  = trim((string)c('integrations.telegram_token')) !== '' && trim((string)c('integrations.telegram_chat_id')) !== '';
    $add($g, 'Telegram-бот подключён', $tg,
        'Без него вы узнаёте о заявке, только если сами зайдёте в панель.', 'integrations');
    $add($g, 'Почта для уведомлений указана', trim((string)c('integrations.notify_email')) !== '',
        'Запасной канал на случай, если бот отвалится.', 'integrations');
    $add($g, 'Каналов связи на сайте: ' . count((array)c('site.channels', [])), count((array)c('site.channels', [])) > 0,
        'Добавьте хотя бы один способ связи.', 'site');

    /* --- Аналитика --- */
    $g = 'Аналитика';
    $add($g, 'Счётчик Метрики подключён', trim((string)c('integrations.metrika_id')) !== '',
        'Без него вы не увидите, откуда приходят люди.', 'integrations');
    $add($g, 'Права в Яндекс.Вебмастере подтверждены', trim((string)c('seo.yandex_verify')) !== '',
        'Код подтверждения из Вебмастера.', 'seo');
    $add($g, 'Карта сайта включена', !empty(c('seo.sitemap_on')),
        'Отдаётся по адресу /sitemap.xml', 'seo');

    /* --- Правовая часть --- */
    $g = 'Правовая часть';
    $add($g, 'Текст политики заполнен', mb_strlen(trim((string)c('legal.privacy_md'))) > 500, '', 'legal');
    $add($g, 'Текст согласия заполнен', mb_strlen(trim((string)c('legal.consent_md'))) > 500, '', 'legal');
    $add($g, 'Реквизиты в подвале указаны',
        trim((string)c('site.legal_name')) !== '' && trim((string)c('site.ogrnip')) !== '',
        'По ст. 9 закона о защите прав потребителей.', 'site');
    $add($g, 'Отдельная галочка на рассылку включена', !empty(c('forms.marketing_on')),
        'По ч. 1 ст. 18 закона о рекламе согласие на рассылку должно быть отдельным.', 'forms');

    /* --- Техника --- */
    $g = 'Техника';
    $add($g, 'Папка data доступна для записи', is_writable(DATA_DIR), 'chmod 775 data');
    $add($g, 'Папка uploads доступна для записи', is_writable(UPLOAD_DIR), 'chmod 775 uploads');
    $add($g, 'Установщик удалён', !is_file(ROOT . '/install.php'), 'Удалите install.php с сервера.');
    $add($g, 'PHP 8.1 или новее (' . PHP_VERSION . ')', PHP_VERSION_ID >= 80100);
    $add($g, 'Сайт открывается по HTTPS', !empty($_SERVER['HTTPS']) || ($_SERVER['SERVER_PORT'] ?? '') === '443');

    $fonts = glob(ROOT . '/assets/fonts/*.woff2') ?: [];
    $add($g, 'Шрифты на месте (' . count($fonts) . ')', count($fonts) > 0,
        'Без них сайт покажет системный шрифт.');

    return $out;
}

function render_health(): void
{
    $checks = health_checks();
    $bad = 0;
    foreach ($checks as $items) foreach ($items as $i) if (!$i['ok']) $bad++;
    ?>
    <h1 class="h1">Проверка сайта</h1>
    <p class="sub">Всё, что стоит закрыть перед запуском и рекламой. Список обновляется сам при каждом заходе.</p>

    <?php if ($bad === 0): ?>
      <div class="msg msg--ok">Всё в порядке — незакрытых пунктов нет.</div>
    <?php else: ?>
      <div class="msg msg--warn">Требует внимания: <?= $bad ?></div>
    <?php endif; ?>

    <?php foreach ($checks as $group => $items): ?>
      <div class="box">
        <div class="h2"><?= e($group) ?></div>
        <?php foreach ($items as $i): ?>
          <div class="chk-row">
            <span class="chk-mark <?= $i['ok'] ? 'y' : 'n' ?>"><?= $i['ok'] ? '✓' : '✕' ?></span>
            <div>
              <div class="chk-title"><?= e($i['title']) ?></div>
              <?php if (!$i['ok'] && $i['hint'] !== ''): ?>
                <div class="chk-hint"><?= e($i['hint']) ?></div>
              <?php endif; ?>
            </div>
            <?php if (!$i['ok'] && $i['link'] !== ''): ?>
              <a class="mini" href="<?= url('admin/?action=edit&s=' . urlencode($i['link'])) ?>">Исправить</a>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endforeach; ?>

    <div class="box">
      <div class="h2">Полезные ссылки</div>
      <div class="link-row">
        <a class="mini" href="https://webmaster.yandex.ru/" target="_blank" rel="noopener">Яндекс.Вебмастер</a>
        <a class="mini" href="https://metrika.yandex.ru/" target="_blank" rel="noopener">Яндекс.Метрика</a>
        <a class="mini" href="https://direct.yandex.ru/" target="_blank" rel="noopener">Яндекс.Директ</a>
        <a class="mini" href="https://pd.rkn.gov.ru/" target="_blank" rel="noopener">Роскомнадзор</a>
        <a class="mini" href="<?= e(trim((string)c('seo.canonical_host')) ?: '/') ?>" target="_blank" rel="noopener">Открыть сайт</a>
      </div>
    </div>
    <?php
}

/* ============================================================
   РЕЗЕРВНЫЕ КОПИИ
   ============================================================ */
function render_backup(string $notice, string $error): void
{
    $bak = DATA_DIR . '/content.json.bak.json';
    $cur = DATA_DIR . '/content.json';
    ?>
    <h1 class="h1">Резервные копии</h1>
    <p class="sub">Копия предыдущей версии создаётся автоматически при каждом сохранении. Здесь её можно вернуть или сохранить себе.</p>

    <?php if ($notice): ?><div class="msg msg--ok"><?= e($notice) ?></div><?php endif; ?>
    <?php if ($error): ?><div class="msg msg--err"><?= e($error) ?></div><?php endif; ?>

    <div class="box">
      <div class="h2">Текущая версия</div>
      <p class="sub">Сохранена <?= is_file($cur) ? date('d.m.Y в H:i', (int)filemtime($cur)) : '—' ?>,
         размер <?= is_file($cur) ? round(filesize($cur) / 1024) : 0 ?> КБ.</p>
      <a class="btn btn--gh" href="<?= url('admin/?action=backup&download=1') ?>">Скачать файлом</a>
    </div>

    <div class="box">
      <div class="h2">Предыдущая версия</div>
      <?php if (is_file($bak)): ?>
        <p class="sub">Сохранена <?= date('d.m.Y в H:i', (int)filemtime($bak)) ?>.
           Восстановление заменит весь текущий контент.</p>
        <form method="post">
          <?= csrf_field() ?>
          <input type="hidden" name="mode" value="restore">
          <button class="btn btn--gh" data-confirm="Вернуть предыдущую версию? Текущий контент будет заменён.">Вернуть предыдущую версию</button>
        </form>
      <?php else: ?>
        <p class="sub">Копии пока нет — она появится после первого сохранения.</p>
      <?php endif; ?>
    </div>

    <div class="box">
      <div class="h2">Загрузить из файла</div>
      <p class="sub">Файл content.json, скачанный отсюда ранее. Перед заменой создаётся копия текущей версии.</p>
      <form method="post" enctype="multipart/form-data">
        <?= csrf_field() ?>
        <input type="hidden" name="mode" value="upload">
        <div class="fieldset">
          <input type="file" name="file" accept=".json,application/json" required>
        </div>
        <button class="btn btn--gh" data-confirm="Заменить весь контент содержимым файла?">Загрузить и заменить</button>
      </form>
    </div>
    <?php
}

/* ============================================================
   ПОИСК ПО КОНТЕНТУ
   ============================================================ */
function render_search(): void
{
    $q = trim((string)($_GET['q'] ?? ''));
    ?>
    <h1 class="h1">Поиск по сайту</h1>
    <p class="sub">Найдёт, в каком разделе панели лежит нужный текст. Удобно, когда помните фразу, но не помните где она.</p>

    <form method="get" class="box">
      <input type="hidden" name="action" value="search">
      <div class="fieldset">
        <label><span>Что ищем</span></label>
        <input type="text" name="q" value="<?= e($q) ?>" placeholder="Кусок текста с сайта" autofocus>
      </div>
      <button class="btn">Искать</button>
    </form>

    <?php
    if ($q === '') return;

    $found = [];
    $walk = function ($node, string $path) use (&$walk, &$found, $q) {
        if (is_array($node)) {
            foreach ($node as $k => $v) $walk($v, $path === '' ? (string)$k : $path . '.' . $k);
        } elseif (is_string($node) && $node !== '' && mb_stripos($node, $q) !== false) {
            $found[] = ['path' => $path, 'text' => $node];
        }
    };
    $walk(content(), '');

    if (!$found) {
        echo '<div class="msg msg--warn">Ничего не нашлось. Попробуйте более короткий кусок текста.</div>';
        return;
    }
    ?>
    <div class="box">
      <div class="h2">Найдено: <?= count($found) ?></div>
      <?php foreach (array_slice($found, 0, 60) as $f):
          $top = explode('.', $f['path'])[0];
          $sec = section_for($top);
          $snippet = mb_substr($f['text'], 0, 160) . (mb_strlen($f['text']) > 160 ? '…' : '');
      ?>
        <div class="chk-row">
          <div>
            <div class="chk-title"><?= e($snippet) ?></div>
            <div class="chk-hint"><?= e($f['path']) ?></div>
          </div>
          <?php if ($sec): ?>
            <a class="mini" href="<?= url('admin/?action=edit&s=' . urlencode($sec)) ?>">Открыть раздел</a>
          <?php endif; ?>
        </div>
      <?php endforeach; ?>
      <?php if (count($found) > 60): ?>
        <p class="sub" style="margin-top:12px">Показаны первые 60 совпадений.</p>
      <?php endif; ?>
    </div>
    <?php
}

/* ============================================================
   ИНДЕКСАЦИЯ — что именно уходит в поиск
   ============================================================ */
function render_seo_index(): void
{
    $rows = seo_index_table();
    $open = 0;
    foreach ($rows as $r) if ($r['index']) $open++;
    $noTitle = $noDesc = $longTitle = $longDesc = 0;
    foreach ($rows as $r) {
        if (trim($r['title']) === '') $noTitle++;
        if (trim($r['desc'])  === '') $noDesc++;
        if (mb_strlen($r['title']) > 65) $longTitle++;
        if (mb_strlen($r['desc'])  > 170) $longDesc++;
    }
    $host = trim((string)c('seo.canonical_host'));
    ?>
    <h1 class="h1">Индексация</h1>
    <p class="sub">Что поисковик видит на каждой странице сайта. Синяя строка — это заголовок, по которому
       вас находят и на который кликают в Яндексе. Серая под ним — описание в выдаче. Список собирается сам.</p>

    <div class="note">
      <b>Как это читать</b>
      <span>«Заголовок в выдаче» (title) и «Описание в выдаче» (description) — это НЕ то, что написано на самой
      странице. Это отдельные поля, они видны только в поиске и в ссылке, которую вы отправляете в мессенджер.
      Заголовок на странице (H1) показан справа — он для посетителя. Правятся они в разных местах,
      поэтому в таблице есть кнопки «Изменить» к каждой строке.</span>
    </div>

    <div class="cards">
      <div class="card"><div class="card-num"><?= count($rows) ?></div><div class="card-lbl">страниц всего</div></div>
      <div class="card"><div class="card-num"><?= $open ?></div><div class="card-lbl">открыто для Яндекса</div></div>
      <div class="card"><div class="card-num"><?= count($rows) - $open ?></div><div class="card-lbl">закрыто от индексации</div></div>
      <div class="card"><div class="card-num"><?= $noTitle + $noDesc ?></div><div class="card-lbl">незаполненных полей выдачи</div></div>
    </div>

    <?php if ($noTitle || $noDesc || $longTitle || $longDesc): ?>
      <div class="msg msg--warn">
        <?php
        $w = [];
        if ($noTitle)   $w[] = 'без заголовка выдачи: ' . $noTitle;
        if ($noDesc)    $w[] = 'без описания выдачи: ' . $noDesc;
        if ($longTitle) $w[] = 'заголовок длиннее 65 знаков: ' . $longTitle;
        if ($longDesc)  $w[] = 'описание длиннее 170 знаков: ' . $longDesc;
        echo e(implode(' · ', $w));
        ?>
        — Яндекс обрежет длинное и придумает своё вместо пустого.
      </div>
    <?php endif; ?>

    <?php foreach ($rows as $r): ?>
      <div class="box seo-row">
        <div class="seo-row-head">
          <span class="badge<?= $r['index'] ? '' : ' badge--off' ?>"><?= $r['index'] ? 'в поиске' : 'закрыта' ?></span>
          <code class="seo-path"><?= e('/' . ltrim($r['path'], '/')) ?></code>
          <span class="count"><?= e($r['name']) ?></span>
          <a class="mini" href="<?= url('admin/?action=edit&s=' . urlencode($r['edit'])) ?>">Изменить</a>
          <?php if ($host !== ''): ?>
            <a class="mini" href="<?= e($host . '/' . ltrim($r['path'], '/')) ?>" target="_blank" rel="noopener">Открыть ↗</a>
          <?php endif; ?>
        </div>

        <div class="serp">
          <div class="serp-url"><?= e(preg_replace('~^https?://~', '', $r['url'])) ?></div>
          <?php if (trim($r['title']) !== ''): ?>
            <div class="serp-title"><?= e($r['title']) ?></div>
          <?php else: ?>
            <div class="serp-title serp-empty">Заголовок не заполнен — Яндекс придумает свой</div>
          <?php endif; ?>
          <?php if (trim($r['desc']) !== ''): ?>
            <div class="serp-desc"><?= e($r['desc']) ?></div>
          <?php else: ?>
            <div class="serp-desc serp-empty">Описание не заполнено — Яндекс возьмёт кусок текста со страницы</div>
          <?php endif; ?>
          <div class="serp-meta">
            заголовок <?= mb_strlen($r['title']) ?>/60 · описание <?= mb_strlen($r['desc']) ?>/160
            <?php if (!$r['index'] && $r['why'] !== ''): ?>
              · <b>не индексируется:</b> <?= e($r['why']) ?>
            <?php endif; ?>
          </div>
        </div>

        <?php if (trim($r['h1']) !== ''): ?>
          <div class="seo-h1"><span>Заголовок на самой странице (H1)</span><b><?= e($r['h1']) ?></b></div>
        <?php else: ?>
          <div class="seo-h1 seo-h1--bad"><span>Заголовок на странице (H1)</span><b>не заполнен — поисковику непонятно, о чём страница</b></div>
        <?php endif; ?>
      </div>
    <?php endforeach; ?>

    <div class="box">
      <div class="h2">Куда смотреть дальше</div>
      <div class="link-row">
        <a class="mini" href="<?= url('admin/?action=edit&s=meta') ?>">Заголовки и описания страниц</a>
        <a class="mini" href="<?= url('admin/?action=edit&s=seo') ?>">Общие настройки SEO</a>
        <a class="mini" href="<?= e(($host ?: '') . '/sitemap.xml') ?>" target="_blank" rel="noopener">Карта сайта ↗</a>
        <a class="mini" href="<?= e(($host ?: '') . '/robots.txt') ?>" target="_blank" rel="noopener">robots.txt ↗</a>
        <a class="mini" href="https://webmaster.yandex.ru/" target="_blank" rel="noopener">Яндекс.Вебмастер ↗</a>
      </div>
    </div>
    <?php
}
