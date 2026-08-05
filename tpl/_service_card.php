<article class="home-service-card<?= !empty($s['featured']) ? ' featured' : '' ?>">
  <div class="home-service-top">
    <?php if (trim((string)($s['number'] ?? '')) !== ''): ?>
    <span><?= e($s['number'] ?? '') ?></span>
    <?php endif; ?>
    <span class="icon-box"><?= icon_cycle((int)$n) ?></span>
  </div>
  <?php if (trim((string)($s['name'] ?? '')) !== ''): ?>
  <h3><?php if (!empty($s['href'])): ?><a href="<?= url(ltrim((string)$s['href'], '/')) ?>"><?= e($s['name'] ?? '') ?></a><?php else: ?><?= e($s['name'] ?? '') ?><?php endif; ?></h3>
  <?php endif; ?>
  <?php if (trim((string)($s['text'] ?? '')) !== ''): ?>
  <p><?= e($s['text'] ?? '') ?></p>
  <?php endif; ?>
  <ul>
    <?php foreach (lines($s['features'] ?? '') as $f): ?>
      <li><?= icon('check', 15) ?><?= e($f) ?></li>
    <?php endforeach; ?>
  </ul>
  <div class="home-service-footer">
    <div>
      <?php if (trim((string)($s['price'] ?? '')) !== ''): ?>
      <strong><?= e($s['price'] ?? '') ?></strong>
      <?php endif; ?>
      <?php if (trim((string)($s['note'] ?? '')) !== ''): ?>
      <span><?= e($s['note'] ?? '') ?></span>
      <?php endif; ?>
    </div>
    <div class="home-service-actions">
      <?php if (!empty($s['href'])): ?>
        <a href="<?= url(ltrim((string)$s['href'], '/')) ?>" class="button button-secondary service-details-button">Подробнее</a>
      <?php endif; ?>
      <?= cta_button((string)($s['button'] ?? 'Обсудить проект'), 'button button-primary service-discuss-button') ?>
    </div>
  </div>
</article>
