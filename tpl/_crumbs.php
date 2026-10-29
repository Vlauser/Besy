<?php
/**
 * Хлебные крошки — разметка из макета дизайнера.
 *
 * Разметка BreadcrumbList отдаётся отдельно, в JSON-LD, и остаётся на
 * всех страницах: поисковику она нужна везде. Видимую строку по макету
 * показываем на коммерческих страницах и в статьях блога, где она
 * стоит внутри первого экрана.
 *
 * @var array<int, array{name: string, path?: string, url: string}> $CRUMBS
 */
if (empty($CRUMBS) || count($CRUMBS) < 2) return;

$last = count($CRUMBS) - 1;
?>
<nav class="breadcrumbs" aria-label="Хлебные крошки">
  <?php foreach ($CRUMBS as $i => $cr): ?>
    <?php if ($i > 0): ?><span aria-hidden="true">/</span><?php endif; ?>
    <?php if ($i === $last): ?>
      <span aria-current="page"><?= e($cr['name']) ?></span>
    <?php else: ?>
      <a href="<?= e($cr['path'] ?? $cr['url']) ?>"><?= e($cr['name']) ?></a>
    <?php endif; ?>
  <?php endforeach; ?>
</nav>
