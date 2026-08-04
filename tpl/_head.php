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
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="<?= e($PAGE_IMAGE) ?>">
<?php else: ?>
<meta name="twitter:card" content="summary">
<?php endif; ?>
<meta name="twitter:title" content="<?= e($PAGE_TITLE) ?>">
<meta name="twitter:description" content="<?= e($PAGE_DESC) ?>">
<link rel="icon" href="<?= url(trim((string)c('seo.favicon')) ?: 'assets/img/favicon.svg') ?>">
<?php if ($yv = trim((string)c('seo.yandex_verify'))): ?>
<meta name="yandex-verification" content="<?= e($yv) ?>">
<?php endif; ?>
<?php if ($gv = trim((string)c('seo.google_verify'))): ?>
<meta name="google-site-verification" content="<?= e($gv) ?>">
<?php endif; ?>
<link rel="stylesheet" href="<?= url('assets/style.css') ?>?v=<?= @filemtime(ROOT . '/assets/style.css') ?: 1 ?>">
<?php $dcss = function_exists('design_css') ? design_css() : ''; ?>
<?php if ($dcss !== ''): ?>
<style><?= $dcss ?></style>
<?php endif; ?>
<script type="application/ld+json"><?= seo_jsonld() ?></script>
<?php if ($mid = trim((string)c('integrations.metrika_id'))): ?>
<!-- Метрика подключается из app.js только после согласия на cookie -->
<script>window.AXM_METRIKA = <?= (int)$mid ?>;</script>
<?php endif; ?>
<?= (string)c('integrations.head_code') ?>
</head>
<body>
