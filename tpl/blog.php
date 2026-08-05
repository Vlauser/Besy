<?php
/**
 * Список статей — /blog.
 *
 * Пока опубликованных статей нет, посетитель сюда не попадёт: страница
 * закрыта от индексации и не значится в карте сайта. Владельцу сайта
 * при этом видно пояснение, что раздел ждёт первой статьи.
 */
$posts = blog_posts();
?>
<main>

  <?php if (has_any('blog.kicker', 'blog.title', 'blog.lede')): ?>
  <section class="page-hero">
    <div class="container reveal">
      <?php if (trim((string)c('blog.kicker')) !== ''): ?>
        <span class="section-kicker"><?= e(c('blog.kicker')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('blog.title')) !== ''): ?>
        <h1><?= e(c('blog.title')) ?></h1>
      <?php endif; ?>
      <?php if (trim((string)c('blog.lede')) !== ''): ?>
        <p><?= e(c('blog.lede')) ?></p>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <section class="section">
    <div class="container">
      <?php if (!$posts): ?>
        <p class="blog-empty"><?= e(trim((string)c('blog.empty')) ?: 'Статей пока нет.') ?></p>
      <?php else: ?>
        <div class="blog-grid">
          <?php foreach ($posts as $i => $p): ?>
            <?php
            $url  = blog_url((string)$p['slug']);
            $date = blog_date((string)($p['date'] ?? ''));
            ?>
            <article class="post-card">
              <a href="<?= e($url) ?>">
                <?php if (trim((string)($p['image'] ?? '')) !== ''): ?>
                  <div class="post-cover">
                    <?= img_html(
                          (string)$p['image'],
                          'Иллюстрация к статье «' . trim((string)$p['title']) . '»',
                          ['lcp' => $i === 0]
                        ) ?>
                  </div>
                <?php endif; ?>

                <div class="post-meta">
                  <?php if ($date !== ''): ?>
                    <time datetime="<?= e((string)($p['date'] ?? '')) ?>"><?= e($date) ?></time>
                  <?php endif; ?>
                  <h2><?= e($p['title']) ?></h2>
                  <?php if (trim((string)($p['excerpt'] ?? '')) !== ''): ?>
                    <p><?= e($p['excerpt']) ?></p>
                  <?php endif; ?>
                  <span class="post-more">Читать <?= icon('arrow', 16) ?></span>
                </div>
              </a>
            </article>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </section>

  <?php require ROOT . '/tpl/_next.php'; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
