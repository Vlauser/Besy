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

/**
 * Есть ли в разделе хоть что-то заполненное.
 *
 * Правило всего сайта: очистили все поля блока в админке — блок
 * не выводится. Иначе на странице остаётся пустая полоса с отступами,
 * и человеку кажется, что сайт сломался.
 *
 * @param string ...$paths пути к настройкам: 'hero.title_1', 'faq.items'
 */
function has_any(string ...$paths): bool
{
    foreach ($paths as $path) {
        $v = c($path);

        if (is_array($v)) {
            // Список считается заполненным, если хоть в одном пункте есть текст
            foreach ($v as $item) {
                if (is_array($item)) {
                    foreach ($item as $field) {
                        if (is_string($field) && trim($field) !== '') return true;
                    }
                } elseif (is_string($item) && trim($item) !== '') {
                    return true;
                }
            }
            continue;
        }

        if (trim((string)$v) !== '') return true;
    }

    return false;
}
