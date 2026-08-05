<?php
/**
 * Карточка проекта в сетке.
 *
 * Ведёт на страницу работы внутри сайта, а не сразу на сам проект:
 * так посетитель остаётся у нас, а вес со списка перетекает на наши же
 * страницы. Если ключ проекта не заполнен, ссылка ведёт на его сайт —
 * страницу без ключа построить не из чего.
 *
 * @var array $project
 */
$pSlug = trim((string)($project['slug'] ?? ''));
$pName = trim((string)($project['name'] ?? ''));
$pCat  = trim((string)($project['category'] ?? ''));

$inside = $pSlug !== '';
$href   = $inside ? work_url($pSlug) : trim((string)($project['url'] ?? '#'));
?>
<article class="project-card project-card-<?= e($pSlug) ?>">
  <a href="<?= e($href) ?>"<?= $inside ? '' : ' target="_blank" rel="noreferrer"' ?>
     aria-label="<?= e(($inside ? 'Подробнее о проекте ' : 'Смотреть проект ') . $pName) ?>">
    <div class="project-visual">
      <?php if (!empty($project['image'])): ?>
        <?= img_html(
              (string)$project['image'],
              'Сайт проекта ' . $pName . ($pCat !== '' ? ' — ' . $pCat : ''),
              ['class' => 'project-screenshot']
            ) ?>
      <?php else: ?>
        <?php if (trim((string)($project['monogram'] ?? '')) !== ''): ?>
        <span class="project-monogram"><?= e($project['monogram']) ?></span>
        <?php endif; ?>
      <?php endif; ?>
    </div>
    <div class="project-meta">
      <div>
        <?php if ($pCat !== ''): ?>
        <span><?= e($pCat) ?></span>
        <?php endif; ?>
        <?php if ($pName !== ''): ?>
        <h3><?= e($pName) ?></h3>
        <?php endif; ?>
        <?php if (trim((string)($project['short'] ?? '')) !== ''): ?>
        <p><?= e($project['short']) ?></p>
        <?php endif; ?>
      </div>
      <span class="round-link" aria-hidden="true"><?= icon('arrow', 20) ?></span>
    </div>
  </a>
</article>
