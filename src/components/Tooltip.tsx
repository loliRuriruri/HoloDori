import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { useI18n, TooltipItem } from '../i18n';

interface TooltipProps {
  contentKey?: string;
  item?: TooltipItem;
  title?: string;
  body?: string;
  shortcut?: string;
  note?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delayMs?: number;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  contentKey,
  item,
  title,
  body,
  shortcut,
  note,
  placement = 'top',
  delayMs = 450,
  disabled = false,
  children,
  className = '',
}) => {
  const { tooltip: getTooltip } = useI18n();
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const timerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Resolve content: explicit props > item > contentKey
  const resolved: TooltipItem | undefined = item || (contentKey ? getTooltip(contentKey) : undefined) || (
    title && body ? { title, body, shortcut, note } : undefined
  );

  const finalTitle = title || resolved?.title;
  const finalBody = body || resolved?.body;
  const finalShortcut = shortcut || resolved?.shortcut;
  const finalNote = note || resolved?.note;

  const hasContent = Boolean(finalTitle || finalBody);

  const show = () => {
    if (disabled || !hasContent) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        let top = 0;
        let left = 0;

        if (placement === 'top') {
          top = rect.top - 8;
          left = rect.left + rect.width / 2;
        } else if (placement === 'bottom') {
          top = rect.bottom + 8;
          left = rect.left + rect.width / 2;
        } else if (placement === 'left') {
          top = rect.top + rect.height / 2;
          left = rect.left - 8;
        } else {
          top = rect.top + rect.height / 2;
          left = rect.right + 8;
        }

        setCoords({ top, left });
        setIsVisible(true);
      }
    }, delayMs);
  };

  const hide = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      className={`hdm-tooltip-trigger ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={hide}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {isVisible && hasContent && (
        <div
          ref={tooltipRef}
          className={`hdm-tooltip-box placement-${placement}`}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 99999,
            pointerEvents: 'none',
          }}
          role="tooltip"
        >
          <div className="hdm-tooltip-header">
            {finalTitle && <span className="hdm-tooltip-title">{finalTitle}</span>}
            {finalShortcut && <span className="hdm-tooltip-shortcut">{finalShortcut}</span>}
          </div>
          {finalBody && <div className="hdm-tooltip-body">{finalBody}</div>}
          {finalNote && <div className="hdm-tooltip-note">💡 {finalNote}</div>}
        </div>
      )}
    </div>
  );
};
