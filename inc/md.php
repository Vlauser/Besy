<?php
declare(strict_types=1);

/**
 * Маленький конвертер Markdown → HTML.
 * Нужен только для юридических текстов из админки: заголовки, списки,
 * жирный, курсив, ссылки, разделители. Ничего лишнего.
 *
 * Важно: весь текст экранируется ДО разбора, поэтому вставить
 * произвольный HTML через админку нельзя.
 */

function md_inline(string $s): string
{
    // Жирный и курсив
    $s = preg_replace('/\*\*(.+?)\*\*/u', '<strong>$1</strong>', $s) ?? $s;
    $s = preg_replace('/(?<![\*\w])\*([^\*\n]+)\*(?!\*)/u', '<em>$1</em>', $s) ?? $s;

    // Ссылки внутри сайта: [текст](/blog) — открываются в той же вкладке
    $s = preg_replace_callback('/\[([^\]]+)\]\((\/[^\s\)]*)\)/u', function ($m) {
        return '<a href="' . $m[2] . '">' . $m[1] . '</a>';
    }, $s) ?? $s;

    // Ссылки вида [текст](адрес)
    $s = preg_replace_callback('/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/u', function ($m) {
        return '<a href="' . $m[2] . '" target="_blank" rel="noopener">' . $m[1] . '</a>';
    }, $s) ?? $s;

    // Голые ссылки (без завершающей точки или запятой)
    $s = preg_replace('~(?<![">=])(https?://[^\s<)]*[^\s<).,;:!?])~u', '<a href="$1" target="_blank" rel="noopener">$1</a>', $s) ?? $s;

    // Почта
    $s = preg_replace('/(?<![\w.@-])([\w.\-]+@[\w.\-]+\.\w{2,})/u', '<a href="mailto:$1">$1</a>', $s) ?? $s;

    return $s;
}

function md_to_html(string $md): string
{
    $md = str_replace(["\r\n", "\r"], "\n", $md);
    $md = htmlspecialchars($md, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

    $out    = [];
    $inList = false;
    $para   = [];

    $flushPara = function () use (&$para, &$out) {
        if ($para) {
            $out[] = '<p>' . md_inline(implode(' ', $para)) . '</p>';
            $para = [];
        }
    };
    $closeList = function () use (&$inList, &$out) {
        if ($inList) {
            $out[] = '</ul>';
            $inList = false;
        }
    };

    foreach (explode("\n", $md) as $line) {
        $t = trim($line);

        // Пустая строка — конец абзаца
        if ($t === '') {
            $flushPara();
            $closeList();
            continue;
        }

        // Разделитель
        if (preg_match('/^(-{3,}|\*{3,}|_{3,})$/', $t)) {
            $flushPara();
            $closeList();
            $out[] = '<hr>';
            continue;
        }

        // Картинка на всю ширину: ![описание](путь)
        // Описание обязательно — это alt для поиска по картинкам
        if (preg_match('~^!\[([^\]]*)\]\(([^\s\)]+)\)$~u', $t, $m)) {
            $flushPara();
            $closeList();
            $out[] = md_image($m[2], $m[1]);
            continue;
        }

        // Цитата
        if (preg_match('/^&gt;\s*(.+)$/u', $t, $m)) {
            $flushPara();
            $closeList();
            $out[] = '<blockquote><p>' . md_inline(trim($m[1])) . '</p></blockquote>';
            continue;
        }

        // Заголовки
        if (preg_match('/^(#{1,4})\s+(.+)$/u', $t, $m)) {
            $flushPara();
            $closeList();
            $lvl = min(max(strlen($m[1]), 2), 5);   // h1 остаётся у страницы, # и ## → h2
            $out[] = '<h' . $lvl . '>' . md_inline(trim($m[2])) . '</h' . $lvl . '>';
            continue;
        }

        // Пункты списка
        if (preg_match('/^[-*+]\s+(.+)$/u', $t, $m)) {
            $flushPara();
            if (!$inList) {
                $out[] = '<ul>';
                $inList = true;
            }
            $out[] = '<li>' . md_inline(trim($m[1])) . '</li>';
            continue;
        }

        // Нумерованные пункты вида «7.1.» оставляем обычным абзацем —
        // так они выглядят как в исходном документе
        $closeList();
        $para[] = $t;
    }

    $flushPara();
    $closeList();

    return implode("\n", $out);
}

/**
 * Картинка внутри текста статьи.
 *
 * Локальные файлы отдаём через img_html — с WebP, размерами и отложенной
 * загрузкой. Чужие адреса вставляем как есть, но без размеров: их не узнать,
 * не скачав файл. Всё, что не похоже на путь к картинке, отбрасываем —
 * так через разметку не подсунуть постороннюю ссылку.
 */
function md_image(string $src, string $alt): string
{
    $src = html_entity_decode($src, ENT_QUOTES, 'UTF-8');
    $alt = html_entity_decode($alt, ENT_QUOTES, 'UTF-8');

    if (str_starts_with($src, 'https://') || str_starts_with($src, 'http://')) {
        return '<figure class="md-figure"><img src="' . e($src) . '" alt="' . e($alt)
             . '" loading="lazy" decoding="async"></figure>';
    }

    $rel = ltrim($src, '/');
    if ($rel === '' || !is_file(ROOT . '/' . $rel)) return '';

    $html = function_exists('img_html')
        ? img_html($rel, $alt)
        : '<img src="' . e(url($rel)) . '" alt="' . e($alt) . '" loading="lazy">';

    return '<figure class="md-figure">' . $html
         . ($alt !== '' ? '<figcaption>' . e($alt) . '</figcaption>' : '')
         . '</figure>';
}

/**
 * Текст согласия у формы. Кусок в [[двойных скобках]] превращается
 * в ссылку на политику — так редактор не может вставить чужой HTML.
 */
function agree_html(string $text, string $href): string
{
    $safe = htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return preg_replace_callback('/\[\[(.+?)\]\]/u', function ($m) use ($href) {
        return '<a href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8')
            . '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' . $m[1] . '</a>';
    }, $safe) ?? $safe;
}

/**
 * Готовит текст статьи под макет дизайнера.
 *
 * В макете статья устроена так: слева карточка «короткий ответ», справа
 * текст, разбитый заголовками на секции, а пункты списков идут с галочкой.
 * Автору в админке ничего этого знать не нужно — он пишет обычный текст,
 * а раскладку собираем здесь:
 *   · первая цитата (строка со знаком «>») уходит в карточку слева;
 *   · каждый заголовок второго уровня начинает новую секцию;
 *   · пункты списков получают галочку, как в макете.
 *
 * @return array{summary:string, body:string} summary пуст, если цитаты не было
 */
function article_layout(string $html): array
{
    $summary = '';

    // Первая цитата — это и есть «короткий ответ»
    if (preg_match('~<blockquote>\s*<p>(.*?)</p>\s*</blockquote>~su', $html, $m)) {
        $summary = trim($m[1]);
        $html = str_replace($m[0], '', $html);
    }

    // Пункты списков — с галочкой
    $html = preg_replace_callback('~<li>(.*?)</li>~su', function ($m) {
        return '<li>' . icon('check', 15) . '<span>' . trim($m[1]) . '</span></li>';
    }, $html) ?? $html;

    // Разбиваем на секции по заголовкам второго уровня
    $parts = preg_split('~(?=<h2>)~u', $html) ?: [];
    $out = '';
    foreach ($parts as $part) {
        $part = trim($part);
        if ($part === '') continue;
        $out .= '<section>' . $part . '</section>';
    }

    return ['summary' => $summary, 'body' => $out !== '' ? $out : $html];
}
