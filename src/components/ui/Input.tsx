import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="field">
        {label && <label className="field-label">{label}</label>}
        <input ref={ref} className={`field-input ${error ? 'field-input--error' : ''} ${className}`} {...props} />
        {error && <span className="field-error">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
