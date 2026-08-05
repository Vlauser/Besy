<?php
$postUrl = blog_url((string)$p['slug']);
$postDate = blog_date((string)($p['date'] ?? ''));
$postTitle = trim((string)($p['card_title'] ?? '')) ?: (string)($p['title'] ?? '');
?>
<article class="post-card">
  <a href="<?= e($postUrl) ?>">
    <?php if (trim((string)($p['image'] ?? '')) !== ''): ?>
      <div class="post-cover"><?= img_html((string)$p['image'], 'Иллюстрация к статье «' . trim((string)($p['title'] ?? '')) . '»', ['lcp' => !empty($BLOG_FIRST)]) ?></div>
    <?php endif; ?>
    <div class="post-meta">
      <?php if (trim((string)($p['category'] ?? '')) !== ''): ?><span class="post-category"><?= e($p['category']) ?></span><?php endif; ?>
      <div class="post-card-data">
        <?php if ($postDate !== ''): ?><time datetime="<?= e((string)($p['date'] ?? '')) ?>"><?= e($postDate) ?></time><?php endif; ?>
        <?php if (trim((string)($p['read_time'] ?? '')) !== ''): ?><span><?= e($p['read_time']) ?></span><?php endif; ?>
      </div>
      <h2><?= e($postTitle) ?></h2>
      <?php if (trim((string)($p['excerpt'] ?? '')) !== ''): ?><p><?= e($p['excerpt']) ?></p><?php endif; ?>
      <span class="post-more">Читать <?= icon('arrow', 16) ?></span>
    </div>
  </a>
</article>
