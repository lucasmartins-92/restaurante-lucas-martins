document.addEventListener('DOMContentLoaded', () => {
    const advanceForms = document.querySelectorAll('[data-advance-form]');

    advanceForms.forEach(form => {
        form.addEventListener('submit', event => {
            const button = form.querySelector('[data-advance-button]');
            if (!button) {
                return;
            }

            button.disabled = true;
            button.dataset.originalLabel = button.textContent || 'Avançar status';
            button.textContent = 'Avançando...';
        });
    });
});
