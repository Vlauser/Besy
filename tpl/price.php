<?php
/**
 * Страница «Сколько стоит» — /landing-price.
 *
 * Отвечает на коммерческий запрос о цене полнее, чем прайс на главной:
 * из чего складывается сумма, что входит в пакет, что оплачивается
 * отдельно, за какой срок и на каком проекте это уже сработало.
 *
 * Всё содержимое правится в админке, раздел «Сколько стоит».
 * Пустые блоки не выводятся.
 */
?>
<main>

  <?php if (has_any('price.kicker', 'price.title', 'price.lede', 'price.cta')): ?>
  <section class="page-hero">
    <div class="container reveal">
      <?php if (trim((string)c('price.kicker')) !== ''): ?>
        <span class="section-kicker"><?= e(c('price.kicker')) ?></span>
      <?php endif; ?>
      <?php if (trim((string)c('price.title')) !== ''): ?>
        <h1><?= e(c('price.title')) ?></h1>
      <?php endif; ?>
      <?php if (trim((string)c('price.lede')) !== ''): ?>
        <p><?= e(c('price.lede')) ?></p>
      <?php endif; ?>
      <?php if (trim((string)c('price.cta')) !== ''): ?>
        <div class="price-hero-actions"><?= cta_button((string)c('price.cta'), 'button button-primary') ?></div>
      <?php endif; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('price.packages_title', 'price.packages_lede', 'price.packages')): ?>
  <section class="section price-packages-section">
    <div class="container">
      <div class="section-heading split-heading">
        <div>
          <?php if (trim((string)c('price.packages_title')) !== ''): ?>
            <h2><?= e(c('price.packages_title')) ?></h2>
          <?php endif; ?>
        </div>
        <?php if (trim((string)c('price.packages_lede')) !== ''): ?>
          <p><?= e(c('price.packages_lede')) ?></p>
        <?php endif; ?>
      </div>

      <div class="price-grid">
        <?php foreach ((array)c('price.packages', []) as $pk): ?>
          <?php
          $pkName = trim((string)($pk['name'] ?? ''));
          if ($pkName === '') continue;
          $caseKey  = trim((string)($pk['case'] ?? ''));
          $caseItem = $caseKey !== '' ? work_item($caseKey) : null;
          ?>
          <article class="price-card<?= !empty($pk['featured']) ? ' featured' : '' ?>">
            <h3><?= e($pkName) ?></h3>

            <?php if (trim((string)($pk['text'] ?? '')) !== ''): ?>
              <p class="price-card-text"><?= e($pk['text']) ?></p>
            <?php endif; ?>

            <div class="price-amount">
              <?php if (trim((string)($pk['price'] ?? '')) !== ''): ?>
                <strong><?= e($pk['price']) ?></strong>
              <?php endif; ?>
              <?php if (trim((string)($pk['term'] ?? '')) !== ''): ?>
                <span><?= e($pk['term']) ?></span>
              <?php endif; ?>
            </div>

            <?php $inc = array_values(array_filter(array_map('trim', (array)($pk['includes'] ?? [])))); ?>
            <?php if ($inc): ?>
              <ul class="price-list">
                <?php foreach ($inc as $i): ?>
                  <li><?= icon('check', 15) ?><span><?= e($i) ?></span></li>
                <?php endforeach; ?>
              </ul>
            <?php endif; ?>

            <div class="price-card-foot">
              <?= cta_button((string)($pk['button'] ?? 'Обсудить проект'), 'button button-primary') ?>
              <?php if ($caseItem): ?>
                <a class="price-case" href="<?= e(work_url($caseKey)) ?>">
                  Пример: <?= e((string)($caseItem['name'] ?? '')) ?> <?= icon('arrow', 15) ?>
                </a>
              <?php endif; ?>
            </div>
          </article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('price.factors_title', 'price.factors_lede', 'price.factors')): ?>
  <section class="section price-factors-section">
    <div class="container">
      <div class="section-heading">
        <?php if (trim((string)c('price.factors_title')) !== ''): ?>
          <h2><?= e(c('price.factors_title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('price.factors_lede')) !== ''): ?>
          <p><?= e(c('price.factors_lede')) ?></p>
        <?php endif; ?>
      </div>

      <div class="factor-grid">
        <?php foreach ((array)c('price.factors', []) as $n => $f): ?>
          <?php if (trim((string)($f['title'] ?? '')) === '') continue; ?>
          <article class="factor-card">
            <span class="icon-box"><?= icon_cycle((int)$n) ?></span>
            <h3><?= e($f['title']) ?></h3>
            <?php if (trim((string)($f['text'] ?? '')) !== ''): ?>
              <p><?= e($f['text']) ?></p>
            <?php endif; ?>
          </article>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php if (has_any('price.extras_title', 'price.extras_lede', 'price.extras', 'price.extras_note')): ?>
  <section class="section price-extras-section">
    <div class="container">
      <div class="price-extras">
        <div class="section-heading">
          <?php if (trim((string)c('price.extras_title')) !== ''): ?>
            <h2><?= e(c('price.extras_title')) ?></h2>
          <?php endif; ?>
          <?php if (trim((string)c('price.extras_lede')) !== ''): ?>
            <p><?= e(c('price.extras_lede')) ?></p>
          <?php endif; ?>
        </div>

        <?php if (has_any('price.extras')): ?>
          <dl class="extras-list">
            <?php foreach ((array)c('price.extras', []) as $ex): ?>
              <?php if (trim((string)($ex['title'] ?? '')) === '') continue; ?>
              <div>
                <dt><?= e($ex['title']) ?></dt>
                <?php if (trim((string)($ex['text'] ?? '')) !== ''): ?>
                  <dd><?= e($ex['text']) ?></dd>
                <?php endif; ?>
              </div>
            <?php endforeach; ?>
          </dl>
        <?php endif; ?>

        <?php if (trim((string)c('price.extras_note')) !== ''): ?>
          <p class="extras-note"><?= icon('check', 17) ?><span><?= e(c('price.extras_note')) ?></span></p>
        <?php endif; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php require ROOT . '/tpl/_reviews.php'; ?>

  <?php if (has_any('price.faq_title', 'price.faq_lede', 'price.faq')): ?>
  <section class="section faq-section">
    <div class="container faq-layout">
      <div class="section-heading">
        <?php if (trim((string)c('price.faq_title')) !== ''): ?>
          <h2><?= e(c('price.faq_title')) ?></h2>
        <?php endif; ?>
        <?php if (trim((string)c('price.faq_lede')) !== ''): ?>
          <p><?= e(c('price.faq_lede')) ?></p>
        <?php endif; ?>
      </div>

      <div class="accordion" id="faq">
        <?php foreach ((array)c('price.faq', []) as $i => $q): ?>
          <?php if (trim((string)($q['q'] ?? '')) === '') continue; ?>
          <div class="faq-item<?= $i === 0 ? ' open' : '' ?>">
            <button type="button" aria-expanded="<?= $i === 0 ? 'true' : 'false' ?>">
              <span><?= e($q['q']) ?></span><?= icon('plus', 20) ?>
            </button>
            <div class="faq-answer"><p><?= e($q['a'] ?? '') ?></p></div>
          </div>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php /* Перелинковка по разделу 19 ТЗ: со страницы цены человеку
           логично уйти в работы, услуги или контакты */ ?>
  <?php require ROOT . '/tpl/_next.php'; ?>

  <?php require ROOT . '/tpl/_cta.php'; ?>
</main>
