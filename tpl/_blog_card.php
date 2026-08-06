<?php
/**
 * Карточка статьи — по макету дизайнера (blog-card).
 *
 * Обложка рисуется цветом, а не картинкой: цвет берётся из CSS по
 * порядку карточки в сетке. Поэтому картинка статье не обязательна.
 *
 * @var array $p
 */
$postUrl   = blog_url((string)$p['slug']);
$postDate  = blog_date((string)($p['date'] ?? ''));
$postTitle = trim((string)($p['card_title'] ?? '')) ?: (string)($p['title'] ?? '');
$postCat   = trim((string)($p['category'] ?? ''));
$postRead  = trim((string)($p['read_time'] ?? ''));
?>
<article class="blog-card">
  <a href="<?= e($postUrl) ?>">
    <div class="blog-card-visual" aria-hidden="true">
      <?php if ($postCat !== ''): ?><span><?= e($postCat) ?></span><?php endif; ?>
      <strong><?= e($postTitle) ?></strong>
      <?php if ($postRead !== ''): ?><i><?= e($postRead) ?></i><?php endif; ?>
    </div>
    <div class="blog-card-copy">
      <?php if ($postDate !== '' || $postRead !== ''): ?>
      <div class="blog-card-meta">
        <?php if ($postDate !== ''): ?><time datetime="<?= e((string)($p['date'] ?? '')) ?>"><?= e($postDate) ?></time><?php endif; ?>
        <?php if ($postRead !== ''): ?><span><?= e($postRead) ?></span><?php endif; ?>
      </div>
      <?php endif; ?>
      <h3><?= e($postTitle) ?></h3>
      <?php if (trim((string)($p['excerpt'] ?? '')) !== ''): ?><p><?= e($p['excerpt']) ?></p><?php endif; ?>
      <strong class="blog-card-link"><?= e(trim((string)c('blog.card_link')) ?: 'Читать') ?> <?= icon('arrow', 16) ?></strong>
    </div>
  </a>
</article>
