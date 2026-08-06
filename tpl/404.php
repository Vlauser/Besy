<?php
/**
 * Страница 404. Все тексты и картинка берутся из админки, раздел
 * «Страница 404». Пустое поле — элемент просто не показывается.
 */
$e404img = trim((string)c('error404.image'));
?>
<main>
  <section class="not-found-section">
    <div class="container not-found-grid">
      <div>
        <?php if (trim((string)c('error404.code')) !== ''): ?>
          <span class="section-kicker">Ошибка <?= e(c('error404.code')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('error404.title')) !== ''): ?>
          <h1><?= e(c('error404.title')) ?></h1>
        <?php endif; ?>
        <?php if (trim((string)c('error404.text')) !== ''): ?>
          <p><?= nl(c('error404.text')) ?></p>
        <?php endif; ?>
        <?php if (has_any('error404.btn_home', 'error404.btn_projects')): ?>
        <div class="hero-actions">
          <?php if (trim((string)c('error404.btn_home')) !== ''): ?>
            <a href="<?= url('') ?>" class="button button-primary"><?= e(c('error404.btn_home')) ?></a>
          <?php endif; ?>
          <?php if (trim((string)c('error404.btn_projects')) !== ''): ?>
            <a href="<?= url('contacts') ?>" class="button button-secondary"><?= e(c('error404.btn_projects')) ?></a>
          <?php endif; ?>
        </div>
        <?php endif; ?>
      </div>
      <?php if ($e404img !== ''): ?>
        <?= img_html($e404img, 'Персонаж Axiomantic ищет нужную страницу') ?>
      <?php endif; ?>
    </div>
  </section>
</main>
