<div
      class="ax-success-modal"
      id="application-success-modal"
      aria-hidden="true"
    >
      <section
        class="ax-success-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-success-title"
        aria-describedby="application-success-text"
      >
        <button
          class="ax-success-close"
          type="button"
          aria-label="Закрыть окно"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <div class="ax-success-art">
          <img
            src="<?= url(c('success.image')) ?>"
            alt="Персонаж Axiomantic показывает жест класс"
          />
        </div>
        <div class="ax-success-content">
          <span class="ax-success-mark" aria-hidden="true"
            ><svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m5 12 4 4L19 6" /></svg
          ></span>
          <h2 id="application-success-title"><?= e(c('success.title')) ?></h2>
          <p id="application-success-text"><?= e(c('success.text')) ?></p>
          <button class="ax-success-ok" type="button"><?= e(c('success.button')) ?></button>
        </div>
      </section>
    </div>
