<?php require_once ROOT . '/inc/md.php'; ?>
<footer class="footer">
  <div class="container">
    <div class="footer-top">
      <div>
        <a href="<?= url('') ?>" class="logo footer-logo"><?= e(c('site.brand')) ?><span><?= e(c('site.brand_mark')) ?></span></a>
        <?php if (trim((string)c('site.footer_note')) !== ''): ?>
        <p><?= nl(c('site.footer_note')) ?></p>
        <?php endif; ?>
      </div>
      <div class="footer-nav">
        <div>
          <?php if (trim((string)c('site.footer_nav_title')) !== ''): ?>
          <span><?= e(c('site.footer_nav_title')) ?></span>
          <?php endif; ?>
          <?php if (trim((string)c('site.nav_home')) !== ''): ?>
          <a href="<?= url('') ?>"><?= e(c('site.nav_home')) ?></a>
          <?php endif; ?>
          <?php if (trim((string)c('site.nav_projects')) !== ''): ?>
          <a href="<?= url('projects') ?>"><?= e(c('site.nav_projects')) ?></a>
          <?php endif; ?>
          <?php if (trim((string)c('site.nav_services')) !== ''): ?>
          <a href="<?= url('services') ?>"><?= e(c('site.nav_services')) ?></a>
          <?php endif; ?>
          <?php if (trim((string)c('site.nav_price')) !== ''): ?>
          <a href="<?= url('landing-price') ?>"><?= e(c('site.nav_price')) ?></a>
          <?php endif; ?>
          <?php /* В подвале «О команде» стоит всегда — в шапке пунктов и так много */ ?>
          <a href="<?= url('about') ?>"><?= e(trim((string)c('site.nav_about')) ?: 'О команде') ?></a>
          <?php if (blog_posts()): ?>
          <a href="<?= url('blog') ?>"><?= e(trim((string)c('site.nav_blog')) ?: 'Блог') ?></a>
          <?php endif; ?>
          <?php if (trim((string)c('site.nav_contacts')) !== ''): ?>
          <a href="<?= url('contacts') ?>"><?= e(c('site.nav_contacts')) ?></a>
          <?php endif; ?>
        </div>
        <div>
          <span>Услуги</span>
          <a href="<?= url('landing') ?>">Лендинги</a>
          <a href="<?= url('website-development') ?>">Сайты под ключ</a>
          <a href="<?= url('landing-price') ?>">Стоимость</a>
        </div>
        <div>
          <?php if (trim((string)c('site.footer_contact_title')) !== ''): ?>
          <span><?= e(c('site.footer_contact_title')) ?></span>
          <?php endif; ?>
          <?php foreach ((array)c('site.channels', []) as $ch): ?>
            <?php if (!empty($ch['url'])): ?>
              <?php
              /* По макету у телефона в подвале стоит сам номер, а у мессенджеров —
                 название: «Telegram», а не ник. Отличаем по виду ссылки. */
              $isPhone = str_starts_with((string)$ch['url'], 'tel:');
              $chText  = $isPhone
                  ? (trim((string)($ch['value'] ?? '')) ?: (string)($ch['label'] ?? ''))
                  : (trim((string)($ch['label'] ?? '')) ?: (string)($ch['value'] ?? ''));
              ?>
              <a href="<?= e($ch['url']) ?>"<?= str_starts_with((string)$ch['url'], 'http') ? ' target="_blank" rel="noreferrer"' : '' ?>><?= e($chText) ?></a>
            <?php endif; ?>
          <?php endforeach; ?>
        </div>
        <?php if ((array)c('site.socials', [])): ?>
        <div>
          <?php if (trim((string)c('site.footer_socials_title')) !== ''): ?>
          <span><?= e(c('site.footer_socials_title')) ?></span>
          <?php endif; ?>
          <?php foreach ((array)c('site.socials', []) as $soc): ?>
            <?php if (!empty($soc['url'])): ?>
              <a href="<?= e($soc['url']) ?>" target="_blank" rel="noreferrer"><?= e($soc['label'] ?? '') ?></a>
            <?php endif; ?>
          <?php endforeach; ?>
        </div>
        <?php endif; ?>
      </div>
    </div>

    <div class="footer-bottom">
      <div class="footer-legal">
        <?php if (trim((string)c('site.footer_bottom_left')) !== ''): ?><span><?= e(c('site.footer_bottom_left')) ?></span><?php endif; ?>
        <?php if ($ln = trim((string)c('site.legal_name'))): ?><span><?= e($ln) ?></span><?php endif; ?>
        <?php if ($innum = trim((string)c('site.inn'))): ?><span>ИНН <?= e($innum) ?><?php if ($og = trim((string)c('site.ogrnip'))): ?> · ОГРНИП <?= e($og) ?><?php endif; ?></span><?php endif; ?>
        <div class="footer-documents">
          <a href="<?= url('privacy') ?>">Политика обработки персональных данных</a>
          <a href="<?= url('assets/axiomantic-personal-data-consent.pdf') ?>" target="_blank" rel="noreferrer">Согласие на обработку персональных данных</a>
        </div>
      </div>
      <?php if (trim((string)c('site.footer_bottom_right')) !== ''): ?><span><?= e(c('site.footer_bottom_right')) ?></span><?php endif; ?>
    </div>
  </div>
</footer>

<?php /* В предпросмотре из админки баннер не нужен — он закрывал бы блок,
         который редактор как раз и пришёл посмотреть */ ?>
<?php if (empty($PREVIEW)): ?>
<aside class="cookie-notice" id="cookie" hidden role="dialog" aria-live="polite" aria-label="Уведомление о cookies">
  <p><?= agree_html((string)c('legal.cookie_text'), url('privacy')) ?></p>
  <div class="cookie-actions">
    <?php if (trim((string)c('legal.cookie_accept')) !== ''): ?>
    <button class="button button-primary" type="button" data-cookie="yes"><?= e(c('legal.cookie_accept')) ?></button>
    <?php endif; ?>
    <?php if (trim((string)c('legal.cookie_decline')) !== ''): ?>
    <button class="button button-secondary" type="button" data-cookie="no"><?= e(c('legal.cookie_decline')) ?></button>
    <?php endif; ?>
  </div>
</aside>
<?php endif; ?>

<?php require ROOT . '/tpl/_modal.php'; ?>
<?php require ROOT . '/tpl/_success.php'; ?>

<script>window.AXM = {api:"<?= url('api/lead.php') ?>", page:"<?= e($NAV) ?>"};</script>
<script src="<?= url('assets/app.js') ?>?v=<?= @filemtime(ROOT . '/assets/app.js') ?: 1 ?>"></script>
<?= (string)c('integrations.body_code') ?>
</body>
</html>
