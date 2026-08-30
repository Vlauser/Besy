<div class="accordion" id="faq">
  <?php foreach ((array)c('faq.items', []) as $i => $q): ?>
    <div class="faq-item<?= $i === 0 ? ' open' : '' ?>">
      <button type="button" aria-expanded="<?= $i === 0 ? 'true' : 'false' ?>">
        <span><?= e($q['q'] ?? '') ?></span><?= icon('plus', 20) ?>
      </button>
      <div class="faq-answer"><p><?= e($q['a'] ?? '') ?></p></div>
    </div>
  <?php endforeach; ?>
</div>
