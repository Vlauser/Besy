<?php require_once ROOT . '/inc/md.php'; ?>
<main>
  <section class="page-hero">
    <div class="container reveal">
      <?php if (trim((string)c('legal.privacy_eyebrow')) !== ''): ?>
      <span class="section-kicker"><?= e(c('legal.privacy_eyebrow')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('legal.privacy_title')) !== ''): ?>
      <h1><?= e(c('legal.privacy_title')) ?></h1>
      <?php endif; ?>
      <?php if ($upd = trim((string)c('legal.privacy_updated'))): ?><p>Редакция от <?= e($upd) ?></p><?php endif; ?>
    </div>
  </section>
  <section class="section">
    <div class="container">
      <article class="legal"><?= md_to_html((string)c('legal.privacy_md')) ?></article>
      <div class="legal-foot">
        <?php if (trim((string)c('site.email')) !== ''): ?>
        <p>Вопросы по обработке данных — на <a href="mailto:<?= e(c('site.email')) ?>"><?= e(c('site.email')) ?></a>.</p>
        <?php endif; ?>
        <a href="<?= url('') ?>" class="button button-secondary">На главную</a>
      </div>
    </div>
  </section>
</main>
