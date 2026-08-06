<?php
require_once ROOT . '/inc/md.php';

/**
 * Страница статьи — /blog/<ключ>. Раскладка по макету дизайнера.
 *
 * Слева карточка «короткий ответ» со ссылкой на коммерческую страницу,
 * справа текст секциями. Внизу — «Ещё по теме»: по разделу 21 ТЗ каждая
 * статья должна вести к услуге, цене или кейсу, иначе трафик из блога
 * никуда не превращается.
 *
 * @var array $POST
 */
$p = $POST;

$date    = blog_date((string)($p['date'] ?? ''));
$updated = blog_date((string)($p['updated'] ?? ''));
$author  = trim((string)($p['author'] ?? '')) ?: trim((string)c('blog.author'));
$read    = trim((string)($p['read_time'] ?? ''));
$cat     = trim((string)($p['category'] ?? ''));

$nextUrl   = trim((string)($p['next'] ?? ''));
$nextLabel = trim((string)($p['next_label'] ?? '')) ?: 'Смотреть подробнее';

/* Раскладка текста: «короткий ответ» отдельно, остальное секциями */
$article = article_layout(md_to_html((string)($p['body'] ?? '')));
$summary = trim((string)($p['summary'] ?? '')) ?: $article['summary'];

/* Ещё по теме — три другие статьи */
$related = [];
foreach (blog_posts() as $other) {
    if ((string)$other['slug'] === (string)$p['slug']) continue;
    $related[] = $other;
    if (count($related) === 3) break;
}
?>
<main>
  <article>
    <header class="article-hero">
      <div class="container article-hero-inner">
        <?php require ROOT . '/tpl/_crumbs.php'; ?>
        <?php if ($cat !== ''): ?><span class="section-kicker"><?= e($cat) ?></span><?php endif; ?>
        <h1><?= e($p['title']) ?></h1>
        <?php /* Под заголовком стоит вступление; если его не заполнили —
                 покажем короткое описание из карточки */ ?>
        <?php if (($lede = trim((string)($p['lede'] ?? '')) ?: trim((string)($p['excerpt'] ?? ''))) !== ''): ?>
          <p><?= e($lede) ?></p>
        <?php endif; ?>
        <?php if ($date !== '' || $read !== '' || $author !== ''): ?>
        <div class="article-meta">
          <?php if ($date !== ''): ?><time datetime="<?= e((string)($p['date'] ?? '')) ?>"><?= e($date) ?></time><?php endif; ?>
          <?php if ($read !== ''): ?><span><?= e($read) ?></span><?php endif; ?>
          <?php if ($author !== ''): ?><span><?= e($author) ?></span><?php endif; ?>
        </div>
        <?php endif; ?>
      </div>
    </header>

    <div class="section article-section">
      <div class="container article-layout">
        <?php if ($summary !== '' || $nextUrl !== ''): ?>
        <aside class="article-summary">
          <?php if (trim((string)c('blog.summary_label')) !== ''): ?>
            <span><?= e(c('blog.summary_label')) ?></span>
          <?php endif; ?>
          <?php if ($summary !== ''): ?><p><?= $summary ?></p><?php endif; ?>
          <?php if ($nextUrl !== ''): ?>
            <a href="<?= e($nextUrl) ?>" class="text-link"><?= e($nextLabel) ?> <?= icon('arrow', 16) ?></a>
          <?php endif; ?>
        </aside>
        <?php endif; ?>

        <div class="article-body">
          <?= $article['body'] ?>

          <?php if ($updated !== '' && $updated !== $date): ?>
            <p class="post-updated">Материал обновлён <?= e($updated) ?></p>
          <?php endif; ?>

          <?php if (has_any('blog.cta_title', 'blog.cta_kicker')): ?>
          <div class="article-cta-inline">
            <?php if (trim((string)c('blog.cta_kicker')) !== ''): ?>
              <span><?= e(c('blog.cta_kicker')) ?></span>
            <?php endif; ?>
            <?php if (trim((string)c('blog.cta_title')) !== ''): ?>
              <h2><?= e(c('blog.cta_title')) ?></h2>
            <?php endif; ?>
            <?= cta_button(trim((string)c('blog.cta_button')) ?: 'Обсудить проект', 'button button-primary') ?>
          </div>
          <?php endif; ?>
        </div>
      </div>
    </div>
  </article>

  <?php if ($related): ?>
  <section class="section article-related-section">
    <div class="container">
      <div class="section-heading compact-heading">
        <?php if (trim((string)c('blog.related_kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('blog.related_kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('blog.related_title')) !== ''): ?>
          <h2><?= e(c('blog.related_title')) ?></h2>
        <?php endif; ?>
      </div>
      <div class="blog-grid blog-grid-related">
        <?php foreach ($related as $p): require ROOT . '/tpl/_blog_card.php'; endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
