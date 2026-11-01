import { useEffect, useId, useRef, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { PreviewLabels } from '../../types';

export interface PasswordPromptProps {
  request: { incorrect: boolean; submit: (password: string) => void; cancel: () => void };
  labels: PreviewLabels;
  documentName: string;
}

/** Accessible password form for encrypted PDFs. */
export function PasswordPrompt({ request, labels, documentName }: PasswordPromptProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Focus on open and after each incorrect attempt (a new request object).
  useEffect(() => {
    inputRef.current?.focus();
  }, [request]);

  return (
    <div className="dsc-state dsc-password" role="group" aria-labelledby={`${id}-title`}>
      <div className="dsc-state-icon">
        <LockKeyhole aria-hidden="true" />
      </div>
      <h3 className="dsc-state-title" id={`${id}-title`}>
        {labels.passwordTitle}
      </h3>
      <p className="dsc-state-message" id={`${id}-desc`}>
        <span className="dsc-password-name">{documentName}</span>
        {labels.passwordPrompt}
      </p>
      <form
        className="dsc-password-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value) return;
          const password = value;
          setValue('');
          request.submit(password);
        }}
      >
        <label className="dsc-visually-hidden" htmlFor={`${id}-input`}>
          {labels.password}
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="dsc-password-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={labels.password}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={request.incorrect || undefined}
          aria-describedby={request.incorrect ? `${id}-error` : `${id}-desc`}
        />
        {request.incorrect && (
          <p className="dsc-password-error" id={`${id}-error`} role="alert">
            {labels.passwordIncorrect}
          </p>
        )}
        <div className="dsc-state-actions">
          <button
            type="button"
            className="dsc-action dsc-action--secondary"
            onClick={request.cancel}
          >
            {labels.cancel}
          </button>
          <button type="submit" className="dsc-action" disabled={!value}>
            {labels.unlock}
          </button>
        </div>
      </form>
    </div>
  );
}
