<?php
declare(strict_types=1);
require_once __DIR__ . '/store.php';

/**
 * Настройки оформления из админки.
 *
 * Значения подставляются в <style> на странице и перекрывают то, что
 * задано в assets/style.css и assets/commercial.css. Пустое поле —
 * ничего не меняем, работает оформление дизайнера.
 *
 * Всё проверяется: цвет обязан быть шестизначным HEX, число — попадать
 * в разумный диапазон. Иначе значение игнорируется. Так владелец сайта
 * не сломает вёрстку опечаткой и не вставит чужой код.
 *
 * Важно: имена переменных здесь должны совпадать с теми, что реально
 * объявлены в :root у дизайнера. До правки тут были --klein, --rule,
 * --chalk и --wrap из старого оформления — их в новых стилях нет,
 * и весь раздел «Дизайн» не работал.
 */

function design_hex(string $key): ?string
{
    $v = trim((string)c($key));
    if ($v === '') return null;
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $v)) return null;
    return strtoupper($v);
}

function design_num(string $key, float $min, float $max): ?string
{
    $v = trim((string)c($key));
    if ($v === '') return null;
    $v = str_replace(',', '.', $v);
    if (!is_numeric($v)) return null;
    $n = (float)$v;
    if ($n < $min || $n > $max) return null;
    // Убираем лишний ноль в дробной части: 22.0 → 22
    return rtrim(rtrim(number_format($n, 3, '.', ''), '0'), '.');
}

function design_css(): string
{
    $vars = [];

    /* Цвета. Названия переменных — из :root дизайнера */
    $map = [
        'design.color_ink'    => '--ink',      // основной текст и заголовки
        'design.color_muted'  => '--muted',    // серый пояснительный текст
        'design.color_bg'     => '--bg',       // фон страницы
        'design.color_paper'  => '--paper',    // фон карточек
        'design.color_line'   => '--line',     // линии и рамки
        'design.color_accent' => '--blue',     // кнопки и ссылки
    ];
    foreach ($map as $key => $var) {
        if ($hex = design_hex($key)) $vars[$var] = $hex;
    }

    if ($r = design_num('design.radius', 0, 40)) {
        $vars['--radius'] = $r . 'px';
    }

    $css = '';
    if ($vars) {
        $parts = [];
        foreach ($vars as $k => $v) $parts[] = $k . ':' . $v;
        $css .= ':root{' . implode(';', $parts) . '}';
    }

    /* Ширина содержимого. У дизайнера 1200px, поля по 24px с каждой стороны */
    if ($w = design_num('design.width', 900, 1600)) {
        $css .= '.container{width:min(' . $w . 'px,calc(100% - 48px))}';
    }

    /* Высота отступов между блоками — этим сайт укорачивается или растягивается.
       У дизайнера 118px на компьютере и 82px на телефоне. Мобильное значение
       считаем от заданного в той же пропорции, чтобы на телефоне не разъезжалось. */
    if ($pad = design_num('design.section_space', 40, 200)) {
        $mob = max(28, (int)round((float)$pad * 0.7));
        $css .= '.section{padding:' . $pad . 'px 0}';
        $css .= '@media(max-width:760px){.section{padding:' . $mob . 'px 0}}';
    }

    /* Первый экран страниц — отдельно: он обычно выше остальных блоков */
    if ($hero = design_num('design.hero_space', 40, 220)) {
        $mob = max(28, (int)round((float)$hero * 0.62));
        $css .= '.page-hero{padding:' . $hero . 'px 0 ' . (int)round((float)$hero * 0.67) . 'px}';
        $css .= '@media(max-width:760px){.page-hero{padding:' . $mob . 'px 0 ' . (int)round($mob * 0.7) . 'px}}';
    }

    if ($fs = design_num('design.font_size', 14, 22)) {
        $css .= 'body{font-size:' . $fs . 'px}';
    }

    if (($tr = design_num('design.tracking', -0.09, 0.02)) !== null) {
        $css .= 'h1,h2,h3{letter-spacing:' . $tr . 'em}';
    }

    return $css;
}
