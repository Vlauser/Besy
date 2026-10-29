<?php
/** @var array $COMMERCIAL */
$cfg = $COMMERCIAL;
$selectedProjects = [];
foreach ((array)($cfg['projectSlugs'] ?? []) as $projectSlug) {
    if ($project = work_item((string)$projectSlug)) $selectedProjects[] = $project;
}
?>
<main>
  <section class="page-hero commercial-hero">
    <div class="container">
      <?php require ROOT . '/tpl/_crumbs.php'; ?>
      <div class="commercial-hero-grid">
        <div class="commercial-hero-copy reveal">
          <span class="section-kicker"><?= e($cfg['kicker'] ?? '') ?></span>
          <h1><?= e($cfg['h1'] ?? '') ?></h1>
          <p><?= e($cfg['lead'] ?? '') ?></p>
          <div class="hero-actions">
            <?= cta_button('Обсудить проект', 'button button-primary') ?>
            <a href="<?= url('projects') ?>" class="button button-secondary">Смотреть проекты</a>
          </div>
        </div>
        <aside class="commercial-offer-card reveal reveal-delay" aria-label="Краткие условия">
          <span>Стоимость</span>
          <strong><?= e($cfg['price'] ?? '') ?></strong>
          <p><?= e($cfg['priceCaption'] ?? '') ?></p>
          <ul>
            <?php foreach ((array)($cfg['facts'] ?? []) as $fact): ?>
              <li><?= icon('check', 16) ?><?= e($fact) ?></li>
            <?php endforeach; ?>
          </ul>
          <?= cta_button('Обсудить проект', 'button button-primary') ?>
        </aside>
      </div>
    </div>
  </section>

  <section class="section commercial-summary-section">
    <div class="container commercial-summary">
      <span class="section-kicker">Главное</span>
      <div><h2><?= e($cfg['summaryTitle'] ?? '') ?></h2><p><?= e($cfg['summaryText'] ?? '') ?></p></div>
    </div>
  </section>

  <section class="section commercial-included-section">
    <div class="container">
      <div class="section-heading compact-heading"><span class="section-kicker">Состав работы</span><h2><?= e($cfg['includedTitle'] ?? '') ?></h2></div>
      <div class="commercial-card-grid">
        <?php foreach ((array)($cfg['included'] ?? []) as $i => $item): ?>
          <article class="commercial-info-card"><span><?= str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT) ?></span><h3><?= e($item['title'] ?? '') ?></h3><p><?= e($item['text'] ?? '') ?></p></article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <section class="section commercial-process-section">
    <div class="container">
      <div class="section-heading split-heading"><div><span class="section-kicker">Процесс</span><h2>Три шага до готового сайта.</h2></div><p>Без передачи задачи между разными подрядчиками и недель согласований.</p></div>
      <div class="commercial-step-grid">
        <?php foreach ((array)($cfg['steps'] ?? []) as $i => $step): ?>
          <article class="commercial-step"><span><?= str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT) ?></span><h3><?= e($step['title'] ?? '') ?></h3><p><?= e($step['text'] ?? '') ?></p></article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <section class="section commercial-fit-section">
    <div class="container commercial-fit-shell">
      <div><span class="section-kicker">По задаче</span><h2><?= e($cfg['fitTitle'] ?? '') ?></h2></div>
      <ul><?php foreach ((array)($cfg['fit'] ?? []) as $item): ?><li><?= icon('check', 16) ?><?= e($item) ?></li><?php endforeach; ?></ul>
    </div>
  </section>

  <?php if ($selectedProjects): ?>
  <section class="section commercial-cases-section">
    <div class="container">
      <div class="section-heading split-heading"><div><span class="section-kicker">Реальные проекты</span><h2>Показываем работу на примерах.</h2></div><p>В кейсах — задача, решения и конкретный состав работы без выдуманных показателей.</p></div>
      <div class="proof-grid commercial-case-grid">
        <?php foreach ($selectedProjects as $project): ?><?php require ROOT . '/tpl/_project_card.php'; ?><?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (!empty($cfg['faq'])): ?>
  <section class="section faq-section">
    <div class="container faq-layout">
      <div class="section-heading"><span class="section-kicker">Коротко и по делу</span><h2>Частые вопросы.</h2><p>Цена, сроки и условия — без мелкого шрифта.</p></div>
      <div class="accordion">
        <?php foreach ((array)$cfg['faq'] as $i => $faq): ?>
          <div class="faq-item<?= $i === 0 ? ' open' : '' ?>">
            <button type="button" aria-expanded="<?= $i === 0 ? 'true' : 'false' ?>"><span><?= e($faq['question'] ?? '') ?></span><?= icon('plus', 20) ?></button>
            <div class="faq-answer" role="region" aria-label="<?= e($faq['question'] ?? '') ?>"><p><?= e($faq['answer'] ?? '') ?></p></div>
          </div>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (!empty($cfg['related'])): ?>
  <section class="section related-section">
    <div class="container related-shell">
      <div><span class="section-kicker">Полезные страницы</span><h2>Продолжить знакомство.</h2></div>
      <div class="related-links"><?php foreach ((array)$cfg['related'] as $item): ?><a href="<?= url(ltrim((string)($item['href'] ?? ''), '/')) ?>"><?= e($item['label'] ?? '') ?> <?= icon('arrow', 16) ?></a><?php endforeach; ?></div>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
