<?php
/* Уровень заголовка карточки. На главной над сеткой стоит заголовок
   раздела, поэтому карточка идёт третьим уровнем. На /services сетка
   следует сразу за заголовком страницы, и карточка должна быть вторым:
   пропуск ступени поисковики считают ошибкой структуры. */
$cardH = $CARD_H ?? 'h3';
?>
<article class="home-service-card<?= !empty($s['featured']) ? ' featured' : '' ?>">
  <div class="home-service-top">
    <?php if (trim((string)($s['number'] ?? '')) !== ''): ?>
    <span><?= e($s['number'] ?? '') ?></span>
    <?php endif; ?>
    <span class="icon-box"><?= icon_cycle((int)$n) ?></span>
  </div>
  <?php if (trim((string)($s['name'] ?? '')) !== ''): ?>
  <<?= $cardH ?>><?php if (!empty($s['href'])): ?><a href="<?= url(ltrim((string)$s['href'], '/')) ?>"><?= e($s['name'] ?? '') ?></a><?php else: ?><?= e($s['name'] ?? '') ?><?php endif; ?></<?= $cardH ?>>
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
