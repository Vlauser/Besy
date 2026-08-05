<?php
/**
 * Хлебные крошки. Разметка BreadcrumbList отдаётся отдельно, в JSON-LD,
 * поэтому здесь только видимая часть — без дублирующих микроформатов.
 *
 * @var array<int, array{name: string, url: string}> $CRUMBS
 */
if (empty($CRUMBS)) return;

$last = count($CRUMBS) - 1;
?>
<nav class="crumbs" aria-label="Вы находитесь здесь">
  <div class="container">
    <ol>
      <?php foreach ($CRUMBS as $i => $cr): ?>
        <li>
          <?php if ($i === $last): ?>
            <span aria-current="page"><?= e($cr['name']) ?></span>
          <?php else: ?>
            <a href="<?= e($cr['path'] ?? $cr['url']) ?>"><?= e($cr['name']) ?></a>
          <?php endif; ?>
        </li>
      <?php endforeach; ?>
    </ol>
  </div>
</nav>
