<?php require_once ROOT . '/inc/md.php'; ?>
<?php
/**
 * Политика обработки персональных данных.
 *
 * Оформление — из макета дизайнера (legal-page / legal-content). Текст
 * оставлен полным: в макете там короткая заглушка, а на живом сайте
 * нужен документ, который выдержит проверку по 152-ФЗ.
 */
?>
<main>
  <section class="page-hero legal-page">
    <div class="container legal-content">
      <?php if (trim((string)c('legal.privacy_eyebrow')) !== ''): ?>
      <span class="section-kicker"><?= e(c('legal.privacy_eyebrow')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('legal.privacy_title')) !== ''): ?>
      <h1><?= e(c('legal.privacy_title')) ?></h1>
      <?php endif; ?>
      <?php if ($upd = trim((string)c('legal.privacy_updated'))): ?><p>Редакция от <?= e($upd) ?></p><?php endif; ?>

      <?= md_to_html((string)c('legal.privacy_md')) ?>

      <div class="legal-foot">
        <?php if (trim((string)c('site.email')) !== ''): ?>
        <p>Вопросы по обработке данных — на <a href="mailto:<?= e(c('site.email')) ?>"><?= e(c('site.email')) ?></a>.</p>
        <?php endif; ?>
        <a href="<?= url('') ?>" class="button button-secondary">На главную</a>
      </div>
    </div>
  </section>
</main>
