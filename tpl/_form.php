<?php
require_once ROOT . '/inc/md.php';

/**
 * Форма заявки. Разметка — из макета дизайнера (contact-form,
 * contact-tabs, обычные label со span внутри).
 *
 * Правило раздела «Тексты в формах»: пустое название поля — поле пропадает
 * из формы. Так владелец сайта убирает лишние вопросы, не трогая код.
 * Обязательных полей два: контакт и согласие на обработку данных.
 *
 * Чего нет в макете, но нужно для работы: подписи об ошибках, скрытое
 * поле-ловушка для роботов и ссылка на политику.
 */

/* Способы связи. Оставили одну подпись — переключателя не будет,
   форма покажет сразу нужное поле. */
$modes = [];
if (trim((string)c('forms.mode_call')) !== '') {
    $modes['call'] = (string)c('forms.mode_call');
}
if (trim((string)c('forms.mode_write')) !== '') {
    $modes['write'] = (string)c('forms.mode_write');
}
// Убрали обе подписи — форма всё равно должна принимать заявки
if (!$modes) $modes['call'] = '';

$defaultMode = array_key_first($modes);
$showSwitch  = count($modes) > 1;

$optional  = trim((string)c('forms.optional_note'));
$showName  = trim((string)c('forms.label_name')) !== '';
$showMsg   = trim((string)c('forms.label_message')) !== '';
$messengers = (array)c('forms.messengers', []);
?>
<div class="contact-form" data-form data-mode="<?= e($defaultMode) ?>" aria-label="Форма обсуждения проекта">

  <?php if ($showSwitch): ?>
    <div class="contact-tabs" role="tablist" aria-label="<?= e(trim((string)c('forms.mode_label')) ?: 'Способ связи') ?>">
      <?php foreach ($modes as $key => $label): ?>
        <button type="button" data-mode-btn="<?= e($key) ?>" role="tab"
                class="<?= $key === $defaultMode ? 'active' : '' ?>"
                aria-selected="<?= $key === $defaultMode ? 'true' : 'false' ?>" aria-pressed="<?= $key === $defaultMode ? 'true' : 'false' ?>">
          <?= icon($key === 'call' ? 'phone' : 'chat', 16) ?><?= e($label) ?>
        </button>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <?php if (isset($modes['call'])): ?>
    <!-- Звонок -->
    <label data-pane="call"<?= $defaultMode === 'call' ? '' : ' hidden' ?>>
      <?php if (trim((string)c('forms.label_phone')) !== ''): ?>
        <span><?= e(c('forms.label_phone')) ?></span>
      <?php endif; ?>
      <input type="tel" name="phone" autocomplete="tel"
             placeholder="<?= e(c('forms.ph_phone')) ?>" data-contact>
      <em class="field-error" hidden><?= e(c('forms.err_contact')) ?></em>
    </label>
  <?php endif; ?>

  <?php if (isset($modes['write'])): ?>
    <!-- Сообщение в мессенджер -->
    <div data-pane="write"<?= $defaultMode === 'write' ? '' : ' hidden' ?>>
      <?php if (count($messengers) > 1): ?>
        <div class="ax-messengers" role="group" aria-label="<?= e(trim((string)c('forms.label_messenger')) ?: 'Мессенджер') ?>">
          <?php foreach ($messengers as $i => $m): ?>
            <button type="button" data-messenger="<?= e($m['key'] ?? '') ?>"
                    data-placeholder="<?= e($m['placeholder'] ?? '') ?>"
                    data-field-label="<?= e($m['field_label'] ?? c('forms.label_messenger')) ?>"
                    data-input-type="<?= e($m['input_type'] ?? 'text') ?>"
                    class="<?= $i === 0 ? 'is-active' : '' ?>"
                    aria-pressed="<?= $i === 0 ? 'true' : 'false' ?>"><?= e($m['label'] ?? '') ?></button>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>

      <label>
        <span data-messenger-field-label><?= e($messengers[0]['field_label'] ?? c('forms.label_messenger')) ?></span>
        <input type="<?= e($messengers[0]['input_type'] ?? 'text') ?>" name="messenger_contact" data-contact
               placeholder="<?= e($messengers[0]['placeholder'] ?? '') ?>">
        <em class="field-error" hidden><?= e(c('forms.err_contact')) ?></em>
      </label>
    </div>
  <?php endif; ?>

  <!-- Имя. Пустое название в админке — поля не будет -->
  <?php if ($showName): ?>
    <label>
      <span><?= e(c('forms.label_name')) ?><?php if ($optional !== ''): ?> <em><?= e($optional) ?></em><?php endif; ?></span>
      <input type="text" name="name" autocomplete="name" placeholder="<?= e(c('forms.ph_name')) ?>">
    </label>
  <?php endif; ?>

  <!-- Комментарий. Тоже убирается пустым названием -->
  <?php if ($showMsg): ?>
    <label data-only="page">
      <span><?= e(c('forms.label_message')) ?><?php if ($optional !== ''): ?> <em><?= e($optional) ?></em><?php endif; ?></span>
      <textarea name="message" rows="3" placeholder="<?= e(c('forms.ph_message')) ?>"></textarea>
    </label>
  <?php endif; ?>

  <!-- Согласие на обработку — обязательное, по ст. 9 152-ФЗ.
       Единственное поле, которое нельзя убрать из админки -->
  <label class="consent-row">
    <input type="checkbox" name="consent" data-req-check>
    <span><?= agree_html((string)c('forms.agree'), url('assets/axiomantic-personal-data-consent.pdf')) ?></span>
  </label>
  <?php if (trim((string)c('forms.err_agree')) !== ''): ?>
    <em class="field-error consent-error" hidden><?= e(c('forms.err_agree')) ?></em>
  <?php endif; ?>

  <!-- Согласие на рекламу — отдельное, по ч.1 ст.18 38-ФЗ -->
  <?php if (!empty(c('forms.marketing_on')) && trim((string)c('forms.marketing')) !== ''): ?>
    <label class="consent-row marketing-consent">
      <input type="checkbox" name="marketing" value="1">
      <span><?= e(c('forms.marketing')) ?><?php if (trim((string)c('forms.marketing_note')) !== ''): ?><small><?= e(c('forms.marketing_note')) ?></small><?php endif; ?></span>
    </label>
  <?php endif; ?>

  <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">

  <button class="button button-primary" type="button" data-submit><?= !empty($FORM_MODAL) ? 'Отправить заявку' : e(trim((string)c('forms.submit')) ?: 'Отправить') ?></button>

  <?php if (trim((string)c('legal.policy_link')) !== ''): ?>
    <p class="form-policy"><a href="<?= url('privacy') ?>" target="_blank" rel="noopener"><?= e(c('legal.policy_link')) ?></a></p>
  <?php endif; ?>

  <p class="form-fail" role="alert" hidden></p>
</div>
