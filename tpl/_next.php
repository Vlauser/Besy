<?php
/**
 * «Что дальше» — перелинковка по разделу 19 ТЗ.
 *
 * Ссылки ставятся не для счётчика, а по логике человека: с цены он идёт
 * смотреть работы, с работы — узнавать стоимость, отовсюду — в контакты.
 * Ссылка на текущую страницу не показывается.
 *
 * @var string $SLUG адрес текущей страницы без слэшей
 */
$here = trim((string)($SLUG ?? ''), '/');

$all = [
    'services' => [
        'title' => trim((string)c('site.nav_services')) ?: 'Услуги',
        'text'  => 'Что мы делаем и что входит в работу',
        'url'   => url('services'),
    ],
    'landing-price' => [
        'title' => 'Сколько стоит',
        'text'  => 'Цены, сроки и что оплачивается отдельно',
        'url'   => url('landing-price'),
    ],
    'projects' => [
        'title' => trim((string)c('site.nav_projects')) ?: 'Проекты',
        'text'  => 'Работы студии с задачами и решениями',
        'url'   => url('projects'),
    ],
    'about' => [
        'title' => trim((string)c('site.nav_about')) ?: 'О студии',
        'text'  => 'Кто делает сайты и как устроен процесс',
        'url'   => url('about'),
    ],
    'blog' => [
        'title' => trim((string)c('site.nav_blog')) ?: 'Блог',
        'text'  => 'Как устроены сайты, которые приводят клиентов',
        'url'   => url('blog'),
    ],
    'contacts' => [
        'title' => trim((string)c('site.nav_contacts')) ?: 'Контакты',
        'text'  => 'Обсудить задачу и получить расчёт',
        'url'   => url('contacts'),
    ],
];

// Пустой блог никуда не ведём
if (!blog_posts()) unset($all['blog']);

// Со страницы проекта уводим в услуги, цену и остальные работы
$order = str_starts_with($here, 'projects/')
    ? ['services', 'landing-price', 'projects', 'about']
    : ['services', 'landing-price', 'projects', 'about', 'blog', 'contacts'];

$links = [];
foreach ($order as $key) {
    if ($key === $here || !isset($all[$key])) continue;
    $links[] = $all[$key];
}
if (count($links) > 3) $links = array_slice($links, 0, 3);
if (!$links) return;
?>
<section class="section next-section">
  <div class="container">
    <nav class="next-grid" aria-label="Что посмотреть дальше">
      <?php foreach ($links as $l): ?>
        <a href="<?= e($l['url']) ?>" class="next-card">
          <b><?= e($l['title']) ?></b>
          <span><?= e($l['text']) ?></span>
          <i aria-hidden="true"><?= icon('arrow', 18) ?></i>
        </a>
      <?php endforeach; ?>
    </nav>
  </div>
</section>
