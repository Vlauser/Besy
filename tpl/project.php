<?php
/**
 * Страница одной работы: /projects/<ключ>.
 *
 * Весь текст берётся из карточки проекта в админке. Пустые поля
 * не выводятся — если у работы заполнено только название и скриншот,
 * страница всё равно останется целой.
 *
 * @var array $PROJECT
 */
$p = $PROJECT;

$name  = trim((string)($p['name'] ?? ''));
$cat   = trim((string)($p['category'] ?? ''));
$short = trim((string)($p['short'] ?? ''));
$desc  = trim((string)($p['description'] ?? ''));
$link  = trim((string)($p['url'] ?? ''));
$shot  = trim((string)($p['image'] ?? ''));

$tasks = array_values(array_filter(array_map('trim', (array)($p['tasks'] ?? []))));
$work  = array_values(array_filter(array_map('trim', (array)($p['work']  ?? []))));
$tech  = array_values(array_filter(array_map('trim', (array)($p['tech']  ?? []))));

$near = work_neighbours((int)($p['_index'] ?? 0));
?>
<main class="project-page">

  <section class="page-hero project-hero">
    <div class="container reveal">
      <?php if ($cat !== ''): ?>
        <span class="section-kicker"><?= e($cat) ?></span>
      <?php endif; ?>
      <?php if ($name !== ''): ?>
        <h1><?= e($name) ?></h1>
      <?php endif; ?>
      <?php if ($short !== ''): ?>
        <p><?= e($short) ?></p>
      <?php endif; ?>
      <?php if ($link !== ''): ?>
        <div class="project-hero-actions">
          <a href="<?= e($link) ?>" class="button button-primary" target="_blank" rel="noopener">
            Открыть сайт проекта
          </a>
        </div>
      <?php endif; ?>
    </div>
  </section>

  <?php if ($shot !== ''): ?>
    <section class="section project-shot-section">
      <div class="container">
        <div class="project-shot">
          <?= img_html($shot, 'Сайт проекта ' . $name . ($cat !== '' ? ' — ' . $cat : ''), ['lcp' => true]) ?>
        </div>
      </div>
    </section>
  <?php endif; ?>

  <?php if ($desc !== '' || $tasks || $work || $tech): ?>
    <section class="section project-body">
      <div class="container project-layout">

        <div class="project-main">
          <?php if ($desc !== ''): ?>
            <div class="project-lead">
              <h2>О проекте</h2>
              <p><?= nl($desc) ?></p>
            </div>
          <?php endif; ?>

          <?php if ($tasks): ?>
            <div class="project-block">
              <h2>Задачи</h2>
              <ul class="project-list">
                <?php foreach ($tasks as $t): ?>
                  <li><?= icon('check', 16) ?><span><?= e($t) ?></span></li>
                <?php endforeach; ?>
              </ul>
            </div>
          <?php endif; ?>

          <?php if ($work): ?>
            <div class="project-block">
              <h2>Что сделали</h2>
              <ul class="project-list">
                <?php foreach ($work as $w): ?>
                  <li><?= icon('check', 16) ?><span><?= e($w) ?></span></li>
                <?php endforeach; ?>
              </ul>
            </div>
          <?php endif; ?>
        </div>

        <aside class="project-aside">
          <div class="project-facts">
            <?php if ($cat !== ''): ?>
              <div><span>Направление</span><b><?= e($cat) ?></b></div>
            <?php endif; ?>
            <?php if ($tech): ?>
              <div>
                <span>Технологии</span>
                <div class="project-tags">
                  <?php foreach ($tech as $t): ?>
                    <i><?= e($t) ?></i>
                  <?php endforeach; ?>
                </div>
              </div>
            <?php endif; ?>
            <?php if ($link !== ''): ?>
              <div>
                <span>Адрес</span>
                <a href="<?= e($link) ?>" target="_blank" rel="noopener"><?= e(preg_replace('~^https?://~', '', $link)) ?></a>
              </div>
            <?php endif; ?>
          </div>

          <?php if (trim((string)c('site.header_cta')) !== ''): ?>
            <div class="project-cta">
              <p>Нужен такой же сайт?</p>
              <?= cta_button((string)c('site.header_cta'), 'button button-primary') ?>
            </div>
          <?php endif; ?>
        </aside>

      </div>
    </section>
  <?php endif; ?>

  <?php if ($near['prev'] || $near['next']): ?>
    <section class="section project-nav-section">
      <div class="container">
        <nav class="project-nav" aria-label="Другие проекты">
          <?php if ($near['prev']): ?>
            <a href="<?= e(work_url((string)$near['prev']['slug'])) ?>" class="project-nav-item">
              <span>Предыдущий проект</span>
              <b><?= e((string)($near['prev']['name'] ?? '')) ?></b>
            </a>
          <?php endif; ?>
          <?php if ($near['next']): ?>
            <a href="<?= e(work_url((string)$near['next']['slug'])) ?>" class="project-nav-item project-nav-next">
              <span>Следующий проект</span>
              <b><?= e((string)($near['next']['name'] ?? '')) ?></b>
            </a>
          <?php endif; ?>
        </nav>

        <div class="section-action">
          <a href="<?= url('projects') ?>" class="button button-secondary">Все проекты</a>
        </div>
      </div>
    </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
