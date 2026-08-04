<main>
  <section class="page-hero contacts-hero">
    <div class="container reveal">
      <?php if (trim((string)c('contacts.kicker')) !== ''): ?>
      <span class="section-kicker"><?= e(c('contacts.kicker')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('contacts.title')) !== ''): ?>
      <h1><?= e(c('contacts.title')) ?></h1>
      <?php endif; ?>
      <?php if (trim((string)c('contacts.lede')) !== ''): ?>
      <p><?= e(c('contacts.lede')) ?></p>
      <?php endif; ?>
    </div>
  </section>

  <section class="section contacts-content" id="request">
    <div class="container contact-layout">
      <div>
        <div class="section-heading">
          <?php if (trim((string)c('contacts.heading_kicker')) !== ''): ?>
          <span class="section-kicker"><?= e(c('contacts.heading_kicker')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('contacts.heading_title')) !== ''): ?>
          <h2><?= e(c('contacts.heading_title')) ?></h2>
          <?php endif; ?>
        </div>
        <div class="contact-cards">
          <?php foreach ((array)c('site.channels', []) as $ch): ?>
            <?php if (!empty($ch['url'])): ?>
              <article class="contact-card">
                <?php if (trim((string)($ch['label'] ?? '')) !== ''): ?>
                <span><?= e($ch['label'] ?? '') ?></span>
                <?php endif; ?>
                <a href="<?= e($ch['url']) ?>"<?= str_starts_with((string)$ch['url'], 'http') ? ' target="_blank" rel="noreferrer"' : '' ?>><?= e($ch['value'] ?? '') ?></a>
              </article>
            <?php endif; ?>
          <?php endforeach; ?>
          <?php if ($hr = trim((string)c('site.hours'))): ?>
            <article class="contact-card"><span>Часы работы</span><a href="#request"><?= e($hr) ?></a></article>
          <?php endif; ?>
        </div>
      </div>
      <?php require ROOT . '/tpl/_form.php'; ?>
    </div>
  </section>

  <section class="section faq-section">
    <div class="container faq-layout">
      <div class="section-heading">
        <?php if (trim((string)c('contacts.faq_kicker')) !== ''): ?>
        <span class="section-kicker"><?= e(c('contacts.faq_kicker')) ?></span>
        <?php endif; ?>
        <?php if (trim((string)c('contacts.faq_title')) !== ''): ?>
        <h2><?= e(c('contacts.faq_title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('contacts.faq_lede')) !== ''): ?>
        <p><?= e(c('contacts.faq_lede')) ?></p>
        <?php endif; ?>
      </div>
      <?php require ROOT . '/tpl/_faq.php'; ?>
    </div>
  </section>
</main>
