<?php
declare(strict_types=1);

/**
 * Описание админки: какие разделы, какие поля, что повторяется.
 * Добавили поле здесь — оно появилось в панели и сохраняется
 * в data/content.json.
 */

function schema(): array
{
    return [

        /* ==================== ГЛАВНАЯ ==================== */

        'hero' => [
            'group' => 'Главная',
            'title' => 'Первый экран',
            'desc'  => 'Заголовок собирается из трёх частей: две строки обычным начертанием и выделенное слово — так работает подсветка в макете.',
            'fields' => [
                'hero.title_1'       => ['label' => 'Заголовок, первая строка', 'type' => 'text'],
                'hero.title_2'       => ['label' => 'Вторая строка, начало', 'type' => 'text', 'w' => 'm', 'hint' => 'Например «за».'],
                'hero.title_accent'  => ['label' => 'Выделенная часть', 'type' => 'text', 'w' => 'm', 'hint' => 'Показывается акцентным цветом.'],
                'hero.text'          => ['label' => 'Описание под заголовком', 'type' => 'textarea', 'rows' => 3, 'hides' => 'описание'],
                'hero.cta_primary'   => ['label' => 'Главная кнопка', 'type' => 'text', 'w' => 'm'],
                'hero.cta_secondary' => ['label' => 'Вторая кнопка', 'type' => 'text', 'w' => 'm'],
                'hero.image'         => ['label' => 'Иллюстрация справа', 'type' => 'image', 'hint' => 'Персонаж. Пустое поле — блок скрывается.', 'hides' => 'картинку'],
            ],
            'repeaters' => [[
                'path' => 'hero.badges', 'label' => 'Плашка', 'title_field' => 'text', 'max' => 6,
                'fields' => ['text' => ['label' => 'Текст', 'type' => 'text']],
            ]],
        ],

        'comparison' => [
            'group' => 'Главная',
            'title' => 'Сравнение с обычной разработкой',
            'desc'  => 'Две колонки и цифра между ними: слева как бывает обычно, справа как у вас.',
            'fields' => [
                'comparison.kicker'      => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'comparison.title'       => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'comparison.lede'        => ['label' => 'Описание справа', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание блока'],
                'comparison.label_bad'   => ['label' => 'Подпись левой колонки', 'type' => 'text', 'w' => 'm', 'hides' => 'подпись колонки'],
                'comparison.label_good'  => ['label' => 'Подпись правой колонки', 'type' => 'text', 'w' => 'm', 'hides' => 'подпись колонки'],
                'comparison.center_pre'  => ['label' => 'Центр: надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над цифрой'],
                'comparison.center_num'  => ['label' => 'Центр: цифра', 'type' => 'text', 'w' => 's', 'hides' => 'цифру'],
                'comparison.center_post' => ['label' => 'Центр: подпись снизу', 'type' => 'text', 'w' => 's', 'hides' => 'подпись под цифрой'],
            ],
            'repeaters' => [
                [
                    'path' => 'comparison.bad', 'label' => 'Пункт слева', 'title_field' => 'text', 'max' => 8,
                    'fields' => ['text' => ['label' => 'Текст', 'type' => 'text']],
                ],
                [
                    'path' => 'comparison.good', 'label' => 'Пункт справа', 'title_field' => 'text', 'max' => 8,
                    'fields' => ['text' => ['label' => 'Текст', 'type' => 'text']],
                ],
            ],
        ],

        'process' => [
            'group' => 'Главная',
            'title' => 'Этапы работы',
            'fields' => [
                'process.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'process.title'  => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
            ],
            'repeaters' => [[
                'path' => 'process.items', 'label' => 'Этап', 'title_field' => 'title', 'max' => 6,
                'fields' => [
                    'number' => ['label' => 'Номер', 'type' => 'text', 'w' => 's'],
                    'title'  => ['label' => 'Название', 'type' => 'text'],
                    'text'   => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 3],
                ],
            ]],
        ],

        'benefits' => [
            'group' => 'Главная',
            'title' => 'Узнали себя (боли клиента)',
            'desc'  => 'Ситуации, в которых клиенту нужен сайт. Говорите его словами, а не своими.',
            'fields' => [
                'benefits.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'benefits.title'  => ['label' => 'Заголовок', 'type' => 'text', 'w' => 'm', 'hides' => 'заголовок блока'],
                'benefits.cta'    => ['label' => 'Кнопка', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку'],
            ],
            'repeaters' => [[
                'path' => 'benefits.items', 'label' => 'Ситуация', 'title_field' => 'title', 'max' => 8,
                'fields' => [
                    'title' => ['label' => 'Заголовок', 'type' => 'text'],
                    'text'  => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2],
                ],
            ]],
        ],

        'home_services' => [
            'group' => 'Главная',
            'title' => 'Услуги на главной',
            'desc'  => 'Две-три карточки. Полный список — в разделе «Услуги».',
            'fields' => [
                'home_services.kicker'   => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'home_services.title'    => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'home_services.lede'     => ['label' => 'Описание справа', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание блока'],
                'home_services.all_link' => ['label' => 'Кнопка «все услуги»', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку «все услуги»'],
            ],
            'repeaters' => [[
                'path' => 'home_services.items', 'label' => 'Услуга', 'title_field' => 'name', 'max' => 4,
                'fields' => [
                    'number'   => ['label' => 'Номер', 'type' => 'text', 'w' => 's'],
                    'name'     => ['label' => 'Название', 'type' => 'text'],
                    'text'     => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2],
                    'features' => ['label' => 'Что входит', 'type' => 'list', 'rows' => 5, 'hint' => 'Каждый пункт с новой строки.'],
                    'price'    => ['label' => 'Цена', 'type' => 'text', 'w' => 'm'],
                    'note'     => ['label' => 'Подпись под ценой', 'type' => 'text', 'w' => 'm'],
                    'button'   => ['label' => 'Кнопка', 'type' => 'text', 'w' => 'm'],
                    'featured' => ['label' => 'Выделить карточку', 'type' => 'check', 'w' => 'm'],
                ],
            ]],
        ],

        'cta' => [
            'group' => 'Главная',
            'title' => 'Блок с персонажем',
            'desc'  => 'Повторяется на всех страницах, кроме политики.',
            'fields' => [
                'cta.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'cta.title'  => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'cta.text'   => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание'],
                'cta.button' => ['label' => 'Кнопка', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку'],
                'cta.image'  => ['label' => 'Иллюстрация', 'type' => 'image', 'hides' => 'картинку'],
            ],
        ],

        'projects_home' => [
            'group' => 'Главная',
            'title' => 'Проекты на главной',
            'desc'  => 'Сами проекты — в разделе «Портфолио». На главную попадают первые три из списка.',
            'fields' => [
                'projects_home.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'projects_home.title'  => ['label' => 'Заголовок', 'type' => 'text', 'w' => 'm', 'hides' => 'заголовок блока'],
                'projects_home.button' => ['label' => 'Кнопка', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку'],
            ],
        ],

        'faq' => [
            'group' => 'Главная',
            'title' => 'Вопросы и ответы',
            'desc'  => 'Показываются и на главной, и на странице контактов.',
            'fields' => [
                'faq.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'faq.title'  => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'faq.lede'   => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание блока'],
                'faq.link'   => ['label' => 'Ссылка «задать вопрос»', 'type' => 'text', 'w' => 'm', 'hides' => 'ссылку'],
            ],
            'repeaters' => [[
                'path' => 'faq.items', 'label' => 'Вопрос', 'title_field' => 'q', 'max' => 15,
                'fields' => [
                    'q' => ['label' => 'Вопрос', 'type' => 'text'],
                    'a' => ['label' => 'Ответ', 'type' => 'textarea', 'rows' => 4],
                ],
            ]],
        ],

        'request' => [
            'group' => 'Главная',
            'title' => 'Блок заявки',
            'desc'  => 'Нижний блок главной с формой. Пункт меню «Контакты» ведёт именно сюда.',
            'fields' => [
                'request.kicker'     => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'request.title'      => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'request.text'       => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание'],
                'request.promise'    => ['label' => 'Обещание под контактами', 'type' => 'text', 'hides' => 'строку с обещанием'],
                'request.form_small' => ['label' => 'Над формой: мелкая строка', 'type' => 'text', 'w' => 'm'],
                'request.form_big'   => ['label' => 'Над формой: крупная строка', 'type' => 'text', 'w' => 'm'],
            ],
        ],

        /* ==================== СТРАНИЦЫ ==================== */

        'work' => [
            'group' => 'Страницы',
            'title' => 'Портфолио',
            'desc'  => 'Ключ категории у проекта должен совпадать с ключом фильтра, иначе проект не покажется при выборе.',
            'fields' => [
                'work.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'work.title'  => ['label' => 'Заголовок страницы', 'type' => 'text', 'hides' => 'заголовок блока'],
                'work.lede'   => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 3, 'hides' => 'описание блока'],
            ],
            'repeaters' => [
                [
                    'path' => 'work.items', 'label' => 'Проект', 'title_field' => 'name', 'max' => 30,
                    'fields' => [
                        'name'     => ['label' => 'Название', 'type' => 'text'],
                        'slug'     => ['label' => 'Ключ проекта', 'type' => 'text', 'w' => 'm', 'hint' => 'Латиницей, для служебных нужд.'],
                        'category' => ['label' => 'Категория — как показывать', 'type' => 'text', 'w' => 'm'],
                        'cat'      => ['label' => 'Категория — ключ фильтра', 'type' => 'text', 'w' => 'm', 'hint' => 'small, services, events, experts.'],
                        'short'    => ['label' => 'Короткое описание', 'type' => 'textarea', 'rows' => 2],
                        'image'    => ['label' => 'Скриншот', 'type' => 'image'],
                        'url'      => ['label' => 'Ссылка на сайт', 'type' => 'text'],
                        'monogram' => ['label' => 'Монограмма', 'type' => 'text', 'w' => 's', 'hint' => 'Показывается, если скриншота нет.'],
                    ],
                ],
                [
                    'path' => 'work.filters', 'label' => 'Фильтр', 'title_field' => 'label', 'max' => 10,
                    'fields' => [
                        'key'   => ['label' => 'Ключ', 'type' => 'text', 'w' => 'm'],
                        'label' => ['label' => 'Подпись кнопки', 'type' => 'text', 'w' => 'm'],
                    ],
                ],
            ],
        ],

        'services' => [
            'group' => 'Страницы',
            'title' => 'Услуги',
            'fields' => [
                'services.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'services.title'  => ['label' => 'Заголовок страницы', 'type' => 'text', 'hides' => 'заголовок блока'],
                'services.lede'   => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 3, 'hides' => 'описание блока'],
            ],
            'repeaters' => [[
                'path' => 'services.items', 'label' => 'Услуга', 'title_field' => 'name', 'max' => 12,
                'fields' => [
                    'number'   => ['label' => 'Номер', 'type' => 'text', 'w' => 's'],
                    'name'     => ['label' => 'Название', 'type' => 'text'],
                    'text'     => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2],
                    'features' => ['label' => 'Что входит', 'type' => 'list', 'rows' => 6, 'hint' => 'Каждый пункт с новой строки.'],
                    'price'    => ['label' => 'Цена', 'type' => 'text', 'w' => 'm'],
                    'note'     => ['label' => 'Подпись под ценой', 'type' => 'text', 'w' => 'm'],
                    'button'   => ['label' => 'Кнопка', 'type' => 'text', 'w' => 'm'],
                    'featured' => ['label' => 'Выделить карточку', 'type' => 'check', 'w' => 'm'],
                ],
            ]],
        ],

        'contacts' => [
            'group' => 'Страницы',
            'title' => 'Страница контактов',
            'desc'  => 'Сами адреса и телефоны — в разделе «Контакты и шапка». Здесь только заголовки.',
            'fields' => [
                'contacts.kicker'         => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'contacts.title'          => ['label' => 'Заголовок страницы', 'type' => 'text', 'hides' => 'заголовок блока'],
                'contacts.lede'           => ['label' => 'Описание', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание блока'],
                'contacts.heading_kicker' => ['label' => 'Способы связи: надпись', 'type' => 'text', 'w' => 'm'],
                'contacts.heading_title'  => ['label' => 'Способы связи: заголовок', 'type' => 'text', 'w' => 'm'],
                'contacts.faq_kicker'     => ['label' => 'FAQ: надпись', 'type' => 'text', 'w' => 'm'],
                'contacts.faq_title'      => ['label' => 'FAQ: заголовок', 'type' => 'text', 'w' => 'm'],
                'contacts.faq_lede'       => ['label' => 'FAQ: описание', 'type' => 'textarea', 'rows' => 2],
            ],
        ],

        /* ==================== НАСТРОЙКИ ==================== */

        'error404' => [
            'group' => 'Страницы',
            'title' => 'Страница 404',
            'desc'  => 'Показывается, когда посетитель попал на несуществующий адрес. Способы связи берутся из раздела «Контакты и шапка».',
            'fields' => [
                'error404.code'         => ['label' => 'Крупная надпись', 'type' => 'text', 'w' => 's', 'hides' => 'крупную надпись'],
                'error404.title'        => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'error404.text'         => ['label' => 'Пояснение', 'type' => 'textarea', 'rows' => 2, 'hint' => 'Перенос строки сохраняется.', 'hides' => 'описание'],
                'error404.btn_home'     => ['label' => 'Кнопка «на главную»', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку'],
                'error404.btn_projects' => ['label' => 'Кнопка «проекты»', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку'],
                'error404.image'        => ['label' => 'Иллюстрация', 'type' => 'image', 'hides' => 'картинку'],
            ],
        ],

        'site' => [
            'group' => 'Настройки',
            'title' => 'Контакты, меню, реквизиты',
            'desc'  => 'Пустой канал связи просто не показывается на сайте.',
            'fields' => [
                'site.brand'        => ['label' => 'Название', 'type' => 'text', 'w' => 'm'],
                'site.brand_mark'   => ['label' => 'Значок после названия', 'type' => 'text', 'w' => 's', 'hides' => 'значок после названия'],
                'site.email'        => ['label' => 'Почта для документов', 'type' => 'text', 'w' => 'm', 'hint' => 'Указывается в политике, согласии и микроразметке. Чтобы почта появилась на сайте, добавьте её ещё и в список каналов ниже.'],
                'site.phone'        => ['label' => 'Телефон', 'type' => 'text', 'w' => 'm'],
                'site.hours'        => ['label' => 'Город и часы работы', 'type' => 'text', 'hides' => 'строку с городом и часами'],

                'site.header_cta'   => ['label' => 'Кнопка в шапке', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку в шапке'],
                'site.nav_home'     => ['label' => 'Меню: главная', 'type' => 'text', 'w' => 's', 'hides' => 'пункт меню'],
                'site.nav_projects' => ['label' => 'Меню: проекты', 'type' => 'text', 'w' => 's', 'hides' => 'пункт меню'],
                'site.nav_services' => ['label' => 'Меню: услуги', 'type' => 'text', 'w' => 's', 'hides' => 'пункт меню'],
                'site.nav_contacts' => ['label' => 'Меню: контакты', 'type' => 'text', 'w' => 's', 'hides' => 'пункт меню'],

                'site.footer_note'          => ['label' => 'Подпись в подвале', 'type' => 'textarea', 'rows' => 2, 'hides' => 'подпись в подвале'],
                'site.footer_nav_title'     => ['label' => 'Подвал: заголовок навигации', 'type' => 'text', 'w' => 'm', 'hides' => 'заголовок столбца'],
                'site.footer_contact_title' => ['label' => 'Подвал: заголовок контактов', 'type' => 'text', 'w' => 'm', 'hides' => 'заголовок столбца'],
                'site.footer_socials_title' => ['label' => 'Подвал: заголовок соцсетей', 'type' => 'text', 'w' => 'm', 'hint' => 'Столбец появляется, только если ниже добавлена хотя бы одна соцсеть.'],
                'site.footer_bottom_left'   => ['label' => 'Подвал: строка слева', 'type' => 'text', 'w' => 'm', 'hides' => 'строку в подвале'],
                'site.footer_bottom_right'  => ['label' => 'Подвал: строка справа', 'type' => 'text', 'w' => 'm', 'hides' => 'строку в подвале'],

                'site.legal_name' => ['label' => 'Полное наименование', 'type' => 'text', 'hint' => 'По ст. 9 закона о защите прав потребителей ИП обязан сообщить о себе до сделки.'],
                'site.ogrnip'     => ['label' => 'ОГРНИП', 'type' => 'text', 'w' => 'm'],
                'site.inn'        => ['label' => 'ИНН', 'type' => 'text', 'w' => 'm'],
            ],
            'repeaters' => [[
                'path' => 'site.socials', 'label' => 'Соцсеть', 'title_field' => 'label', 'max' => 12,
                'fields' => [
                    'label' => ['label' => 'Название', 'type' => 'text', 'w' => 'm', 'hint' => 'ВКонтакте, Instagram, YouTube, Дзен, Behance.'],
                    'url'   => ['label' => 'Ссылка', 'type' => 'text', 'hint' => 'Полный адрес профиля, начиная с https://'],
                ],
            ], [
                'path' => 'site.channels', 'label' => 'Канал связи', 'title_field' => 'label', 'max' => 10,
                'fields' => [
                    'label' => ['label' => 'Название', 'type' => 'text', 'w' => 'm', 'hint' => 'Telegram, WhatsApp, ВКонтакте, MAX, Телефон.'],
                    'value' => ['label' => 'Что показывать', 'type' => 'text', 'w' => 'm', 'hint' => 'Ник, номер или надпись вроде «Написать».'],
                    'url'   => ['label' => 'Ссылка', 'type' => 'text', 'hint' => 'https://t.me/ник · https://wa.me/79991234567 · mailto:почта · tel:+79991234567'],
                ],
            ]],
        ],

        'forms' => [
            'group' => 'Настройки',
            'title' => 'Поля формы заявки',
            'desc'  => 'Одна форма на весь сайт: и во всплывающем окне, и в блоке внизу главной, и на странице контактов. Правите здесь — меняется везде.',
            'note'  => 'Очистите подпись поля — поле исчезнет с сайта. Так убирают лишние вопросы: чем короче форма, тем больше заявок. Убрать нельзя только контакт и галочку согласия — без них заявку невозможно принять по закону.',
            'fieldsets' => [
                [
                    'title'  => 'Как с вами связаться',
                    'desc'   => 'Человек сам выбирает: позвонить ему или написать в мессенджер. Оставите подпись только у одной кнопки — переключателя не будет, форма сразу покажет нужное поле.',
                    'fields' => ['forms.mode_label', 'forms.mode_call', 'forms.mode_write',
                                 'forms.label_phone', 'forms.ph_phone', 'forms.label_messenger', 'forms.err_contact'],
                ],
                [
                    'title'  => 'Необязательные поля',
                    'desc'   => 'Имя и комментарий заявку не блокируют. Если они вам не нужны — очистите подпись, и поле пропадёт из формы.',
                    'fields' => ['forms.label_name', 'forms.ph_name',
                                 'forms.label_message', 'forms.ph_message', 'forms.optional_note'],
                ],
                [
                    'title'  => 'Кнопка и согласия',
                    'desc'   => 'Галочка согласия на обработку данных обязательна по 152-ФЗ и проверяется ещё раз на сервере — убрать её из админки нельзя.',
                    'fields' => ['forms.submit', 'forms.err_agree', 'forms.agree',
                                 'forms.marketing_on', 'forms.marketing', 'forms.marketing_note'],
                ],
            ],
            'fields' => [
                'forms.mode_label'      => ['label' => 'Заголовок над выбором', 'type' => 'text', 'w' => 'm', 'hides' => 'подпись над кнопками'],
                'forms.mode_call'       => ['label' => 'Кнопка «позвонить»', 'type' => 'text', 'w' => 'm', 'hides' => 'вариант со звонком'],
                'forms.mode_write'      => ['label' => 'Кнопка «написать»', 'type' => 'text', 'w' => 'm', 'hides' => 'вариант с мессенджером'],
                'forms.label_phone'     => ['label' => 'Подпись поля телефона', 'type' => 'text', 'w' => 'm', 'hides' => 'подпись над полем'],
                'forms.ph_phone'        => ['label' => 'Серый текст в поле телефона', 'type' => 'text', 'w' => 'm', 'hint' => 'Виден, пока поле пустое. Показывайте формат номера, а не «Введите телефон».'],
                'forms.label_messenger' => ['label' => 'Подпись выбора мессенджера', 'type' => 'text', 'w' => 'm', 'hides' => 'подпись над кнопками'],
                'forms.err_contact'     => ['label' => 'Ошибка: контакт не заполнен', 'type' => 'text', 'w' => 'm', 'hint' => 'Показывается красным под полем, если человек не ввёл контакт.'],

                'forms.label_name'      => ['label' => 'Подпись поля «Имя»', 'type' => 'text', 'w' => 'm', 'hides' => 'всё поле «Имя»'],
                'forms.ph_name'         => ['label' => 'Серый текст в поле «Имя»', 'type' => 'text', 'w' => 'm', 'hint' => 'Виден, пока поле пустое.'],
                'forms.label_message'   => ['label' => 'Подпись поля «Комментарий»', 'type' => 'text', 'w' => 'm', 'hides' => 'всё поле «Комментарий»'],
                'forms.ph_message'      => ['label' => 'Серый текст в «Комментарии»', 'type' => 'text', 'w' => 'm', 'hint' => 'Виден, пока поле пустое.'],
                'forms.optional_note'   => ['label' => 'Пометка «необязательно»', 'type' => 'text', 'w' => 'm', 'hides' => 'пометку у необязательных полей'],

                'forms.submit'          => ['label' => 'Надпись на кнопке отправки', 'type' => 'text', 'w' => 'm', 'hint' => 'Оставите пустым — на кнопке будет «Отправить». Совсем убрать кнопку нельзя.'],
                'forms.err_agree'       => ['label' => 'Ошибка: нет согласия', 'type' => 'text', 'w' => 'm', 'hint' => 'Показывается, если человек не поставил обязательную галочку.'],
                'forms.agree'           => ['label' => 'Текст галочки согласия', 'type' => 'text', 'hint' => 'Кусок в [[двойных скобках]] станет ссылкой на страницу согласия. Галочка обязательна и проверяется на сервере — бот её не обойдёт.'],
                'forms.marketing_on'    => ['label' => 'Спрашивать согласие на рассылку', 'type' => 'check', 'hint' => 'Отдельная галочка, по умолчанию снятая. По ч. 1 ст. 18 закона о рекламе писать с предложениями можно только тем, кто её отметил.'],
                'forms.marketing'       => ['label' => 'Текст галочки про рассылку', 'type' => 'text', 'hides' => 'галочку про рассылку'],
                'forms.marketing_note'  => ['label' => 'Подпись под галочкой', 'type' => 'text', 'w' => 'm', 'hides' => 'подпись под галочкой'],
            ],
            'repeaters' => [[
                'path' => 'forms.messengers', 'label' => 'Мессенджер', 'title_field' => 'label', 'max' => 5,
                'fields' => [
                    'key'         => ['label' => 'Ключ', 'type' => 'text', 'w' => 'm', 'hint' => 'Латиницей: telegram, max, whatsapp. Попадает в заявку.'],
                    'label'       => ['label' => 'Название на кнопке', 'type' => 'text', 'w' => 'm'],
                    'placeholder' => ['label' => 'Подсказка в поле', 'type' => 'text'],
                ],
            ]],
        ],

        'modal' => [
            'group' => 'Настройки',
            'title' => 'Всплывающая форма заявки',
            'desc'  => 'Всплывает по кнопке «Обсудить проект» на внутренних страницах. На главной те же кнопки просто прокручивают к форме внизу.',
            'fields' => [
                'modal.kicker' => ['label' => 'Надпись сверху', 'type' => 'text', 'w' => 'm', 'hides' => 'надпись над заголовком'],
                'modal.title'  => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'modal.text'   => ['label' => 'Пояснение', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание'],
            ],
        ],

        'success' => [
            'group' => 'Настройки',
            'title' => 'Окно «Заявка отправлена»',
            'desc'  => 'Всплывает, только когда заявка действительно ушла на сервер. Закрывается кнопкой, крестиком, кликом по фону и клавишей Esc.',
            'fields' => [
                'success.title'  => ['label' => 'Заголовок', 'type' => 'text', 'hides' => 'заголовок блока'],
                'success.text'   => ['label' => 'Пояснение', 'type' => 'textarea', 'rows' => 2, 'hides' => 'описание'],
                'success.button' => ['label' => 'Кнопка', 'type' => 'text', 'w' => 'm', 'hides' => 'кнопку'],
                'success.image'  => ['label' => 'Иллюстрация', 'type' => 'image', 'hides' => 'картинку'],
            ],
        ],

        'meta' => [
            'group' => 'Настройки',
            'title' => 'SEO — страницы',
            'desc'  => 'Title — до 60 знаков, description — до 160. Именно это видно в выдаче.',
            'fields' => [
                'seo.og_image' => ['label' => 'Картинка для соцсетей по умолчанию', 'type' => 'image', 'hint' => 'Превью ссылки в Telegram, WhatsApp, ВК. Размер 1200×630.'],
                'seo.favicon'  => ['label' => 'Фавикон', 'type' => 'image', 'hint' => 'Квадратная картинка, лучше 512×512 PNG или SVG.'],

                'meta.home_title'       => ['label' => 'Главная — title', 'type' => 'text', 'limit' => 60],
                'meta.home_desc'        => ['label' => 'Главная — description', 'type' => 'textarea', 'rows' => 2, 'limit' => 160],
                'meta.home_og'          => ['label' => 'Главная — картинка для соцсетей', 'type' => 'image'],
                'meta.home_noindex'     => ['label' => 'Закрыть от индексации', 'type' => 'check'],

                'meta.work_title'       => ['label' => 'Проекты — title', 'type' => 'text', 'limit' => 60],
                'meta.work_desc'        => ['label' => 'Проекты — description', 'type' => 'textarea', 'rows' => 2, 'limit' => 160],
                'meta.work_og'          => ['label' => 'Проекты — картинка для соцсетей', 'type' => 'image'],
                'meta.work_noindex'     => ['label' => 'Закрыть от индексации', 'type' => 'check'],

                'meta.services_title'   => ['label' => 'Услуги — title', 'type' => 'text', 'limit' => 60],
                'meta.services_desc'    => ['label' => 'Услуги — description', 'type' => 'textarea', 'rows' => 2, 'limit' => 160],
                'meta.services_og'      => ['label' => 'Услуги — картинка для соцсетей', 'type' => 'image'],
                'meta.services_noindex' => ['label' => 'Закрыть от индексации', 'type' => 'check'],

                'meta.contacts_title'   => ['label' => 'Контакты — title', 'type' => 'text', 'limit' => 60],
                'meta.contacts_desc'    => ['label' => 'Контакты — description', 'type' => 'textarea', 'rows' => 2, 'limit' => 160],
                'meta.contacts_og'      => ['label' => 'Контакты — картинка для соцсетей', 'type' => 'image'],
                'meta.contacts_noindex' => ['label' => 'Закрыть от индексации', 'type' => 'check'],

                'meta.privacy_title'    => ['label' => 'Политика — title', 'type' => 'text', 'limit' => 60],
                'meta.privacy_desc'     => ['label' => 'Политика — description', 'type' => 'textarea', 'rows' => 2, 'limit' => 160],
                'meta.consent_title'    => ['label' => 'Согласие — title', 'type' => 'text', 'limit' => 60],
                'meta.consent_desc'     => ['label' => 'Согласие — description', 'type' => 'textarea', 'rows' => 2, 'limit' => 160],
            ],
        ],

        'design' => [
            'group' => 'Настройки',
            'title' => 'Дизайн',
            'desc'  => 'Пустое поле — остаётся то, что задано в стилях. Ошибочные значения игнорируются, сломать вёрстку нельзя.',
            'fields' => [
                'design.color_ink'    => ['label' => 'Основной цвет текста', 'type' => 'color', 'placeholder' => '#11131a', 'w' => 'm'],
                'design.color_paper'  => ['label' => 'Фон карточек', 'type' => 'color', 'placeholder' => '#ffffff', 'w' => 'm'],
                'design.color_accent' => ['label' => 'Акцент: кнопки и ссылки', 'type' => 'color', 'placeholder' => '#0a5cff', 'w' => 'm'],
                'design.color_bg'     => ['label' => 'Фон страницы', 'type' => 'color', 'placeholder' => '#f7f8fb', 'w' => 'm'],
                'design.width'        => ['label' => 'Ширина содержимого, px', 'type' => 'number', 'min' => 900, 'max' => 1920, 'w' => 'm'],
                'design.font_size'    => ['label' => 'Размер основного текста, px', 'type' => 'number', 'min' => 14, 'max' => 22, 'w' => 'm'],
                'design.tracking'     => ['label' => 'Межбуквенное в заголовках, em', 'type' => 'text', 'placeholder' => '-0.02', 'w' => 'm'],
            ],
        ],

        'seo' => [
            'group' => 'Настройки',
            'title' => 'SEO — общие',
            'admin_only' => true,
            'desc'  => 'Домен, robots.txt и подтверждение прав в поисковиках. Карта сайта собирается сама: /sitemap.xml',
            'fields' => [
                'seo.canonical_host' => ['label' => 'Основной адрес сайта', 'type' => 'text', 'hint' => 'Со схемой и без слэша: https://axiomantic.ru'],
                'seo.force_host'     => ['label' => 'Уводить на основной адрес', 'type' => 'check', 'hint' => 'Открыли www.axiomantic.ru или http — перебросит на адрес выше. Иначе поисковик считает их разными сайтами и делит вес пополам. Выключите, если сайт открывается ещё и по тестовому домену.'],
                'seo.title_suffix'   => ['label' => 'Приставка к title', 'type' => 'text', 'w' => 'm'],
                'seo.title_fallback' => ['label' => 'Title по умолчанию', 'type' => 'text'],
                'seo.noindex_all'    => ['label' => 'Закрыть ВЕСЬ сайт от индексации', 'type' => 'check', 'hint' => 'Только на время разработки. Не забудьте выключить.'],
                'seo.sitemap_on'     => ['label' => 'Отдавать /sitemap.xml', 'type' => 'check'],
                'seo.robots_txt'     => ['label' => 'Содержимое robots.txt', 'type' => 'textarea', 'rows' => 6],
                'seo.yandex_verify'  => ['label' => 'Яндекс.Вебмастер — код', 'type' => 'text', 'w' => 'm'],
                'seo.google_verify'  => ['label' => 'Google Search Console — код', 'type' => 'text', 'w' => 'm'],
                'seo.org_name'       => ['label' => 'Организация — название', 'type' => 'text', 'w' => 'm'],
                'seo.org_city'       => ['label' => 'Организация — город', 'type' => 'text', 'w' => 'm'],
                'seo.org_price'      => ['label' => 'Ценовой диапазон', 'type' => 'text', 'w' => 'm'],
                'seo.org_founded'    => ['label' => 'Год основания', 'type' => 'text', 'w' => 'm'],
            ],
        ],

        'legal' => [
            'group' => 'Настройки',
            'title' => 'Политика и cookie',
            'admin_only' => true,
            'desc'  => 'Политика открывается по адресу /privacy. Ссылка стоит в подвале, у чекбокса в формах и в баннере.',
            'fields' => [
                'legal.privacy_eyebrow' => ['label' => 'Надпись над заголовком', 'type' => 'text', 'w' => 'm'],
                'legal.privacy_title'   => ['label' => 'Заголовок страницы', 'type' => 'text'],
                'legal.privacy_updated' => ['label' => 'Дата редакции', 'type' => 'text', 'w' => 'm'],
                'legal.privacy_md'      => ['label' => 'Текст политики', 'type' => 'textarea', 'rows' => 24, 'hint' => 'Разметка: ## заголовок, - пункт, **жирный**, --- разделитель. HTML вставить нельзя.'],
                'legal.consent_eyebrow' => ['label' => 'Согласие: надпись над заголовком', 'type' => 'text', 'w' => 'm'],
                'legal.consent_title'   => ['label' => 'Согласие: заголовок страницы', 'type' => 'text'],
                'legal.consent_updated' => ['label' => 'Согласие: дата редакции', 'type' => 'text', 'w' => 'm'],
                'legal.consent_md'      => ['label' => 'Текст согласия на обработку', 'type' => 'textarea', 'rows' => 20, 'hint' => 'Отдельный документ по ст. 9 152-ФЗ. Открывается по адресу /consent, на него ведёт галочка в форме.'],
                'legal.policy_link'     => ['label' => 'Подпись ссылки на политику под формой', 'type' => 'text'],

                'legal.cookie_text'     => ['label' => 'Cookie — текст баннера', 'type' => 'textarea', 'rows' => 3, 'hint' => 'Кусок в [[двойных скобках]] станет ссылкой на политику.'],
                'legal.cookie_accept'   => ['label' => 'Cookie — кнопка согласия', 'type' => 'text', 'w' => 'm'],
                'legal.cookie_decline'  => ['label' => 'Cookie — кнопка отказа', 'type' => 'text', 'w' => 'm'],
            ],
        ],

        'integrations' => [
            'group' => 'Настройки',
            'title' => 'Уведомления и аналитика',
            'admin_only' => true,
            'fields' => [
                'integrations.telegram_token' => ['label' => 'Telegram — токен бота', 'type' => 'text', 'hint' => 'Создать бота у @BotFather.'],
                'integrations.telegram_chat_id' => ['label' => 'Telegram — chat_id', 'type' => 'text', 'w' => 'm', 'hint' => 'Свой id узнаете у @userinfobot.'],
                'integrations.notify_email'   => ['label' => 'Почта для заявок', 'type' => 'text', 'w' => 'm'],
                'integrations.metrika_id'     => ['label' => 'ID Яндекс.Метрики', 'type' => 'text', 'w' => 'm', 'hint' => 'Счётчик запускается только после согласия на cookie. Все цели — тип «JavaScript-событие». Идентификаторы: lead — заявка отправлена, form_open — открыта форма, form_start — начал заполнять, click_telegram, click_email, click_phone — клики по контактам, project_click — клик по кейсу, faq_open — раскрыт вопрос, scroll_25/50/75/100 — глубина прокрутки.'],
                'integrations.head_code'      => ['label' => 'Произвольный код в head', 'type' => 'textarea', 'rows' => 4],
                'integrations.body_code'      => ['label' => 'Произвольный код перед </body>', 'type' => 'textarea', 'rows' => 4],
            ],
        ],
    ];
}

/**
 * Где каждый раздел находится на сайте.
 *
 * Нужно, чтобы редактор не гадал, что он правит: в шапке раздела
 * пишется страница и место на ней, рядом — кнопка «посмотреть»,
 * которая открывает нужный блок в соседней вкладке.
 *
 * page   — адрес страницы: '' главная, 'services', 'contacts', 'projects'
 * anchor — якорь, чтобы страница открылась сразу на нужном блоке
 * where  — человеческое описание места
 * icon   — значок в меню
 */
function schema_places(): array
{
    return [
        'hero'          => ['page' => '',          'anchor' => '',          'where' => 'Главная · самый первый экран', 'icon' => '◆'],
        'comparison'    => ['page' => '',          'anchor' => '',          'where' => 'Главная · 2-й блок, сразу под первым экраном', 'icon' => '⇄'],
        'process'       => ['page' => '',          'anchor' => '',          'where' => 'Главная · 3-й блок, карточки этапов', 'icon' => '№'],
        'benefits'      => ['page' => '',          'anchor' => '',          'where' => 'Главная · 4-й блок, «узнали себя»', 'icon' => '✦'],
        'home_services' => ['page' => '',          'anchor' => 'services',  'where' => 'Главная · 5-й блок, карточки услуг', 'icon' => '▤'],
        'cta'           => ['page' => '',          'anchor' => '',          'where' => 'Повторяется на главной, в проектах и услугах', 'icon' => '☺'],
        'projects_home' => ['page' => '',          'anchor' => 'projects',  'where' => 'Главная · блок кейсов, первые три проекта', 'icon' => '▣'],
        'faq'           => ['page' => '',          'anchor' => '',          'where' => 'Главная и страница контактов', 'icon' => '?'],
        'request'       => ['page' => '',          'anchor' => 'request',   'where' => 'Главная · последний блок с формой', 'icon' => '✉'],

        'work'          => ['page' => 'projects',  'anchor' => '',          'where' => 'Страница «Проекты» целиком', 'icon' => '▣'],
        'services'      => ['page' => 'services',  'anchor' => '',          'where' => 'Страница «Услуги» целиком', 'icon' => '▤'],
        'contacts'      => ['page' => 'contacts',  'anchor' => '',          'where' => 'Страница «Контакты» — только заголовки', 'icon' => '✆'],
        'error404'      => ['page' => 'stranica-kotoroy-net', 'anchor' => '', 'where' => 'Страница, которая открывается по несуществующему адресу', 'icon' => '⚠'],

        'site'          => ['page' => '',          'anchor' => '',          'where' => 'Шапка и подвал на всех страницах', 'icon' => '⌂'],
        'forms'         => ['page' => 'contacts',  'anchor' => 'request',   'where' => 'Все формы заявки на сайте', 'icon' => '✎'],
        'modal'         => ['page' => 'services',  'anchor' => '',          'where' => 'Окно, всплывающее по кнопке «Обсудить проект»', 'icon' => '▢'],
        'success'       => ['page' => '',          'anchor' => '',          'where' => 'Окно после успешной отправки заявки', 'icon' => '✔'],
        'legal'         => ['page' => 'privacy',   'anchor' => '',          'where' => 'Страницы политики и согласия, баннер про cookie', 'icon' => '§'],

        'meta'          => ['page' => '',          'anchor' => '',          'where' => 'Не видно на сайте — это подписи в поисковой выдаче', 'icon' => '⌕'],
        'seo'           => ['page' => '',          'anchor' => '',          'where' => 'Служебное: адрес сайта, robots.txt, коды поисковиков', 'icon' => '⚙'],
        'design'        => ['page' => '',          'anchor' => '',          'where' => 'Цвета и размеры на всём сайте', 'icon' => '◐'],
        'integrations'  => ['page' => '',          'anchor' => '',          'where' => 'Служебное: куда падают заявки и какой счётчик стоит', 'icon' => '⚡'],
    ];
}

/** Данные о месте раздела с запасными значениями. */
function schema_place(string $key): array
{
    $all = schema_places();
    return ($all[$key] ?? []) + ['page' => '', 'anchor' => '', 'where' => '', 'icon' => '•'];
}

function schema_groups(): array
{
    $groups = [];
    foreach (schema() as $key => $sec) {
        $groups[$sec['group']][$key] = $sec['title'];
    }
    return $groups;
}
