<?php
declare(strict_types=1);
require_once __DIR__ . '/store.php';

/**
 * Настройки дизайна из админки.
 *
 * Значения подставляются в <style> на странице и перекрывают
 * переменные из assets/style.css. Пустое поле = ничего не меняем,
 * работает то, что задано в стилях.
 *
 * Всё проверяется: цвет обязан быть шестизначным HEX, число —
 * попадать в разумный диапазон. Иначе значение игнорируется.
 * Так админ не сломает сайт опечаткой и не вставит чужой код.
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

    $map = [
        'design.color_ink'       => '--ink',
        'design.color_paper'     => '--paper',
        'design.color_chalk'     => '--chalk',
        'design.color_accent'    => '--klein',
        'design.color_rule'      => '--rule',
        'design.color_rule_dark' => '--rule-dark',
    ];
    foreach ($map as $key => $var) {
        if ($hex = design_hex($key)) $vars[$var] = $hex;
    }

    if ($w = design_num('design.width', 900, 1920)) {
        $vars['--wrap'] = $w . 'px';
    }

    $css = '';

    if ($vars) {
        $parts = [];
        foreach ($vars as $k => $v) $parts[] = $k . ':' . $v;
        $css .= ':root{' . implode(';', $parts) . '}';
    }

    if ($fs = design_num('design.font_size', 14, 22)) {
        $css .= 'body{font-size:' . $fs . 'px}';
    }

    if (($tr = design_num('design.tracking', -0.09, 0.02)) !== null) {
        $css .= 'h1,h2,h3{letter-spacing:' . $tr . 'em}';
    }

    if ($md = design_num('design.marquee_desktop', 5, 300)) {
        $css .= '.marq div{animation-duration:' . $md . 's}';
    }

    if ($mm = design_num('design.marquee_mobile', 5, 300)) {
        $css .= '@media(max-width:760px){.marq div{animation-duration:' . $mm . 's}}';
    }

    return $css;
}
