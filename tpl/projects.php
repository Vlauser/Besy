<main>
  <?php if (has_any('work.kicker', 'work.title', 'work.lede')): ?>
  <section class="page-hero">
    <div class="container reveal">
      <?php if (trim((string)c('work.kicker')) !== ''): ?>
      <span class="section-kicker"><?= e(c('work.kicker')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('work.title')) !== ''): ?>
      <h1><?= e(c('work.title')) ?></h1>
      <?php endif; ?>
      <?php if (trim((string)c('work.lede')) !== ''): ?>
      <p><?= e(c('work.lede')) ?></p>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <section class="section">
    <div class="container">
      <?php if (has_any('work.filters')): ?>
      <div class="filters" id="filters" aria-label="Фильтр проектов">
        <?php foreach ((array)c('work.filters', []) as $i => $f): ?>
          <button type="button" class="filter-button<?= $i === 0 ? ' active' : '' ?>"
                  data-f="<?= e($f['key'] ?? 'all') ?>" aria-pressed="<?= $i === 0 ? 'true' : 'false' ?>"><?= e($f['label'] ?? '') ?></button>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>

      <div class="project-grid" id="projectGrid">
        <?php foreach ((array)c('work.items', []) as $project): ?>
          <div class="project-slot" data-c="<?= e($project['cat'] ?? '') ?>">
            <?php require ROOT . '/tpl/_project_card.php'; ?>
          </div>
        <?php endforeach; ?>
      </div>
      <p class="projects-empty" id="projectsEmpty" hidden>В этой категории пока нет проектов.</p>
    </div>
  </section>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
