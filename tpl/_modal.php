<div class="ax-backdrop" id="ax-modal" hidden>
  <div class="ax-modal" role="dialog" aria-modal="true" aria-labelledby="ax-modal-title">
    <button class="ax-close" type="button" data-ax-close aria-label="Закрыть">
      <?= icon('close', 20) ?>
    </button>

    <?php if (trim((string)c('modal.kicker')) !== ''): ?>
      <span class="section-kicker"><?= e(c('modal.kicker')) ?></span>
    <?php endif; ?>

    <?php if (trim((string)c('modal.title')) !== ''): ?>
      <h2 id="ax-modal-title"><?= e(c('modal.title')) ?></h2>
    <?php endif; ?>

    <?php if (trim((string)c('modal.text')) !== ''): ?>
      <p class="ax-modal-lead"><?= e(c('modal.text')) ?></p>
    <?php endif; ?>

    <?php require ROOT . '/tpl/_form.php'; ?>
  </div>
</div>
