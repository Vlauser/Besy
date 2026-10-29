<?php
/**
 * Отзывы клиентов — по макету дизайнера (testimonials-section).
 *
 * Отзыв с отметкой «черновик» показывается с плашкой «Текст для замены»:
 * так владелец видит, где заменить текст, а посетитель понимает, что
 * это заготовка. В микроразметку Review черновики не попадают — см.
 * seo_reviews() в inc/seo.php. Если отзывов нет вовсе, блока нет тоже.
 */
$items = array_values(array_filter(
    (array)c('reviews.items', []),
    fn($r) => is_array($r) && trim((string)($r['text'] ?? '')) !== ''
));
if (!$items) return;
?>
<section class="section testimonials-section" id="reviews">
  <div class="container">
    <div class="section-heading split-heading">
      <div>
        <?php if (trim((string)c('reviews.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('reviews.kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('reviews.title')) !== ''): ?>
          <h2><?= e(c('reviews.title')) ?></h2>
        <?php endif; ?>
      </div>
      <?php if (trim((string)c('reviews.lede')) !== ''): ?>
        <p><?= e(c('reviews.lede')) ?></p>
      <?php endif; ?>
    </div>

    <div class="testimonials-grid">
      <?php foreach ($items as $r): ?>
        <?php
        $author = trim((string)($r['author'] ?? ''));
        $role   = trim((string)($r['role'] ?? ''));
        /* Кружок с буквой — как в макете; берём первую букву имени */
        $letter = $author !== '' ? mb_strtoupper(mb_substr($author, 0, 1)) : '';
        ?>
        <article class="testimonial-card">
          <?php if (!empty($r['draft'])): ?>
            <span class="testimonial-draft"><?= e(trim((string)c('reviews.draft_label')) ?: 'Текст для замены') ?></span>
          <?php endif; ?>

          <blockquote>«<?= e($r['text']) ?>»</blockquote>

          <?php if ($author !== '' || $role !== ''): ?>
          <div class="testimonial-author">
            <?php if ($letter !== ''): ?><span><?= e($letter) ?></span><?php endif; ?>
            <div>
              <?php if ($author !== ''): ?><strong><?= e($author) ?></strong><?php endif; ?>
              <?php if ($role !== ''): ?><small><?= e($role) ?></small><?php endif; ?>
            </div>
          </div>
          <?php endif; ?>
        </article>
      <?php endforeach; ?>
    </div>
  </div>
</section>
