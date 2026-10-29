<main>
  <?php if (has_any('hero.title_1', 'hero.title_2', 'hero.title_accent', 'hero.text', 'hero.cta_primary', 'hero.badges', 'hero.image')): ?>
  <section class="hero" id="hero">
    <div class="container hero-grid">
      <div class="hero-copy reveal">
        <h1><?php if (trim((string)c('hero.title_1')) !== ''): ?><?= e(c('hero.title_1')) ?><?php if (trim((string)c('hero.title_2')) !== '' || trim((string)c('hero.title_accent')) !== ''): ?><br><?php endif; ?><?php endif; ?><?= e(c('hero.title_2')) ?> <?php if (trim((string)c('hero.title_accent')) !== ''): ?><span><?= e(c('hero.title_accent')) ?></span><?php endif; ?></h1>
        <?php if (trim((string)c('hero.text')) !== ''): ?>
        <p class="hero-text"><?= e(c('hero.text')) ?></p>
        <?php endif; ?>
        <div class="hero-actions">
          <?php if (trim((string)c('hero.cta_primary')) !== ''): ?>
          <?= cta_button((string)c('hero.cta_primary'), 'button button-primary') ?>
          <?php endif; ?>
          <?php if (trim((string)c('hero.cta_secondary')) !== ''): ?>
          <a href="#projects" class="button button-secondary"><?= e(c('hero.cta_secondary')) ?></a>
          <?php endif; ?>
        </div>
        <?php if (has_any('hero.badges')): ?>
        <div class="badge-row">
          <?php foreach ((array)c('hero.badges', []) as $b): ?>
            <?php if (trim((string)($b['text'] ?? '')) === '') continue; ?>
            <span class="tag"><?= icon('check', 14) ?><?= e($b['text']) ?></span>
          <?php endforeach; ?>
        </div>
        <?php endif; ?>
      </div>
      <?php if ($img = trim((string)c('hero.image'))): ?>
      <div class="hero-art reveal reveal-delay">
        <?= img_html($img, 'Фирменный персонаж ' . (string)c('site.brand'), ['lcp' => true]) ?>
      </div>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('comparison.kicker', 'comparison.title', 'comparison.lede', 'comparison.bad', 'comparison.good', 'comparison.center_num')): ?>
  <section class="section comparison-section" id="comparison">
    <div class="container">
      <div class="section-heading split-heading">
        <div>
          <?php if (trim((string)c('comparison.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('comparison.kicker')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('comparison.title')) !== ''): ?>
          <h2><?= e(c('comparison.title')) ?></h2>
          <?php endif; ?>
        </div>
        <?php if (trim((string)c('comparison.lede')) !== ''): ?>
        <p><?= e(c('comparison.lede')) ?></p>
        <?php endif; ?>
      </div>
      <div class="comparison-card">
        <div class="comparison-column muted-column">
          <?php if (trim((string)c('comparison.label_bad')) !== ''): ?>
          <span class="comparison-label"><?= e(c('comparison.label_bad')) ?></span>
          <?php endif; ?>
          <?php foreach ((array)c('comparison.bad', []) as $i): ?>
            <div class="comparison-item"><span class="minus">−</span><?= e($i['text'] ?? '') ?></div>
          <?php endforeach; ?>
        </div>
        <div class="comparison-center">
          <?php if (trim((string)c('comparison.center_pre')) !== ''): ?>
          <span><?= e(c('comparison.center_pre')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('comparison.center_num')) !== ''): ?>
          <strong><?= e(c('comparison.center_num')) ?></strong>
          <?php endif; ?>
          <?php if (trim((string)c('comparison.center_post')) !== ''): ?>
          <em><?= e(c('comparison.center_post')) ?></em>
          <?php endif; ?>
        </div>
        <div class="comparison-column accent-column">
          <?php if (trim((string)c('comparison.label_good')) !== ''): ?>
          <span class="comparison-label"><?= e(c('comparison.label_good')) ?></span>
          <?php endif; ?>
          <?php foreach ((array)c('comparison.good', []) as $i): ?>
            <div class="comparison-item"><?= icon('check', 16) ?><?= e($i['text'] ?? '') ?></div>
          <?php endforeach; ?>
        </div>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('benefits.kicker', 'benefits.title', 'benefits.items')): ?>
  <section class="section benefits-section" id="benefits">
    <div class="container">
      <div class="benefits-shell">
        <div class="section-heading benefits-heading">
          <?php if (trim((string)c('benefits.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('benefits.kicker')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('benefits.title')) !== ''): ?>
          <h2><?= e(c('benefits.title')) ?></h2>
          <?php endif; ?>
        </div>
        <div class="benefit-grid">
          <?php foreach ((array)c('benefits.items', []) as $n => $b): ?>
            <article class="benefit-card">
              <span class="icon-box"><?= icon_cycle($n) ?></span>
              <?php if (trim((string)($b['title'] ?? '')) !== ''): ?>
              <h3><?= e($b['title'] ?? '') ?></h3>
              <?php endif; ?>
              <?php if (trim((string)($b['text'] ?? '')) !== ''): ?>
              <p><?= e($b['text'] ?? '') ?></p>
              <?php endif; ?>
            </article>
          <?php endforeach; ?>
        </div>
        <?php if (trim((string)c('benefits.cta')) !== ''): ?>
        <?= cta_button((string)c('benefits.cta'), 'button button-primary benefits-cta') ?>
        <?php endif; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('home_services.kicker', 'home_services.title', 'home_services.lede', 'home_services.items')): ?>
  <section class="section home-services-section" id="services">
    <div class="container">
      <div class="section-heading split-heading">
        <div>
          <?php if (trim((string)c('home_services.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('home_services.kicker')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('home_services.title')) !== ''): ?>
          <h2><?= e(c('home_services.title')) ?></h2>
          <?php endif; ?>
        </div>
        <?php if (trim((string)c('home_services.lede')) !== ''): ?>
        <p><?= e(c('home_services.lede')) ?></p>
        <?php endif; ?>
      </div>
      <div class="home-services-grid">
        <?php foreach ((array)c('home_services.items', []) as $n => $s): ?>
          <?php require ROOT . '/tpl/_service_card.php'; ?>
        <?php endforeach; ?>
      </div>
      <div class="section-action">
        <?php if (trim((string)c('home_services.all_link')) !== ''): ?>
        <a href="<?= url('services') ?>" class="button button-secondary"><?= e(c('home_services.all_link')) ?></a>
        <?php endif; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('process.kicker', 'process.title', 'process.items')): ?>
  <section class="section home-process-section" id="process">
    <div class="container process-list-layout">
      <div class="section-heading process-list-heading">
        <?php if (trim((string)c('process.kicker')) !== ''): ?><span class="section-kicker"><?= e(c('process.kicker')) ?></span><?php endif; ?>
        <?php if (trim((string)c('process.title')) !== ''): ?><h2><?= e(c('process.title')) ?></h2><?php endif; ?>
      </div>
      <div class="process-list">
        <?php foreach ((array)c('process.items', []) as $n => $p): ?>
          <article class="process-list-item">
            <span><?= e($p['number'] ?? str_pad((string)($n + 1), 2, '0', STR_PAD_LEFT)) ?></span>
            <div><h3><?= e($p['title'] ?? '') ?></h3><p><?= e($p['text'] ?? '') ?></p></div>
          </article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>

  <?php if (has_any('projects_home.kicker', 'projects_home.title', 'work.items')): ?>
  <section class="section proof-section" id="projects">
    <div class="container">
      <div class="section-heading split-heading">
        <div>
          <?php if (trim((string)c('projects_home.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('projects_home.kicker')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('projects_home.title')) !== ''): ?>
          <h2><?= e(c('projects_home.title')) ?></h2>
          <?php endif; ?>
        </div>
        <?php if (trim((string)c('projects_home.lede')) !== ''): ?>
        <p><?= e(c('projects_home.lede')) ?></p>
        <?php endif; ?>
      </div>
      <div class="proof-grid">
        <?php
        $homeProjects = [];
        foreach ((array)c('projects_home.slugs', []) as $homeSlug) {
            if ($found = work_item((string)$homeSlug)) $homeProjects[] = $found;
        }
        if (!$homeProjects) $homeProjects = array_slice((array)c('work.items', []), 0, 3);
        ?>
        <?php foreach ($homeProjects as $project): ?>
          <?php require ROOT . '/tpl/_project_card.php'; ?>
        <?php endforeach; ?>
      </div>
      <div class="section-action proof-action">
        <?php if (trim((string)c('projects_home.button')) !== ''): ?>
        <a href="<?= url('projects') ?>" class="button button-secondary"><?= e(c('projects_home.button')) ?></a>
        <?php endif; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_reviews.php'; ?>

  <?php $homePosts = array_slice(blog_posts(), 0, 3); if ($homePosts): ?>
  <section class="section blog-preview-section">
    <div class="container">
      <div class="section-heading split-heading">
        <div><span class="section-kicker">Блог</span><h2>Коротко о сайтах и продажах.</h2></div>
        <p>Выбор формата, цена, структура и запуск — понятными словами и с практическим ответом в каждом материале.</p>
      </div>
      <div class="blog-grid blog-grid-home">
        <?php foreach ($homePosts as $i => $p): ?><?php require ROOT . '/tpl/_blog_card.php'; ?><?php endforeach; ?>
      </div>
      <div class="section-action"><a href="<?= url('blog') ?>" class="button button-secondary">Все материалы</a></div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('faq.kicker', 'faq.title', 'faq.lede', 'faq.items')): ?>
  <section class="section faq-section" id="faq-block">
    <div class="container faq-layout">
      <div class="section-heading">
        <?php if (trim((string)c('faq.kicker')) !== ''): ?>
        <span class="section-kicker"><?= e(c('faq.kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('faq.title')) !== ''): ?>
        <h2><?= e(c('faq.title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('faq.lede')) !== ''): ?>
        <p><?= e(c('faq.lede')) ?></p>
        <?php endif; ?>
        <?php if (trim((string)c('faq.link')) !== ''): ?>
        <button type="button" data-ax-open class="text-link"><?= e(c('faq.link')) ?> <?= icon('arrow', 17) ?></button>
        <?php endif; ?>
      </div>
      <?php require ROOT . '/tpl/_faq.php'; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('request.kicker', 'request.title', 'request.text', 'request.form_small', 'request.form_big')): ?>
  <section class="section home-contact-section" id="request">
    <div class="container">
      <div class="home-contact-shell">
        <div class="home-contact-copy">
          <?php if (trim((string)c('request.kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('request.kicker')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('request.title')) !== ''): ?>
          <h2><?= e(c('request.title')) ?></h2>
          <?php endif; ?>
          <?php if (trim((string)c('request.text')) !== ''): ?>
          <p><?= e(c('request.text')) ?></p>
          <?php endif; ?>
          <div class="home-contact-methods">
            <?php foreach ((array)c('site.channels', []) as $ch): ?>
              <?php if (!empty($ch['url'])): ?>
                <a href="<?= e($ch['url']) ?>"<?= str_starts_with((string)$ch['url'], 'http') ? ' target="_blank" rel="noreferrer"' : '' ?>>
                  <span><?= e($ch['label'] ?? '') ?></span><strong><?= e($ch['value'] ?? '') ?></strong>
                </a>
              <?php endif; ?>
            <?php endforeach; ?>
          </div>
          <?php if (trim((string)c('request.promise')) !== ''): ?>
          <div class="contact-promise"><?= icon('check', 17) ?><span><?= e(c('request.promise')) ?></span></div>
          <?php endif; ?>
        </div>
        <div class="home-contact-form-wrap">
          <?php if (has_any('request.form_small', 'request.form_big')): ?>
          <div class="form-heading">
            <?php if (trim((string)c('request.form_small')) !== ''): ?>
            <span><?= e(c('request.form_small')) ?></span>
            <?php endif; ?>
            <?php if (trim((string)c('request.form_big')) !== ''): ?>
            <strong><?= e(c('request.form_big')) ?></strong>
            <?php endif; ?>
          </div>
          <?php endif; ?>
          <?php require ROOT . '/tpl/_form.php'; ?>
        </div>
      </div>
    </div>
  </section>
  <?php endif; ?>
</main>
