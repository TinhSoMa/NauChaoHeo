import React from 'react';
import styles from './Input.module.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: boolean;
  variant?: 'normal' | 'small';
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { 
      label, 
      helperText, 
      error, 
      variant = 'normal', 
      containerClassName = '', 
      className = '', 
      ...props 
    }, 
    ref
  ) => {
    const variantClass = variant === 'small' ? styles.small : '';
    const errorClass = error ? styles.error : '';

    return (
      <div className={`${styles.inputWrapper} ${containerClassName}`}>
        {label && <label className={styles.label}>{label}</label>}
        <input
          ref={ref}
          className={`${styles.input} ${variantClass} ${errorClass} ${className}`}
          {...props}
        />
        {helperText && (
          <span className={`${styles.helperText} ${error ? styles.errorText : ''}`}>
            {helperText}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
