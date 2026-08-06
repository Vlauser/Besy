<?php require_once ROOT . '/inc/md.php'; ?>
<?php
/**
 * Страница «О студии» — /about.
 *
 * Иллюстрация и рассказ о студии показываются, только если заполнены
 * в админке. У дизайнера в макете их нет, поэтому пустые поля просто
 * возвращают страницу к её виду.
 */
$aboutImage = trim((string)c('about.image'));
$aboutBody  = trim((string)c('about.body'));
?>
<main>
  <section class="page-hero about-hero">
    <div class="container <?= $aboutImage !== '' ? 'about-hero-grid' : '' ?> reveal">
      <div class="about-hero-copy">
        <?php if (trim((string)c('about.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('about.kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('about.title')) !== ''): ?>
          <h1><?= nl(c('about.title')) ?></h1>
        <?php endif; ?>
        <?php if (trim((string)c('about.lede')) !== ''): ?>
          <p><?= e(c('about.lede')) ?></p>
        <?php endif; ?>
        <?= cta_button('Обсудить проект', 'button button-primary page-hero-button') ?>
      </div>
      <?php if ($aboutImage !== ''): ?>
        <div class="about-hero-art">
          <?= img_html($aboutImage, 'Команда Axiomantic за работой', ['lcp' => true]) ?>
        </div>
      <?php endif; ?>
    </div>
  </section>

  <?php if ($aboutBody !== '' || trim((string)c('about.body_title')) !== ''): ?>
  <section class="section about-body-section">
    <div class="container">
      <?php if (trim((string)c('about.body_title')) !== ''): ?>
        <div class="section-heading compact-heading">
          <h2><?= e(c('about.body_title')) ?></h2>
        </div>
      <?php endif; ?>
      <?php if ($aboutBody !== ''): ?>
        <div class="article-body about-body"><?= md_to_html($aboutBody) ?></div>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <section class="section">
    <div class="container">
      <div class="section-heading split-heading"><div><span class="section-kicker">Кто работает над сайтом</span><h2><?= e(c('about.team_title')) ?></h2></div><p><?= e(c('about.team_lede')) ?></p></div>
      <div class="about-role-grid">
        <?php foreach (array_slice((array)c('about.team', []), 0, 3) as $role): ?>
          <article class="about-role-card">
            <?php if (trim((string)($role['photo'] ?? '')) !== ''): ?>
              <span class="about-role-photo"><?= img_html((string)$role['photo'], trim((string)($role['name'] ?? 'Участник команды')), ['width' => 96, 'height' => 96]) ?></span>
            <?php else: ?>
              <span class="icon-box"><?= icon((string)($role['role'] ?? 'check'), 22) ?></span>
            <?php endif; ?>
            <h3><?= e($role['name'] ?? '') ?></h3>
            <p><?= e($role['bio'] ?? '') ?></p>
          </article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <section class="section about-principles-section">
    <div class="container about-principles">
      <div><span class="section-kicker"><?= e(c('about.values_lede')) ?></span><h2><?= nl(c('about.values_title')) ?></h2></div>
      <div class="about-principle-list">
        <?php foreach (array_slice((array)c('about.values', []), 0, 3) as $value): ?>
          <div><?= icon('spark', 18) ?><span><b><?= e($value['title'] ?? '') ?></b><small><?= e($value['text'] ?? '') ?></small></span></div>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
</main>
