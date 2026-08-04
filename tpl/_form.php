<?php require_once ROOT . '/inc/md.php'; ?>
<div class="contact-form" data-form data-mode="call">

  <!-- Способ связи: позвонить или написать -->
  <div class="ax-choice">
    <?php if (trim((string)c('forms.mode_label')) !== ''): ?>
      <span class="ax-label"><?= e(c('forms.mode_label')) ?></span>
    <?php endif; ?>

    <div class="ax-mode" role="group" aria-label="<?= e(c('forms.mode_label')) ?>">
      <button type="button" data-mode-btn="call" class="is-active" aria-pressed="true">
        <?= icon('phone', 16) ?><?= e(c('forms.mode_call')) ?>
      </button>
      <button type="button" data-mode-btn="write" aria-pressed="false">
        <?= icon('chat', 16) ?><?= e(c('forms.mode_write')) ?>
      </button>
    </div>

    <!-- Звонок -->
    <div class="ax-pane" data-pane="call">
      <label class="ax-field">
        <?php if (trim((string)c('forms.label_phone')) !== ''): ?>
          <span class="ax-label"><?= e(c('forms.label_phone')) ?></span>
        <?php endif; ?>
        <input type="tel" name="phone" autocomplete="tel"
               placeholder="<?= e(c('forms.ph_phone')) ?>" data-contact>
        <em class="field-error" hidden><?= e(c('forms.err_contact')) ?></em>
      </label>
    </div>

    <!-- Сообщение в мессенджер -->
    <div class="ax-pane" data-pane="write" hidden>
      <div class="ax-field">
        <?php if (trim((string)c('forms.label_messenger')) !== ''): ?>
          <span class="ax-label"><?= e(c('forms.label_messenger')) ?></span>
        <?php endif; ?>

        <?php $ms = (array)c('forms.messengers', []); ?>
        <?php if (count($ms) > 1): ?>
          <div class="ax-messengers" role="group" aria-label="<?= e(c('forms.label_messenger')) ?>">
            <?php foreach ($ms as $i => $m): ?>
              <button type="button" data-messenger="<?= e($m['key'] ?? '') ?>"
                      data-placeholder="<?= e($m['placeholder'] ?? '') ?>"
                      class="<?= $i === 0 ? 'is-active' : '' ?>"
                      aria-pressed="<?= $i === 0 ? 'true' : 'false' ?>"><?= e($m['label'] ?? '') ?></button>
            <?php endforeach; ?>
          </div>
        <?php endif; ?>

        <input type="text" name="messenger_contact" data-contact
               placeholder="<?= e($ms[0]['placeholder'] ?? '') ?>">
        <em class="field-error" hidden><?= e(c('forms.err_contact')) ?></em>
      </div>
    </div>
  </div>

  <!-- Имя — необязательное -->
  <label class="ax-field">
    <?php if (trim((string)c('forms.label_name')) !== ''): ?>
      <span class="ax-label"><?= e(c('forms.label_name')) ?><?php if (trim((string)c('forms.optional_note')) !== ''): ?><small><?= e(c('forms.optional_note')) ?></small><?php endif; ?></span>
    <?php endif; ?>
    <input type="text" name="name" autocomplete="name" placeholder="<?= e(c('forms.ph_name')) ?>">
  </label>

  <!-- Комментарий -->
  <label class="ax-field" data-only="page">
    <?php if (trim((string)c('forms.label_message')) !== ''): ?>
      <span class="ax-label"><?= e(c('forms.label_message')) ?><?php if (trim((string)c('forms.optional_note')) !== ''): ?><small><?= e(c('forms.optional_note')) ?></small><?php endif; ?></span>
    <?php endif; ?>
    <textarea name="message" rows="4" placeholder="<?= e(c('forms.ph_message')) ?>"></textarea>
  </label>

  <!-- Согласие на обработку — обязательное, по ст. 9 152-ФЗ -->
  <label class="consent-row">
    <input type="checkbox" name="consent" data-req-check>
    <span><?= agree_html((string)c('forms.agree'), url('consent')) ?></span>
  </label>
  <?php if (trim((string)c('forms.err_agree')) !== ''): ?>
    <em class="field-error consent-error" hidden><?= e(c('forms.err_agree')) ?></em>
  <?php endif; ?>

  <!-- Согласие на рекламу — отдельное, по ч.1 ст.18 38-ФЗ -->
  <?php if (!empty(c('forms.marketing_on'))): ?>
    <label class="consent-row marketing-consent">
      <input type="checkbox" name="marketing" value="1">
      <span><?= e(c('forms.marketing')) ?><?php if (trim((string)c('forms.marketing_note')) !== ''): ?><small><?= e(c('forms.marketing_note')) ?></small><?php endif; ?></span>
    </label>
  <?php endif; ?>

  <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">

  <button class="button button-primary" type="button" data-submit><?= e(c('forms.submit')) ?></button>

  <?php if (trim((string)c('legal.policy_link')) !== ''): ?>
    <p class="form-policy"><a href="<?= url('privacy') ?>" target="_blank" rel="noopener"><?= e(c('legal.policy_link')) ?></a></p>
  <?php endif; ?>

  <p class="form-fail" role="alert" hidden></p>
</div>
