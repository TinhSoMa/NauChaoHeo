/**
 * SettingsOverview - Grid hien thi cac menu items
 */

import { ChevronRight } from 'lucide-react';
import styles from './Settings.module.css';
import { SettingsMenuItem, SettingsTab } from './types';

interface SettingsOverviewProps {
  menuItems: SettingsMenuItem[];
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsOverview({ menuItems, onTabChange }: SettingsOverviewProps) {
  return (
    <div className={styles.overviewContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>Cài đặt</div>
        <div className={styles.pageDesc}>Quản lý tất cả cấu hình của ứng dụng tại đây</div>
      </div>
      
      <div className={styles.grid}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <div 
              key={item.id} 
              className={styles.card}
              onClick={() => onTabChange(item.id)}
            >
              <div className={styles.cardIcon}>
                <Icon size={24} />
              </div>
              <div>
                <div className={styles.cardTitle}>{item.label}</div>
                <div className={styles.cardDesc}>{item.desc}</div>
              </div>
              <div style={{ marginTop: 'auto', alignSelf: 'flex-end', color: 'var(--color-text-tertiary)' }}>
                <ChevronRight size={16} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
