<?php
/**
 * Карточка проекта в сетке — по макету дизайнера (proof-card).
 *
 * Монограмма, название, ниша, короткое описание и два первых пункта
 * из списка «Что сделали». Ссылка ведёт на страницу работы внутри сайта,
 * а не сразу на сам проект: так посетитель остаётся у нас, а вес со
 * списка перетекает на наши же страницы. Если ключ проекта не заполнен,
 * ссылка ведёт на его сайт — страницу без ключа построить не из чего.
 *
 * @var array $project
 */
$pSlug = trim((string)($project['slug'] ?? ''));
$pName = trim((string)($project['name'] ?? ''));
$pCat  = trim((string)($project['category'] ?? ''));
$pShort = trim((string)($project['short'] ?? ''));

/* Монограмма: если не задана — соберём из первых букв названия */
$pMono = trim((string)($project['monogram'] ?? ''));
if ($pMono === '' && $pName !== '') {
    $words = preg_split('/\s+/u', $pName) ?: [];
    foreach (array_slice($words, 0, 2) as $w) {
        $pMono .= mb_strtoupper(mb_substr($w, 0, 1));
    }
}

/* В карточке показываем два первых пункта — больше не помещается по макету */
$pWork = array_values(array_filter(array_map('trim', (array)($project['work'] ?? []))));

$inside = $pSlug !== '';
$href   = $inside ? work_url($pSlug) : trim((string)($project['url'] ?? '#'));
$linkLabel = trim((string)c('work.card_link')) ?: 'Смотреть кейс';
?>
<article class="proof-card"<?= isset($PROJECT_FILTERABLE) ? ' data-c="' . e((string)($project['cat'] ?? '')) . '"' : '' ?>>
  <?php if ($pMono !== '' || $pName !== '' || $pCat !== ''): ?>
  <div class="proof-card-head">
    <?php if ($pMono !== ''): ?><span class="proof-avatar"><?= e($pMono) ?></span><?php endif; ?>
    <div>
      <?php if ($pName !== ''): ?><strong><?= e($pName) ?></strong><?php endif; ?>
      <?php if ($pCat !== ''): ?><span><?= e($pCat) ?></span><?php endif; ?>
    </div>
  </div>
  <?php endif; ?>

  <?php if ($pShort !== ''): ?><p><?= e($pShort) ?></p><?php endif; ?>

  <?php if ($pWork): ?>
  <ul>
    <?php foreach (array_slice($pWork, 0, 2) as $line): ?>
      <li><?= icon('check', 15) ?><?= e($line) ?></li>
    <?php endforeach; ?>
  </ul>
  <?php endif; ?>

  <a href="<?= e($href) ?>" class="text-link"<?= $inside ? '' : ' target="_blank" rel="noreferrer"' ?>
     aria-label="<?= e(($inside ? 'Подробнее о проекте ' : 'Смотреть проект ') . $pName) ?>"><?= e($linkLabel) ?> <?= icon('arrow', 16) ?></a>
</article>
