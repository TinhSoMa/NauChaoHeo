import React from 'react';
import { Check } from 'lucide-react';
import styles from './Checkbox.module.css';

interface CheckboxProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  highlight?: boolean; 
}

export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className = '',
  highlight = false
}) => {
  return (
    <div 
      className={`
        ${styles.wrapper} 
        ${checked ? styles.wrapperSelected : ''} 
        ${disabled ? styles.wrapperDisabled : ''} 
        ${className}
      `}
      onClick={() => !disabled && onChange(!checked)}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={styles.checkboxInput}
      />
      <div className={styles.indicator}>
        <Check size={12} strokeWidth={3} className={styles.checkmark} />
      </div>
      <div className={styles.content}>
        <span className={`${styles.label} ${highlight ? styles.labelHighlight : ''}`}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </div>
    </div>
  );
};
