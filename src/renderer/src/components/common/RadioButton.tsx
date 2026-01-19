import React from 'react';
import styles from './RadioButton.module.css';

interface RadioButtonProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  name?: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode; 
}

export const RadioButton: React.FC<RadioButtonProps> = ({
  label,
  description,
  checked,
  onChange,
  name,
  disabled = false,
  className = '',
  children
}) => {
  return (
    <div 
      className={`
        ${styles.wrapper} 
        ${checked ? styles.wrapperSelected : ''} 
        ${disabled ? styles.disabled : ''} 
        ${className}
      `}
      onClick={!disabled ? onChange : undefined}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={styles.radioInput}
      />
      <div className={styles.indicator}>
        <div className={styles.dot} />
      </div>
      <div className={styles.content}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
        {children}
      </div>
    </div>
  );
};
