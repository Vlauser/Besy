<header class="site-header">
  <div class="container header-inner">
    <a href="<?= url('') ?>" class="logo" aria-label="<?= e(c('site.brand')) ?> — на главную"><?= e(c('site.brand')) ?><span><?= e(c('site.brand_mark')) ?></span></a>

    <nav class="main-nav" id="mainNav">
      <?php if (trim((string)c('site.nav_home')) !== ''): ?>
      <a href="<?= url('') ?>"<?= $NAV === 'home' ? ' class="active"' : '' ?>><?= e(c('site.nav_home')) ?></a>
      <?php endif; ?>
      <?php if (trim((string)c('site.nav_projects')) !== ''): ?>
      <a href="<?= url('projects') ?>"<?= $NAV === 'work' ? ' class="active"' : '' ?>><?= e(c('site.nav_projects')) ?></a>
      <?php endif; ?>
      <?php if (trim((string)c('site.nav_services')) !== ''): ?>
      <a href="<?= url('services') ?>"<?= $NAV === 'services' ? ' class="active"' : '' ?>><?= e(c('site.nav_services')) ?></a>
      <?php endif; ?>
      <?php if (trim((string)c('site.nav_price')) !== ''): ?>
      <a href="<?= url('landing-price') ?>"<?= $NAV === 'price' ? ' class="active"' : '' ?>><?= e(c('site.nav_price')) ?></a>
      <?php endif; ?>
      <?php if (trim((string)c('site.nav_contacts')) !== ''): ?>
      <a href="<?= url('contacts') ?>"<?= $NAV === 'contacts' ? ' class="active"' : '' ?>><?= e(c('site.nav_contacts')) ?></a>
      <?php endif; ?>
      <?php if (trim((string)c('site.header_cta')) !== ''): ?>
      <?= cta_button((string)c('site.header_cta'), 'button button-primary mobile-nav-button') ?>
      <?php endif; ?>
    </nav>

    <?= cta_button((string)c('site.header_cta'), 'button button-primary header-button') ?>

    <button class="menu-button" id="menuButton" aria-expanded="false" aria-label="Открыть меню">
      <span data-menu-open><?= icon('menu') ?></span>
      <span data-menu-close hidden><?= icon('close') ?></span>
    </button>
  </div>
</header>
