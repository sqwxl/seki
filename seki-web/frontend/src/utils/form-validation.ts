function enhanceForm(form: HTMLFormElement) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors(form);

    const body = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      body.append(key, String(value));
    });

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.redirect) {
          window.location.href = data.redirect;
        }
      } else if (response.status === 422) {
        const data = await response.json();
        showError(form, data.field, data.error);
      }
    } catch {
      showError(form, undefined, "Something went wrong. Please try again.");
    }
  });
}

function showError(
  form: HTMLFormElement,
  field: string | undefined,
  message: string,
) {
  if (field) {
    const input = form.querySelector<HTMLInputElement>(`[name="${field}"]`);
    if (input) {
      const error = document.createElement("span");
      error.className = "field-error";
      error.textContent = message;
      input.parentElement?.appendChild(error);
      input.addEventListener("input", () => error.remove(), { once: true });
      return;
    }
  }
  // Fallback for errors without a field (e.g. login)
  const submit = form.querySelector("button[type='submit']");
  if (submit) {
    const error = document.createElement("div");
    error.className = "field-error";
    error.textContent = message;
    submit.parentElement?.insertBefore(error, submit);
  }
}

function clearErrors(form: HTMLFormElement) {
  form.querySelectorAll(".field-error").forEach((el) => el.remove());
}

export function initFormValidation() {
  const forms =
    document.querySelectorAll<HTMLFormElement>("form[data-validate]");
  for (const form of forms) {
    enhanceForm(form);
  }
}
