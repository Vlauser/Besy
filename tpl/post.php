<?php
require_once ROOT . '/inc/md.php';

/**
 * Страница статьи — /blog/<ключ>.
 *
 * Текст пишется разметкой в админке. Внизу — переход на коммерческую
 * страницу: по разделу 21 ТЗ каждая статья должна вести к услуге,
 * цене или кейсу, иначе трафик из блога никуда не превращается.
 *
 * @var array $POST
 */
$p = $POST;

$date    = blog_date((string)($p['date'] ?? ''));
$updated = blog_date((string)($p['updated'] ?? ''));
$author  = trim((string)($p['author'] ?? ''));
$cover   = trim((string)($p['image'] ?? ''));

$nextUrl   = trim((string)($p['next'] ?? ''));
$nextLabel = trim((string)($p['next_label'] ?? '')) ?: 'Смотреть подробнее';

// Соседние статьи для перехода внизу
$all  = blog_posts();
$idx  = (int)($p['_index'] ?? 0);
$prev = $all[$idx + 1] ?? null;   // список отсортирован свежими вперёд
$next = $idx > 0 ? ($all[$idx - 1] ?? null) : null;
?>
<main class="post-page">

  <section class="page-hero post-hero">
    <div class="container reveal">
      <div class="post-hero-meta">
        <?php if ($date !== ''): ?>
          <time datetime="<?= e((string)($p['date'] ?? '')) ?>"><?= e($date) ?></time>
        <?php endif; ?>
        <?php if ($author !== ''): ?>
          <span><?= e($author) ?></span>
        <?php endif; ?>
      </div>
      <h1><?= e($p['title']) ?></h1>
      <?php if (trim((string)($p['excerpt'] ?? '')) !== ''): ?>
        <p><?= e($p['excerpt']) ?></p>
      <?php endif; ?>
    </div>
  </section>

  <?php if ($cover !== ''): ?>
    <section class="section post-cover-section">
      <div class="container">
        <div class="post-cover-big">
          <?= img_html($cover, 'Иллюстрация к статье «' . trim((string)$p['title']) . '»', ['lcp' => true]) ?>
        </div>
      </div>
    </section>
  <?php endif; ?>

  <section class="section post-body-section">
    <div class="container post-layout">
      <article class="prose"><?= md_to_html((string)($p['body'] ?? '')) ?></article>

      <?php if ($updated !== '' && $updated !== $date): ?>
        <p class="post-updated">Материал обновлён <?= e($updated) ?></p>
      <?php endif; ?>

      <?php if ($nextUrl !== ''): ?>
        <div class="post-next">
          <a href="<?= e($nextUrl) ?>" class="button button-primary"><?= e($nextLabel) ?></a>
        </div>
      <?php endif; ?>
    </div>
  </section>

  <?php if ($prev || $next): ?>
    <section class="section post-nav-section">
      <div class="container">
        <nav class="project-nav" aria-label="Другие статьи">
          <?php if ($prev): ?>
            <a href="<?= e(blog_url((string)$prev['slug'])) ?>" class="project-nav-item">
              <span>Предыдущая статья</span>
              <b><?= e((string)$prev['title']) ?></b>
            </a>
          <?php endif; ?>
          <?php if ($next): ?>
            <a href="<?= e(blog_url((string)$next['slug'])) ?>" class="project-nav-item project-nav-next">
              <span>Следующая статья</span>
              <b><?= e((string)$next['title']) ?></b>
            </a>
          <?php endif; ?>
        </nav>

        <div class="section-action">
          <a href="<?= url('blog') ?>" class="button button-secondary">Все статьи</a>
        </div>
      </div>
    </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
