<?php
declare(strict_types=1);

/**
 * Кнопка «оставить заявку».
 *
 * Открывает всплывающее окно с формой. Так человеку не нужно
 * прокручивать страницу вниз и терять то, что он читал.
 *
 * @param string $label текст кнопки; пустой — кнопка не выводится
 * @param string $class классы оформления
 */
function cta_button(string $label, string $class): string
{
    $label = trim($label);
    if ($label === '') return '';

    return '<button type="button" data-ax-open class="' . e($class) . '">'
         . e($label) . '</button>';
}
