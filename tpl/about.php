<?php
require_once ROOT . '/inc/md.php';

/**
 * Страница «О студии» — /about.
 *
 * Закрывает раздел 15 ТЗ: кто вы, как работаете, кто делает работу.
 * Для молодого домена без отзывов и ссылок это главный источник доверия.
 * Всё правится в админке, пустые блоки не выводятся.
 */
?>
<main>

  <?php if (has_any('about.kicker', 'about.title', 'about.lede', 'about.image')): ?>
  <section class="page-hero about-hero">
    <div class="container about-hero-grid reveal">
      <div>
        <?php if (trim((string)c('about.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('about.kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('about.title')) !== ''): ?>
          <h1><?= e(c('about.title')) ?></h1>
        <?php endif; ?>
        <?php if (trim((string)c('about.lede')) !== ''): ?>
          <p><?= e(c('about.lede')) ?></p>
        <?php endif; ?>
      </div>
      <?php if ($aboutImg = trim((string)c('about.image'))): ?>
        <div class="about-art">
          <?= img_html($aboutImg, 'Фирменный персонаж ' . (string)c('site.brand'), ['lcp' => true]) ?>
        </div>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('about.body_title', 'about.body')): ?>
  <section class="section about-body-section">
    <div class="container about-body-layout">
      <?php if (trim((string)c('about.body_title')) !== ''): ?>
        <div class="section-heading">
          <h2><?= e(c('about.body_title')) ?></h2>
        </div>
      <?php endif; ?>
      <?php if (trim((string)c('about.body')) !== ''): ?>
        <article class="prose"><?= md_to_html((string)c('about.body')) ?></article>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('about.values_title', 'about.values_lede', 'about.values')): ?>
  <section class="section about-values-section">
    <div class="container">
      <div class="section-heading">
        <?php if (trim((string)c('about.values_title')) !== ''): ?>
          <h2><?= e(c('about.values_title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('about.values_lede')) !== ''): ?>
          <p><?= e(c('about.values_lede')) ?></p>
        <?php endif; ?>
      </div>

      <div class="values-grid">
        <?php foreach ((array)c('about.values', []) as $n => $v): ?>
          <?php if (trim((string)($v['title'] ?? '')) === '') continue; ?>
          <article class="value-card">
            <span class="icon-box"><?= icon_cycle((int)$n) ?></span>
            <h3><?= e($v['title']) ?></h3>
            <?php if (trim((string)($v['text'] ?? '')) !== ''): ?>
              <p><?= e($v['text']) ?></p>
            <?php endif; ?>
          </article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('about.team_title', 'about.team_lede', 'about.team')): ?>
  <section class="section about-team-section">
    <div class="container">
      <div class="section-heading">
        <?php if (trim((string)c('about.team_title')) !== ''): ?>
          <h2><?= e(c('about.team_title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('about.team_lede')) !== ''): ?>
          <p><?= e(c('about.team_lede')) ?></p>
        <?php endif; ?>
      </div>

      <?php if (has_any('about.team')): ?>
        <div class="team-grid">
          <?php foreach ((array)c('about.team', []) as $m): ?>
            <?php if (trim((string)($m['name'] ?? '')) === '') continue; ?>
            <article class="team-card">
              <?php if (trim((string)($m['photo'] ?? '')) !== ''): ?>
                <span class="team-photo">
                  <?= img_html((string)$m['photo'], 'Фото: ' . trim((string)$m['name'])) ?>
                </span>
              <?php endif; ?>
              <b><?= e($m['name']) ?></b>
              <?php if (trim((string)($m['role'] ?? '')) !== ''): ?>
                <i><?= e($m['role']) ?></i>
              <?php endif; ?>
              <?php if (trim((string)($m['bio'] ?? '')) !== ''): ?>
                <p><?= e($m['bio']) ?></p>
              <?php endif; ?>
              <?php if (($lnk = trim((string)($m['link'] ?? ''))) !== ''): ?>
                <a href="<?= e($lnk) ?>" target="_blank" rel="noopener nofollow">Профиль <?= icon('arrow', 14) ?></a>
              <?php endif; ?>
            </article>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_next.php'; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
