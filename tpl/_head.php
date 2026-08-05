<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($PAGE_TITLE) ?></title>
<meta name="description" content="<?= e($PAGE_DESC) ?>">
<link rel="canonical" href="<?= e($CANONICAL) ?>">
<?php if (!empty($PAGE_NOINDEX)): ?>
<meta name="robots" content="noindex, nofollow">
<?php else: ?>
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<?php endif; ?>

<?php /* Шрифты грузятся раньше стилей: иначе текст первого экрана
         ждёт разбора CSS и мигает системным начертанием */ ?>
<link rel="preload" href="<?= url('assets/fonts/geist-875ccdd4.woff2') ?>" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="<?= url('assets/fonts/geist-mono-44e03052.woff2') ?>" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="<?= url('assets/style.css') ?>?v=<?= @filemtime(ROOT . '/assets/style.css') ?: 1 ?>">
<link rel="stylesheet" href="<?= url('assets/commercial.css') ?>?v=<?= @filemtime(ROOT . '/assets/commercial.css') ?: 1 ?>">

<?php /* Картинка первого экрана — обычно самый крупный элемент, по которому
         считается LCP. Просим браузер начать её заранее, не дожидаясь разметки */ ?>
<?php if (!empty($LCP_IMAGE)): ?>
<link rel="preload" href="<?= url($LCP_IMAGE) ?>" as="image" fetchpriority="high"<?= !empty($LCP_TYPE) ? ' type="' . e($LCP_TYPE) . '"' : '' ?>>
<?php endif; ?>

<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="<?= e($PAGE_TITLE) ?>">
<meta property="og:description" content="<?= e($PAGE_DESC) ?>">
<meta property="og:url" content="<?= e($CANONICAL) ?>">
<meta property="og:site_name" content="<?= e(c('site.brand')) ?>">
<?php if (!empty($PAGE_IMAGE)): ?>
<meta property="og:image" content="<?= e($PAGE_IMAGE) ?>">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="<?= e($PAGE_TITLE) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="<?= e($PAGE_IMAGE) ?>">
<?php else: ?>
<meta name="twitter:card" content="summary">
<?php endif; ?>
<meta name="twitter:title" content="<?= e($PAGE_TITLE) ?>">
<meta name="twitter:description" content="<?= e($PAGE_DESC) ?>">

<?php /* Город из настроек: Яндекс учитывает привязку в местной выдаче */ ?>
<?php if ($city = trim((string)c('seo.org_city'))): ?>
<meta name="geo.region" content="RU">
<meta name="geo.placename" content="<?= e($city) ?>">
<?php endif; ?>
<meta name="theme-color" content="<?= e(trim((string)c('design.color_accent')) ?: '#0a5cff') ?>">

<link rel="icon" href="<?= url(trim((string)c('seo.favicon')) ?: 'assets/img/favicon.svg') ?>">
<?php if ($yv = trim((string)c('seo.yandex_verify'))): ?>
<meta name="yandex-verification" content="<?= e($yv) ?>">
<?php endif; ?>
<?php if ($gv = trim((string)c('seo.google_verify'))): ?>
<meta name="google-site-verification" content="<?= e($gv) ?>">
<?php endif; ?>
<?php $dcss = function_exists('design_css') ? design_css() : ''; ?>
<?php if ($dcss !== ''): ?>
<style><?= $dcss ?></style>
<?php endif; ?>
<script type="application/ld+json"><?= seo_jsonld($SLUG ?? '', $METAKEY ?? 'home', $PROJECT ?? null, $POST ?? null) ?></script>
<?php if (empty($PREVIEW) && ($mid = trim((string)c('integrations.metrika_id')))): ?>
<?php /* Соединение с Метрикой готовится заранее, но сам счётчик
         подключается из app.js только после согласия на cookie */ ?>
<link rel="preconnect" href="https://mc.yandex.ru" crossorigin>
<script>window.AXM_METRIKA = <?= (int)$mid ?>;</script>
<?php endif; ?>
<?= (string)c('integrations.head_code') ?>
</head>
<body>
