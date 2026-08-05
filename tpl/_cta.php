<?php if (has_any('cta.kicker', 'cta.title', 'cta.text', 'cta.button', 'cta.image')): ?>
<section class="section cta-section">
  <div class="container">
    <div class="cta-card">
      <div class="cta-copy">
        <?php if (trim((string)c('cta.kicker')) !== ''): ?>
        <span class="section-kicker"><?= e(c('cta.kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('cta.title')) !== ''): ?>
        <h2><?= e(c('cta.title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('cta.text')) !== ''): ?>
        <p><?= e(c('cta.text')) ?></p>
        <?php endif; ?>
        <?php if (trim((string)c('cta.button')) !== ''): ?>
        <?= cta_button((string)c('cta.button'), 'button button-primary') ?>
        <?php endif; ?>
      </div>
      <?php if ($ctaimg = trim((string)c('cta.image'))): ?>
        <div class="cta-art"><?= img_html($ctaimg, 'Фирменный персонаж ' . (string)c('site.brand')) ?></div>
      <?php endif; ?>
    </div>
  </div>
</section>
<?php endif; ?>
