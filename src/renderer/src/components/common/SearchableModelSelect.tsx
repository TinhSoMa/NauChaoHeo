import { createPortal } from 'react-dom';
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import styles from './SearchableModelSelect.module.css';

interface ModelOption {
  id: string;
  label: string;
}

interface SearchableModelSelectProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  models: ModelOption[];
  value: string;
  onChange: (value: string) => void;
  searchPlaceholder: string;
  minSearchableOptions?: number;
  popoverClassName?: string;
}

function matchesModelSearch(model: ModelOption, query: string): boolean {
  const haystack = `${model.id}\n${model.label}`.toLowerCase();
  return haystack.includes(query);
}

export const SearchableModelSelect = forwardRef<
  HTMLButtonElement,
  SearchableModelSelectProps
>(function SearchableModelSelect(
  {
    models,
    value,
    onChange,
    searchPlaceholder,
    minSearchableOptions = 8,
    popoverClassName,
    className,
    ...buttonProps
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popoverStyle, setPopoverStyle] = useState<({ left: number; width: number; maxHeight: number } & ({ top: number; bottom?: never } | { bottom: number; top?: never })) | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useMemo(
    () => `model-picker-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );
  const allOptions = useMemo(() => {
    if (models.length === 0) return models;
    return [{ id: '', label: 'Mặc định (theo agent)' }, ...models];
  }, [models]);
  const selectedOption = allOptions.find((option) => option.id === value) ?? allOptions[0] ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return allOptions;
    return allOptions.filter((option) => matchesModelSearch(option, normalizedQuery));
  }, [allOptions, normalizedQuery]);
  const shouldShowSearch = allOptions.length >= minSearchableOptions;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handlePopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect =
        buttonRef.current?.getBoundingClientRect() ??
        wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = typeof window === 'undefined' ? rect.width : window.innerWidth;
      const viewportHeight = typeof window === 'undefined' ? rect.height : window.innerHeight;
      const desiredWidth = Math.max(rect.width, 0);
      const maxWidth = Math.max(160, viewportWidth - 16);
      const width = Math.min(desiredWidth, maxWidth);
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, viewportWidth - width - 8),
      );
      const availableBelow = Math.max(140, viewportHeight - rect.bottom - 12);
      const availableAbove = Math.max(140, rect.top - 12);
      const shouldOpenUpward = availableBelow < 260 && availableAbove > availableBelow;
      const maxHeight = Math.min(360, shouldOpenUpward ? availableAbove : availableBelow);
      if (shouldOpenUpward) {
        setPopoverStyle({
          bottom: Math.max(8, viewportHeight - rect.top + 6),
          left,
          width,
          maxHeight,
        });
        return;
      }
      setPopoverStyle({
        top: rect.bottom + 6,
        left,
        width,
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !shouldShowSearch) return;
    searchRef.current?.focus();
  }, [open, shouldShowSearch]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <div className={`${styles.wrapper}${open ? ` ${styles.open}` : ''}`} ref={wrapRef}>
      <button
        {...buttonProps}
        ref={(node) => {
          buttonRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        className={`${styles.button}${className ? ` ${className}` : ''}`}
        onClick={(event) => {
          buttonProps.onClick?.(event);
          if (!event.defaultPrevented) setOpen((prev) => !prev);
        }}
      >
        {selectedOption?.label ?? ''}
      </button>
      {open && popoverStyle
        ? createPortal(
            <div
              ref={popoverRef}
              className={`${styles.popover}${popoverClassName ? ` ${popoverClassName}` : ''}`}
              role="presentation"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={handlePopoverKeyDown}
              style={{
                position: 'fixed',
                top: popoverStyle.top != null ? `${popoverStyle.top}px` : 'auto',
                bottom: popoverStyle.bottom != null ? `${popoverStyle.bottom}px` : 'auto',
                left: `${popoverStyle.left}px`,
                width: `${popoverStyle.width}px`,
                maxHeight: `${popoverStyle.maxHeight}px`,
              }}
            >
              {shouldShowSearch ? (
                <div className={styles.searchRow}>
                  <input
                    ref={searchRef}
                    type="search"
                    className={styles.searchInput}
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              ) : null}
              <div
                className={styles.list}
                id={listboxId}
                role="listbox"
                style={{
                  maxHeight: `${Math.max(96, popoverStyle.maxHeight - (shouldShowSearch ? 52 : 12))}px`,
                }}
              >
                {filteredOptions.map((option) => {
                  const active = option.id === value;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`${styles.option}${active ? ` ${styles.optionActive}` : ''}`}
                      data-selected={active ? 'true' : undefined}
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                    >
                      <span className={styles.optionLabel}>{option.label}</span>
                    </button>
                  );
                })}
                {filteredOptions.length === 0 ? (
                  <div className={styles.empty}>No matching models</div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
