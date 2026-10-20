import { tick } from 'svelte';
import { ApiError } from './api';
import { describeError, type ErrorSummary } from './errors';
import { t, tryT } from './i18n';
import { hasErrors, serverFieldErrors, validationMessage, type FieldErrors } from './validation';

export interface SubmitOptions {
  /** Client-side checks, run first (field → code). */
  readonly validate?: () => FieldErrors;
  /** Server field name → form field name. */
  readonly rename?: Readonly<Record<string, string>>;
  /** Form element: the first invalid field receives the focus. */
  readonly form?: HTMLFormElement | null | undefined;
}

/**
 * State of a form submission: client validation, then the server call; a 422
 * validation_failed answer is mapped to the fields, other errors to a form-level message
 * (with the request id and, for 429, the waiting time).
 */
export class FormState {
  errors = $state.raw<FieldErrors>({});
  failure = $state.raw<ErrorSummary | null>(null);
  submitting = $state(false);

  /** Translated message of a field error, or null. */
  message(field: string): string | null {
    const code = this.errors[field];
    return code === undefined ? null : validationMessage(field, code, t, tryT);
  }

  reset(): void {
    this.errors = {};
    this.failure = null;
  }

  /** Runs `action` when the client checks pass. Returns true on success. */
  async submit(action: () => Promise<unknown>, options: SubmitOptions = {}): Promise<boolean> {
    if (this.submitting) return false;
    this.failure = null;
    const clientErrors = options.validate?.() ?? {};
    this.errors = clientErrors;
    if (hasErrors(clientErrors)) {
      focusFirstInvalid(options.form);
      return false;
    }
    this.submitting = true;
    try {
      await action();
      return true;
    } catch (error) {
      const fields = serverFieldErrors(error, options.rename);
      this.errors = fields;
      if (hasErrors(fields)) {
        focusFirstInvalid(options.form);
        // Errors on fields that the form does not show are reported globally.
        if (error instanceof ApiError && !fieldsVisible(options.form, fields)) {
          this.failure = describeError(error, t);
        }
      } else {
        this.failure = describeError(error, t);
      }
      return false;
    } finally {
      this.submitting = false;
    }
  }
}

function focusFirstInvalid(form: HTMLFormElement | null | undefined): void {
  if (!form) return;
  void tick().then(() => {
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

function fieldsVisible(form: HTMLFormElement | null | undefined, fields: FieldErrors): boolean {
  if (!form) return true;
  return Object.keys(fields).every((name) => form.querySelector(`[name="${CSS.escape(name)}"]`));
}
