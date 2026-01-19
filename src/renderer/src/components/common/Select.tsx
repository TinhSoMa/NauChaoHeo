import React from 'react';
import styles from './Select.module.css';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  options?: SelectOption[];
  error?: boolean;
  variant?: 'normal' | 'small';
  containerClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { 
      label, 
      helperText, 
      options = [], 
      error, 
      variant = 'normal', 
      containerClassName = '', 
      className = '', 
      children,
      ...props 
    }, 
    ref
  ) => {
    const variantClass = variant === 'small' ? styles.small : '';
    const errorClass = error ? styles.error : '';

    return (
      <div className={`${styles.wrapper} ${containerClassName}`}>
        {label && <label className={styles.label}>{label}</label>}
        <select
          ref={ref}
          className={`${styles.select} ${variantClass} ${errorClass} ${className}`}
          {...props}
        >
          {children}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {helperText && <span className={styles.helperText}>{helperText}</span>}
      </div>
    );
  }
);

Select.displayName = 'Select';
