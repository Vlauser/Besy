<?php
$visualSlug = trim((string)($project['slug'] ?? ''));
$visualName = trim((string)($project['name'] ?? ''));
?>
<?php if ($visualSlug === 'pottery-studio'): ?>
  <div class="project-visual project-visual-pottery">
    <div class="pottery-preview-brand"><div class="pottery-preview-logo">КРУГ</div><span>студия керамики</span></div>
    <div class="pottery-preview-photo"><?= img_html('assets/img/projects/pottery-preview.png', 'Яркая керамика ручной работы') ?></div>
  </div>
<?php elseif ($visualSlug === 'cupcake-studio'): ?>
  <div class="project-visual project-visual-cupcake">
    <div class="cupcake-preview-logo"><span>К</span><strong>крем &amp; крошка</strong></div>
    <?= img_html('assets/img/projects/cupcake-preview.png', 'Капкейк с розовым кремом', ['class' => 'cupcake-preview-image']) ?>
  </div>
<?php elseif ($visualSlug === 'besy-esim'): ?>
  <div class="project-visual project-visual-besy">
    <?= img_html('assets/img/projects/besy-esim.jpg', 'Фирменная планета сервиса Besy eSIM', ['class' => 'besy-preview-image']) ?>
    <strong class="besy-preview-logo">Besy eSIM</strong>
  </div>
<?php elseif ($visualSlug === 'forma'): ?>
  <div class="project-visual project-visual-forma"><div class="forma-preview-mark">AM</div><strong>Анна Миронова</strong><span>ПСИХОЛОГ</span></div>
<?php elseif ($visualSlug === 'rewind'): ?>
  <div class="project-visual project-visual-rewind">
    <?= img_html('assets/img/projects/rewind-preview.jpg', 'Кадр из кинозала фестиваля REWIND', ['class' => 'rewind-preview-image']) ?>
    <strong class="rewind-preview-logo">REWIND</strong>
  </div>
<?php elseif ($visualSlug === 'mellow-coffee'): ?>
  <div class="project-visual project-visual-mellow">
    <?= img_html('assets/img/projects/mellow-preview.png', 'Гости кофейни Mellow за общим столом', ['class' => 'mellow-preview-image']) ?>
    <strong class="mellow-preview-logo">MELLOW<span>.</span></strong>
  </div>
<?php elseif ($visualSlug === 'pravo-legal'): ?>
  <div class="project-visual project-visual-pravo"><div class="pravo-preview-logo"><strong>ДОВОД</strong><span>ЮРИДИЧЕСКАЯ ПРАКТИКА</span></div></div>
<?php else: ?>
  <div class="project-visual">
    <?php if (!empty($project['image'])): ?><?= img_html((string)$project['image'], 'Главная страница проекта ' . $visualName, ['class' => 'project-screenshot']) ?>
    <?php elseif (!empty($project['monogram'])): ?><span class="project-monogram"><?= e($project['monogram']) ?></span><?php endif; ?>
  </div>
<?php endif; ?>
