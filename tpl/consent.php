<?php require_once ROOT . '/inc/md.php'; ?>
<?php
/**
 * Согласие на обработку персональных данных.
 * Оформление — из макета дизайнера, текст полный (см. privacy.php).
 */
?>
<main>
  <section class="page-hero legal-page">
    <div class="container legal-content">
      <?php if (trim((string)c('legal.consent_eyebrow')) !== ''): ?>
      <span class="section-kicker"><?= e(c('legal.consent_eyebrow')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('legal.consent_title')) !== ''): ?>
      <h1><?= e(c('legal.consent_title')) ?></h1>
      <?php endif; ?>
      <?php if ($upd = trim((string)c('legal.consent_updated'))): ?><p>Редакция от <?= e($upd) ?></p><?php endif; ?>

      <?= md_to_html((string)c('legal.consent_md')) ?>

      <div class="legal-foot">
        <?php if (trim((string)c('site.email')) !== ''): ?>
        <p>Вопросы и отзыв согласия — на <a href="mailto:<?= e(c('site.email')) ?>"><?= e(c('site.email')) ?></a>.</p>
        <?php endif; ?>
        <a href="<?= url('privacy') ?>" class="button button-secondary">Политика обработки</a>
      </div>
    </div>
  </section>
</main>
