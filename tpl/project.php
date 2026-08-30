<?php
/** @var array $PROJECT */
$project = $PROJECT;
$name = trim((string)($project['name'] ?? ''));
$cat = trim((string)($project['category'] ?? ''));
$short = trim((string)($project['short'] ?? ''));
$desc = trim((string)($project['description'] ?? ''));
$link = trim((string)($project['url'] ?? ''));
$tasks = array_values(array_filter((array)($project['tasks'] ?? [])));
$work = array_values(array_filter((array)($project['work'] ?? [])));
$slug = trim((string)($project['slug'] ?? ''));

if ($slug === 'pravo-legal') {
    $serviceHref = 'website-for-lawyers'; $serviceLabel = 'Сайты для юристов';
} elseif ($slug === 'forma' || ($project['cat'] ?? '') === 'experts') {
    $serviceHref = 'website-for-experts'; $serviceLabel = 'Сайты для экспертов';
} elseif ($slug === 'mellow-coffee') {
    $serviceHref = 'website-for-coffee-shop'; $serviceLabel = 'Сайты для кофеен';
} else {
    $serviceHref = 'landing'; $serviceLabel = 'Лендинги под ключ';
}
?>
<main>
  <section class="case-hero">
    <div class="container">
      <a href="<?= url('projects') ?>" class="back-link">← Все проекты</a>
      <div class="case-heading">
        <div><span class="section-kicker"><?= e($cat) ?></span><h1 class="case-title"><?= e($name) ?></h1></div>
        <div class="case-heading-action">
          <p><?= e($short) ?></p>
          <?php if ($link !== ''): ?><button type="button" class="button button-primary" data-site-preview-open>Посмотреть сайт <span aria-hidden="true">↗</span></button><?php endif; ?>
        </div>
      </div>
      <div class="case-banner visual-large"><?php require ROOT . '/tpl/_project_visual.php'; ?></div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="case-details">
        <div class="case-description">
          <span class="section-kicker">О проекте</span><h2>Задача и решение.</h2>
          <p><?= e($desc) ?> Мы собрали понятный сценарий, индивидуальный визуальный стиль и адаптивную версию, которая ведёт пользователя к целевому действию.</p>
        </div>
        <div class="case-facts">
          <div class="case-fact"><span>Формат</span><strong>Лендинг под ключ</strong></div>
          <div class="case-fact"><span>Срок</span><strong>72 часа</strong></div>
          <div class="case-fact"><span>Команда</span><strong>Маркетолог + дизайнер + AI</strong></div>
          <div class="case-fact"><span>Результат</span><strong>Готовый адаптивный сайт</strong></div>
        </div>
      </div>
      <div class="case-columns">
        <article class="case-list-card"><h3>Что нужно было решить</h3><ul><?php foreach ($tasks as $item): ?><li><?= e($item) ?></li><?php endforeach; ?></ul></article>
        <article class="case-list-card"><h3>Что сделали</h3><ul><?php foreach ($work as $item): ?><li><?= e($item) ?></li><?php endforeach; ?></ul></article>
      </div>
      <div class="case-actions"><a href="<?= url($serviceHref) ?>" class="button button-secondary"><?= e($serviceLabel) ?></a></div>
    </div>
  </section>

  <?php require ROOT . '/tpl/_cta.php'; ?>

  <?php if ($link !== ''): ?>
  <div class="site-preview-backdrop" data-site-preview hidden>
    <section class="site-preview-modal" role="dialog" aria-modal="true" aria-label="Сайт проекта <?= e($name) ?>">
      <header class="site-preview-header"><div><span class="site-preview-dots" aria-hidden="true"><i></i><i></i><i></i></span><strong><?= e($name) ?></strong></div><button type="button" data-site-preview-close aria-label="Закрыть просмотр сайта">×</button></header>
      <div class="site-preview-frame-wrap"><div class="site-preview-loading">Загружаем сайт…</div><iframe class="site-preview-frame" data-site-preview-frame data-src="<?= e($link) ?>" title="Сайт проекта <?= e($name) ?>"></iframe></div>
    </section>
  </div>
  <?php endif; ?>
</main>
