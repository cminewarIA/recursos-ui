import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export const COCKPIT_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 32,
  mass: 0.82,
};

export const COCKPIT_PILL_SPRING = {
  type: 'spring' as const,
  stiffness: 460,
  damping: 35,
  mass: 0.72,
};

export const COCKPIT_EASE = [0.22, 1, 0.36, 1] as const;

interface MorphPillProps {
  layoutId: string;
  className?: string;
}

/**
 * Cápsula activa animada mediante layoutId compartido (Framer Motion / motion v12).
 * Se desliza con física de resorte real entre pestañas y barras segmentadas.
 */
export const MorphPill: React.FC<MorphPillProps> = ({ layoutId, className = '' }) => {
  return (
    <motion.span
      layoutId={layoutId}
      transition={COCKPIT_PILL_SPRING}
      aria-hidden="true"
      className={`cockpit-tab-active pointer-events-none absolute inset-0 -z-0 ${className}`}
    />
  );
};

interface AnimatedMetricValueProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  formatFn?: (val: number) => string;
}

/**
 * Contador numérico animado de alto rendimiento (60 FPS sin re-renderizados React por cuadro).
 */
export const AnimatedMetricValue: React.FC<AnimatedMetricValueProps> = ({
  value,
  decimals = 1,
  prefix = '',
  suffix = '',
  className = '',
  formatFn,
}) => {
  const prefersReduced = useReducedMotion();
  const safeVal = Number.isFinite(value) ? value : 0;
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const currentRef = useRef<number>(safeVal);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const renderNum = (v: number) => {
      if (formatFn) return `${prefix}${formatFn(v)}${suffix}`;
      return `${prefix}${v.toFixed(decimals)}${suffix}`;
    };

    if (prefersReduced || Math.abs(safeVal - currentRef.current) < 0.0005) {
      currentRef.current = safeVal;
      el.textContent = renderNum(safeVal);
      return;
    }

    const startVal = currentRef.current;
    const delta = safeVal - startVal;
    const startTime = performance.now();
    const duration = 520;
    let rafId = 0;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startVal + delta * eased;
      currentRef.current = next;
      el.textContent = renderNum(next);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        currentRef.current = safeVal;
        el.textContent = renderNum(safeVal);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [safeVal, decimals, prefix, suffix, prefersReduced, formatFn]);

  return (
    <span ref={spanRef} className={`tabular-nums ${className}`}>
      {formatFn ? `${prefix}${formatFn(safeVal)}${suffix}` : `${prefix}${safeVal.toFixed(decimals)}${suffix}`}
    </span>
  );
};

interface BentoCardProps {
  children: React.ReactNode;
  className?: string;
  index?: number;
  hoverLift?: boolean;
  onClick?: () => void;
}

/**
 * Tarjeta Bento con entrada escalonada en resorte y micro-elevación interactiva.
 */
export const BentoCard: React.FC<BentoCardProps> = ({
  children,
  className = '',
  index = 0,
  hoverLift = false,
  onClick,
}) => {
  const prefersReduced = useReducedMotion();
  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 14, scale: 0.988 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.42,
        delay: prefersReduced ? 0 : Math.min(index * 0.045, 0.36),
        ease: COCKPIT_EASE,
      }}
      whileHover={hoverLift && !prefersReduced ? { y: -2, transition: { duration: 0.18 } } : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={className}
    >
      {children}
    </motion.section>
  );
};

interface ViewStageProps {
  tabKey: string;
  children: React.ReactNode;
}

/**
 * Escenario animado para transiciones fluidas entre vistas principales y subpestañas.
 */
export const ViewStage: React.FC<ViewStageProps> = ({ tabKey, children }) => {
  const prefersReduced = useReducedMotion();
  return (
    <div className="relative overflow-x-clip">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={tabKey}
          initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.996 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0, y: -6, scale: 0.996, transition: { duration: 0.2, ease: COCKPIT_EASE } }}
          transition={{ duration: 0.28, ease: COCKPIT_EASE }}
          className="w-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

interface AccordionBodyProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Contenedor colapsable con transición elástica real de altura + opacidad.
 */
export const AccordionBody: React.FC<AccordionBodyProps> = ({ open, children, className = '' }) => {
  const prefersReduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={prefersReduced ? undefined : { opacity: 0, height: 0, y: -4 }}
          transition={{ duration: 0.28, ease: COCKPIT_EASE }}
          className={`overflow-hidden ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

