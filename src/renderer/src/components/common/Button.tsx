import React from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  iconOnly?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { 
      variant = 'primary', 
      size = 'md',
      fullWidth = false, 
      iconOnly = false,
      className = '', 
      children, 
      ...props 
    }, 
    ref
  ) => {
    const variantClass = styles[variant];
    const sizeClass = size === 'sm' ? styles.sm : '';
    const widthClass = fullWidth ? styles.fullWidth : '';
    const iconClass = iconOnly ? styles.iconOnly : '';
    
    return (
      <button
        ref={ref}
        className={`${styles.button} ${variantClass} ${sizeClass} ${widthClass} ${iconClass} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
