<?php
declare(strict_types=1);

/**
 * Иконки интерфейса. Один в один те, что были в исходниках дизайнера,
 * только переписаны из React-компонентов в обычную функцию.
 */

function icon(string $name, int $size = 20, string $class = ''): string
{
    static $paths = [
        'check'   => '<path d="m5 12 4 4L19 6"/>',
        'arrow'   => '<path d="M7 17 17 7M7 7h10v10"/>',
        'back'    => '<path d="m15 18-6-6 6-6"/>',
        'plus'    => '<path d="M12 5v14M5 12h14"/>',
        'clock'   => '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        'compass' => '<circle cx="12" cy="12" r="8.5"/><path d="m15 9-2 4-4 2 2-4 4-2Z"/>',
        'layers'  => '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/>',
        'spark'   => '<path d="M12 2.5c.6 5.8 1.7 6.9 7.5 7.5-5.8.6-6.9 1.7-7.5 7.5-.6-5.8-1.7-6.9-7.5-7.5 5.8-.6 6.9-1.7 7.5-7.5Z"/>'
                   . '<path d="M19 16c.2 2.1.9 2.8 3 3-2.1.2-2.8.9-3 3-.2-2.1-.9-2.8-3-3 2.1-.2 2.8-.9 3-3Z"/>',
        'phone'   => '<path d="M7.2 3.8 9.7 3c.7-.2 1.5.2 1.7.9l1 3.1c.2.6 0 1.2-.5 1.6l-1.6 1.2a13.6 13.6 0 0 0 4 4l1.2-1.6c.4-.5 1-.7 1.6-.5l3.1 1c.7.2 1.1 1 .9 1.7l-.8 2.5c-.3 1-1.2 1.6-2.2 1.6A14.6 14.6 0 0 1 5.5 5.9c0-1 .7-1.9 1.7-2.1Z"/>',
        'chat'    => '<path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/>',
        'menu'    => '<path d="M4 8h16M4 16h16"/>',
        'close'   => '<path d="m6 6 12 12M18 6 6 18"/>',
    ];

    $body = $paths[$name] ?? $paths['check'];
    $cls  = $class !== '' ? ' class="' . e($class) . '"' : '';

    return '<svg width="' . $size . '" height="' . $size . '" viewBox="0 0 24 24" fill="none"'
        . ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
        . $cls . ' aria-hidden="true">' . $body . '</svg>';
}

/** Есть ли такая иконка. Нужно, чтобы отличить имя иконки от обычного текста. */
function icon_is_known(string $name): bool
{
    return in_array($name, ['check', 'arrow', 'back', 'plus', 'clock', 'compass',
                            'layers', 'spark', 'phone', 'chat', 'menu', 'close'], true);
}

/** Иконка по номеру шага или карточки — чтобы чередовались, как в макете. */
function icon_cycle(int $i, int $size = 21): string
{
    $set = ['compass', 'layers', 'arrow', 'clock', 'spark'];
    return icon($set[$i % count($set)], $size);
}
