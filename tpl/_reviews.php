<?php
/**
 * Отзывы клиентов.
 *
 * Пока в админку не добавлен ни один отзыв, блок не выводится вовсе —
 * пустая полоса «здесь могли быть отзывы» вредит доверию сильнее,
 * чем их отсутствие. Микроразметка Review отдаётся из inc/seo.php.
 */
if (!has_any('reviews.items')) return;

$items = array_values(array_filter(
    (array)c('reviews.items', []),
    fn($r) => is_array($r) && trim((string)($r['text'] ?? '')) !== ''
));
if (!$items) return;
?>
<section class="section reviews-section" id="reviews">
  <div class="container">
    <div class="section-heading">
      <?php if (trim((string)c('reviews.kicker')) !== ''): ?>
        <span class="section-kicker"><?= e(c('reviews.kicker')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('reviews.title')) !== ''): ?>
        <h2><?= e(c('reviews.title')) ?></h2>
      <?php endif; ?>
      <?php if (trim((string)c('reviews.lede')) !== ''): ?>
        <p><?= e(c('reviews.lede')) ?></p>
      <?php endif; ?>
    </div>

    <div class="reviews-grid">
      <?php foreach ($items as $r): ?>
        <?php
        $rating = (int)($r['rating'] ?? 0);
        $case   = trim((string)($r['case'] ?? ''));
        $work   = $case !== '' ? work_item($case) : null;
        ?>
        <article class="review-card">
          <?php if ($rating >= 1 && $rating <= 5): ?>
            <div class="review-stars" aria-label="Оценка <?= $rating ?> из 5">
              <?php for ($i = 1; $i <= 5; $i++): ?>
                <span<?= $i <= $rating ? ' class="on"' : '' ?> aria-hidden="true">★</span>
              <?php endfor; ?>
            </div>
          <?php endif; ?>

          <blockquote><?= nl($r['text']) ?></blockquote>

          <footer class="review-author">
            <?php if (trim((string)($r['avatar'] ?? '')) !== ''): ?>
              <span class="review-avatar">
                <?= img_html((string)$r['avatar'], 'Фото: ' . trim((string)($r['author'] ?? '')), ['width' => 48, 'height' => 48]) ?>
              </span>
            <?php endif; ?>
            <span>
              <?php if (trim((string)($r['author'] ?? '')) !== ''): ?>
                <b><?= e($r['author']) ?></b>
              <?php endif; ?>
              <?php if (trim((string)($r['role'] ?? '')) !== ''): ?>
                <i><?= e($r['role']) ?></i>
              <?php endif; ?>
            </span>
          </footer>

          <?php if ($work): ?>
            <a class="review-case" href="<?= e(work_url($case)) ?>">
              Посмотреть проект <?= e((string)($work['name'] ?? '')) ?> <?= icon('arrow', 15) ?>
            </a>
          <?php endif; ?>
        </article>
      <?php endforeach; ?>
    </div>
  </div>
</section>
