<article class="project-card project-card-<?= e($project['slug'] ?? '') ?>">
  <a href="<?= e($project['url'] ?? '#') ?>" target="_blank" rel="noreferrer" aria-label="Смотреть проект <?= e($project['name'] ?? '') ?>">
    <div class="project-visual">
      <?php if (!empty($project['image'])): ?>
        <img class="project-screenshot" src="<?= url($project['image']) ?>" alt="Главная страница проекта <?= e($project['name'] ?? '') ?>" loading="lazy">
      <?php else: ?>
        <?php if (trim((string)($project['monogram'] ?? '')) !== ''): ?>
        <span class="project-monogram"><?= e($project['monogram'] ?? '') ?></span>
        <?php endif; ?>
      <?php endif; ?>
    </div>
    <div class="project-meta">
      <div>
        <?php if (trim((string)($project['category'] ?? '')) !== ''): ?>
        <span><?= e($project['category'] ?? '') ?></span>
        <?php endif; ?>
        <?php if (trim((string)($project['name'] ?? '')) !== ''): ?>
        <h3><?= e($project['name'] ?? '') ?></h3>
        <?php endif; ?>
        <?php if (trim((string)($project['short'] ?? '')) !== ''): ?>
        <p><?= e($project['short'] ?? '') ?></p>
        <?php endif; ?>
      </div>
      <span class="round-link" aria-hidden="true"><?= icon('arrow', 20) ?></span>
    </div>
  </a>
</article>
