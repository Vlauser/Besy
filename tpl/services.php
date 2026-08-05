<main>
  <?php if (has_any('services.kicker', 'services.title', 'services.lede')): ?>
  <section class="page-hero">
    <div class="container reveal">
      <?php if (trim((string)c('services.kicker')) !== ''): ?>
      <span class="section-kicker"><?= e(c('services.kicker')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('services.title')) !== ''): ?>
      <h1><?= e(c('services.title')) ?></h1>
      <?php endif; ?>
      <?php if (trim((string)c('services.lede')) !== ''): ?>
      <p><?= e(c('services.lede')) ?></p>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('services.items')): ?>
  <section class="section">
    <div class="container">
      <div class="home-services-grid">
        <?php foreach ((array)c('services.items', []) as $n => $s): ?>
          <?php require ROOT . '/tpl/_service_card.php'; ?>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_next.php'; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
