import { InputHTMLAttributes, forwardRef, useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="field">
        {label && <label className="field-label" htmlFor={inputId}>{label}</label>}
        <input
          ref={ref}
          id={inputId}
          className={`field-input ${error ? 'field-input--error' : ''} ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...props}
        />
        {error && <span className="field-error" id={errorId}>{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
