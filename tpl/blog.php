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
        <div class="blog-index-intro"><span>Разбираем реальные задачи бизнеса</span><p>Каждый материал отвечает на один вопрос и ведёт к полезной странице, а не к ещё одной статье ради трафика.</p></div>
        <div class="blog-grid">
          <?php foreach ($posts as $i => $p): ?>
            <?php $BLOG_FIRST = $i === 0; require ROOT . '/tpl/_blog_card.php'; unset($BLOG_FIRST); ?>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </section>

  <?php require ROOT . '/tpl/_next.php'; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
