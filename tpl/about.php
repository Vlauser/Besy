<main>
  <section class="page-hero about-hero">
    <div class="container reveal">
      <span class="section-kicker"><?= e(c('about.kicker')) ?></span>
      <h1><?= nl(c('about.title')) ?></h1>
      <p><?= e(c('about.lede')) ?></p>
      <?= cta_button('Обсудить проект', 'button button-primary page-hero-button') ?>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-heading split-heading"><div><span class="section-kicker">Кто работает над сайтом</span><h2><?= e(c('about.team_title')) ?></h2></div><p><?= e(c('about.team_lede')) ?></p></div>
      <div class="about-role-grid">
        <?php foreach (array_slice((array)c('about.team', []), 0, 3) as $role): ?>
          <article class="about-role-card"><span class="icon-box"><?= icon((string)($role['role'] ?? 'check'), 22) ?></span><h3><?= e($role['name'] ?? '') ?></h3><p><?= e($role['bio'] ?? '') ?></p></article>
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
