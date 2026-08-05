<main class="e404-page">
  <section class="e404-layout" aria-labelledby="error-title">
    <div class="e404-copy">
      <?php if (trim((string)c('error404.code')) !== ''): ?>
        <p class="e404-code" aria-label="Ошибка <?= e(c('error404.code')) ?>"><?= e(c('error404.code')) ?></p>
      <?php endif; ?>

      <?php if (trim((string)c('error404.title')) !== ''): ?>
        <h1 id="error-title"><?= e(c('error404.title')) ?></h1>
      <?php endif; ?>

      <?php if (trim((string)c('error404.text')) !== ''): ?>
        <p class="e404-lead"><?= nl(c('error404.text')) ?></p>
      <?php endif; ?>

      <div class="e404-actions">
        <?php if (trim((string)c('error404.btn_home')) !== ''): ?>
          <a class="e404-button e404-primary" href="<?= url('') ?>"><?= e(c('error404.btn_home')) ?></a>
        <?php endif; ?>
        <?php if (trim((string)c('error404.btn_projects')) !== ''): ?>
          <a class="e404-button e404-secondary" href="<?= url('projects') ?>"><?= e(c('error404.btn_projects')) ?></a>
        <?php endif; ?>
      </div>

      <?php if ((array)c('site.channels', [])): ?>
        <nav class="e404-contacts" aria-label="Контакты">
          <?php foreach ((array)c('site.channels', []) as $ch): ?>
            <?php if (!empty($ch['url'])): ?>
              <a href="<?= e($ch['url']) ?>"<?= str_starts_with((string)$ch['url'], 'http') ? ' target="_blank" rel="noreferrer"' : '' ?>>
                <span><?= e($ch['value'] ?: ($ch['label'] ?? '')) ?></span>
              </a>
            <?php endif; ?>
          <?php endforeach; ?>
        </nav>
      <?php endif; ?>
    </div>

    <?php if ($img404 = trim((string)c('error404.image'))): ?>
      <div class="e404-art" aria-hidden="true">
        <div class="e404-browser-ghost"><i></i><i></i><i></i><b></b><b></b><b></b></div>
        <?= img_html($img404, '') ?>
      </div>
    <?php endif; ?>
  </section>
</main>
