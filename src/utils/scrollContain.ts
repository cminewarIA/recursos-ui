/**
 * Universal elastic "jelly" physics + strict modal/popover scroll containment
 * for the entire Cockpit application.
 *
 * Covers:
 * - Main viewport scrolling, wheel, touch, keyboard, and window scrollbar edge bounce
 * - Every scrollable inner panel/table/dropdown/modal/Leaflet popup (vertical & horizontal)
 * - Strict overscroll containment on modals & popovers (never leaks to background page)
 * - Tactile GPU-composited squash-and-stretch ("efecto gelatina") across buttons,
 *   cards, tabs, dock items, pills, toggles, sliders, and interactive tiles.
 */

interface JellyState {
  anim: Animation | null;
  lastAt: number;
  lastIntensity: 'edge' | 'move' | 'tap' | 'press' | 'hover';
}

const jellyMap = new WeakMap<HTMLElement, JellyState>();

const INTERACTIVE_JELLY_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '.cockpit-subtab-btn',
  '.cockpit-subtile',
  '.cockpit-bento',
  '.cockpit-hero',
  '.cockpit-dock',
  '.cockpit-topbar',
  '.cockpit-segmented',
  '.cockpit-pill-cyan',
  '.cockpit-pill-emerald',
  '.cockpit-pill-violet',
  '.cockpit-pill-amber',
  '.cockpit-pill-red',
  '.leaflet-control-zoom a',
  '.leaflet-popup-close-button',
].join(', ');

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  if (document.documentElement.getAttribute('data-paused') === 'true') return true;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function getMainStage(): HTMLElement | null {
  return (
    (document.querySelector('[data-cockpit-jelly-stage="true"]') as HTMLElement | null) ??
    (document.querySelector('main') as HTMLElement | null)
  );
}

function cancelExistingAnim(prev: JellyState | undefined): void {
  if (prev?.anim && prev.anim.playState === 'running') {
    try {
      prev.anim.cancel();
    } catch {
      // Ignore Web Animations cancellation errors
    }
  }
}

function resolveScrollJellyTarget(rawEl: HTMLElement | null): HTMLElement | null {
  if (!rawEl) return null;
  if (
    rawEl === document.body ||
    rawEl === document.documentElement ||
    rawEl.hasAttribute('data-cockpit-jelly-stage')
  ) {
    return getMainStage();
  }
  const modal = rawEl.closest('[aria-modal="true"]') as HTMLElement | null;
  if (modal) return modal;
  const containCard = rawEl.closest(
    '[data-cockpit-scroll-contain="true"].cockpit-bento'
  ) as HTMLElement | null;
  if (containCard) return containCard;
  const leafletPopup = rawEl.closest('.leaflet-popup-content-wrapper') as HTMLElement | null;
  if (leafletPopup) return leafletPopup;
  return rawEl;
}

function runStageCompanionDockJelly(direction: 'up' | 'down', intensity: 'edge' | 'move'): void {
  const dock = document.querySelector('.cockpit-dock') as HTMLElement | null;
  if (!dock || typeof dock.animate !== 'function') return;
  const now = performance.now();
  const prev = jellyMap.get(dock);
  const prevRunning = Boolean(prev?.anim && prev.anim.playState === 'running');
  if (prev) {
    if (intensity === 'move' && (prevRunning || now - prev.lastAt < 230)) return;
    if (intensity === 'edge' && prev.lastIntensity === 'edge' && now - prev.lastAt < 200) return;
    if (intensity === 'edge') cancelExistingAnim(prev);
  }
  const dir = direction === 'down' ? 1 : -1;
  const shift = intensity === 'edge' ? 6 : 2.5;
  const sx = intensity === 'edge' ? 1.032 : 1.012;
  const sy = intensity === 'edge' ? 0.935 : 0.975;
  const anim = dock.animate(
    [
      { translate: '0 0', scale: '1 1', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      { translate: `0 ${dir * shift}px`, scale: `${sx} ${sy}`, offset: 0.25, easing: 'ease-in-out' },
      { translate: `0 ${dir * -shift * 0.45}px`, scale: '0.986 1.022', offset: 0.56, easing: 'ease-in-out' },
      { translate: '0 0', scale: '1 1' },
    ],
    {
      id: 'cockpit-dock-jelly',
      duration: intensity === 'edge' ? 420 : 250,
      easing: 'linear',
      fill: 'none',
    }
  );
  jellyMap.set(dock, { anim, lastAt: now, lastIntensity: intensity });
}

export function triggerScrollJelly(
  rawEl: HTMLElement | null,
  direction: 'up' | 'down' | 'left' | 'right',
  intensity: 'edge' | 'move' = 'edge',
  axis: 'y' | 'x' = 'y'
): void {
  if (prefersReducedMotion()) return;
  const el = resolveScrollJellyTarget(rawEl);
  if (!el || typeof el.animate !== 'function') return;

  const isMainStage = el.hasAttribute('data-cockpit-jelly-stage') || el.tagName === 'MAIN';
  const now = performance.now();
  const prev = jellyMap.get(el);
  const prevRunning = Boolean(prev?.anim && prev.anim.playState === 'running');

  if (prev) {
    if (intensity === 'move') {
      if (prevRunning) return;
      if (prev.lastIntensity === 'edge' && now - prev.lastAt < 440) return;
      if (now - prev.lastAt < 210) return;
    } else {
      if (prev.lastIntensity === 'edge' && now - prev.lastAt < 190) return;
      cancelExistingAnim(prev);
    }
  }

  const dir = direction === 'down' || direction === 'right' ? 1 : -1;

  if (axis === 'x') {
    el.style.transformOrigin = direction === 'right' ? '86% 50%' : '14% 50%';
    const shift = intensity === 'edge' ? (isMainStage ? 9 : 13) : 5;
    const keyframes: Keyframe[] =
      intensity === 'edge'
        ? [
            { translate: '0 0', scale: '1 1', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
            { translate: `${dir * shift}px 0`, scale: '0.962 1.024', offset: 0.24, easing: 'ease-in-out' },
            { translate: `${dir * -shift * 0.48}px 0`, scale: '1.018 0.988', offset: 0.52, easing: 'ease-in-out' },
            { translate: `${dir * shift * 0.22}px 0`, scale: '0.993 1.006', offset: 0.76, easing: 'ease-in-out' },
            { translate: '0 0', scale: '1 1' },
          ]
        : [
            { translate: '0 0', scale: '1 1', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
            { translate: `${dir * shift}px 0`, scale: '0.986 1.01', offset: 0.35, easing: 'ease-in-out' },
            { translate: `${dir * -shift * 0.35}px 0`, scale: '1.006 0.996', offset: 0.72, easing: 'ease-out' },
            { translate: '0 0', scale: '1 1' },
          ];
    const anim = el.animate(keyframes, {
      id: 'cockpit-scroll-jelly',
      duration: intensity === 'edge' ? 460 : 270,
      easing: 'linear',
      fill: 'none',
    });
    jellyMap.set(el, { anim, lastAt: now, lastIntensity: intensity });
    return;
  }

  el.style.transformOrigin = direction === 'down' ? '50% 84%' : '50% 16%';
  // For the full-width main stage, keep horizontal scale <= 1.009 so it never induces horizontal overflow
  const shift = intensity === 'edge' ? (isMainStage ? 12 : 15) : isMainStage ? 5 : 6;
  const sx1 = intensity === 'edge' ? (isMainStage ? 1.009 : 1.028) : isMainStage ? 1.004 : 1.012;
  const sy1 = intensity === 'edge' ? (isMainStage ? 0.976 : 0.952) : isMainStage ? 0.988 : 0.982;
  const sx2 = intensity === 'edge' ? (isMainStage ? 0.995 : 0.985) : isMainStage ? 0.998 : 0.994;
  const sy2 = intensity === 'edge' ? (isMainStage ? 1.014 : 1.024) : isMainStage ? 1.006 : 1.008;

  const keyframes: Keyframe[] =
    intensity === 'edge'
      ? [
          {
            translate: '0 0',
            scale: '1 1',
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
          {
            translate: `0 ${dir * shift}px`,
            scale: `${sx1} ${sy1}`,
            offset: 0.22,
            easing: 'ease-in-out',
          },
          {
            translate: `0 ${dir * -shift * 0.5}px`,
            scale: `${sx2} ${sy2}`,
            offset: 0.48,
            easing: 'ease-in-out',
          },
          {
            translate: `0 ${dir * shift * 0.24}px`,
            scale: `${isMainStage ? 1.003 : 1.009} ${isMainStage ? 0.995 : 0.99}`,
            offset: 0.72,
            easing: 'ease-in-out',
          },
          {
            translate: `0 ${dir * -1}px`,
            scale: '0.998 1.003',
            offset: 0.88,
            easing: 'ease-out',
          },
          { translate: '0 0', scale: '1 1' },
        ]
      : [
          {
            translate: '0 0',
            scale: '1 1',
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
          {
            translate: `0 ${dir * shift}px`,
            scale: `${sx1} ${sy1}`,
            offset: 0.34,
            easing: 'ease-in-out',
          },
          {
            translate: `0 ${dir * -shift * 0.38}px`,
            scale: `${sx2} ${sy2}`,
            offset: 0.7,
            easing: 'ease-out',
          },
          { translate: '0 0', scale: '1 1' },
        ];

  const anim = el.animate(keyframes, {
    id: 'cockpit-scroll-jelly',
    duration: intensity === 'edge' ? 480 : 280,
    easing: 'linear',
    fill: 'none',
  });

  jellyMap.set(el, { anim, lastAt: now, lastIntensity: intensity });

  if (isMainStage) {
    runStageCompanionDockJelly(direction === 'down' ? 'down' : 'up', intensity);
  }
}

function isElementEligibleForJelly(el: HTMLElement | null): el is HTMLElement {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el.hasAttribute('data-cockpit-no-jelly')) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.matches('input, textarea, select, canvas, svg')) return false;
  // Never distort Leaflet map canvas/tiles/markers during pan
  if (
    el.closest('.leaflet-container') &&
    !el.closest('.leaflet-popup-content-wrapper') &&
    !el.closest('.leaflet-control-zoom')
  ) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 12 || rect.height < 12) return false;
  // Skip giant full-viewport shells (handled by main stage scroll jelly instead)
  if (rect.width > window.innerWidth * 0.94 && rect.height > window.innerHeight * 0.9) return false;
  return true;
}

function resolveInteractiveJellyTarget(rawTarget: HTMLElement | null): HTMLElement | null {
  if (!rawTarget) return null;
  // Do not wobble containers when interacting directly inside text fields or canvases
  if (rawTarget.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, canvas')) {
    return null;
  }
  const match = rawTarget.closest(INTERACTIVE_JELLY_SELECTOR) as HTMLElement | null;
  if (!isElementEligibleForJelly(match)) return null;
  return match;
}

export function triggerElementJelly(
  rawEl: HTMLElement | null,
  strength: 'tap' | 'press' | 'hover' = 'tap',
  clientX?: number,
  clientY?: number
): void {
  if (prefersReducedMotion()) return;
  const el = resolveInteractiveJellyTarget(rawEl);
  if (!el || typeof el.animate !== 'function') return;

  const now = performance.now();
  const prev = jellyMap.get(el);
  const prevRunning = Boolean(prev?.anim && prev.anim.playState === 'running');

  if (prev) {
    if (strength === 'hover') {
      if (prevRunning) return;
      if (now - prev.lastAt < 460) return;
    } else if (strength === 'press') {
      if (prev.lastIntensity === 'press' && now - prev.lastAt < 90) return;
      cancelExistingAnim(prev);
    } else {
      if (prev.lastIntensity === 'tap' && now - prev.lastAt < 120) return;
      cancelExistingAnim(prev);
    }
  }

  const rect = el.getBoundingClientRect();
  const areaRatio = (rect.width * rect.height) / Math.max(1, window.innerWidth * window.innerHeight);

  // Subtle origin bias toward touch/pointer coordinates inside larger widgets
  if (
    typeof clientX === 'number' &&
    typeof clientY === 'number' &&
    rect.width > 64 &&
    rect.height > 48
  ) {
    const ox = Math.min(78, Math.max(22, ((clientX - rect.left) / rect.width) * 100));
    const oy = Math.min(78, Math.max(22, ((clientY - rect.top) / rect.height) * 100));
    el.style.transformOrigin = `${ox.toFixed(1)}% ${oy.toFixed(1)}%`;
  } else {
    el.style.transformOrigin = '50% 50%';
  }

  // Scale amplitude proportionally to widget size so tiny buttons pop crisply and huge cards feel plush
  const sizeFactor = areaRatio > 0.25 ? 0.36 : areaRatio > 0.08 ? 0.62 : 1;

  if (strength === 'press') {
    const sx = 1 + 0.032 * sizeFactor;
    const sy = 1 - 0.052 * sizeFactor;
    const anim = el.animate(
      [
        { scale: '1 1', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        { scale: `${sx.toFixed(4)} ${sy.toFixed(4)}`, offset: 0.65, easing: 'ease-out' },
        { scale: '1 1' },
      ],
      {
        id: 'cockpit-element-jelly',
        duration: 180,
        easing: 'linear',
        fill: 'none',
      }
    );
    jellyMap.set(el, { anim, lastAt: now, lastIntensity: 'press' });
    return;
  }

  const amp = strength === 'hover' ? 0.42 * sizeFactor : 1 * sizeFactor;
  const keyframes: Keyframe[] = [
    { scale: '1 1', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    {
      scale: `${(1 + 0.056 * amp).toFixed(4)} ${(1 - 0.068 * amp).toFixed(4)}`,
      offset: 0.22,
      easing: 'ease-in-out',
    },
    {
      scale: `${(1 - 0.028 * amp).toFixed(4)} ${(1 + 0.036 * amp).toFixed(4)}`,
      offset: 0.5,
      easing: 'ease-in-out',
    },
    {
      scale: `${(1 + 0.013 * amp).toFixed(4)} ${(1 - 0.014 * amp).toFixed(4)}`,
      offset: 0.74,
      easing: 'ease-in-out',
    },
    {
      scale: `${(1 - 0.004 * amp).toFixed(4)} ${(1 + 0.005 * amp).toFixed(4)}`,
      offset: 0.9,
      easing: 'ease-out',
    },
    { scale: '1 1' },
  ];

  const anim = el.animate(keyframes, {
    id: 'cockpit-element-jelly',
    duration: strength === 'hover' ? 300 : 390,
    easing: 'linear',
    fill: 'none',
  });

  jellyMap.set(el, { anim, lastAt: now, lastIntensity: strength });
}

function isScrollContainerY(el: HTMLElement): boolean {
  if (el === document.body || el === document.documentElement) return false;
  if (el.clientHeight <= 0 || el.scrollHeight <= el.clientHeight + 4) return false;
  const oy = window.getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

function isScrollContainerX(el: HTMLElement): boolean {
  if (el === document.body || el === document.documentElement) return false;
  if (el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth + 4) return false;
  const ox = window.getComputedStyle(el).overflowX;
  return ox === 'auto' || ox === 'scroll' || ox === 'overlay';
}

function isContainedPopupRoot(el: HTMLElement): boolean {
  const obY = window.getComputedStyle(el).overscrollBehaviorY;
  return (
    el.hasAttribute('data-cockpit-scroll-contain') ||
    el.getAttribute('aria-modal') === 'true' ||
    el.classList.contains('leaflet-popup-content-wrapper') ||
    el.classList.contains('overscroll-contain') ||
    obY === 'contain' ||
    obY === 'none'
  );
}

function findScrollableContext(target: HTMLElement | null) {
  const anyOpenModal = document.querySelector('[aria-modal="true"]') as HTMLElement | null;
  const hasOpenModal = Boolean(anyOpenModal);
  const modalEl = target ? (target.closest('[aria-modal="true"]') as HTMLElement | null) : null;
  const containRoot = target
    ? (target.closest(
        '[data-cockpit-scroll-contain="true"], [aria-modal="true"], .leaflet-popup-content-wrapper'
      ) as HTMLElement | null)
    : null;

  let cur: HTMLElement | null = target;
  let scrollableAncestor: HTMLElement | null = null;
  let scrollableXAncestor: HTMLElement | null = null;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (!scrollableAncestor && isScrollContainerY(cur)) {
      scrollableAncestor = cur;
    }
    if (!scrollableXAncestor && isScrollContainerX(cur)) {
      scrollableXAncestor = cur;
    }
    if (cur === containRoot) break;
    cur = cur.parentElement;
  }

  return {
    anyOpenModal,
    hasOpenModal,
    modalEl,
    containRoot,
    scrollableAncestor,
    scrollableXAncestor,
  };
}

export function installCockpitScrollContainment(): () => void {
  let bodyLocked = false;
  let savedScrollY = 0;
  let prevBodyStyles: {
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflowY: string;
    paddingRight: string;
    htmlOverflowY: string;
  } | null = null;

  const lockBodyScroll = () => {
    if (bodyLocked) return;
    bodyLocked = true;
    savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    prevBodyStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflowY: document.body.style.overflowY,
      paddingRight: document.body.style.paddingRight,
      htmlOverflowY: document.documentElement.style.overflowY,
    };
    document.documentElement.setAttribute('data-cockpit-modal-open', 'true');
    document.documentElement.style.overflowY = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflowY = 'hidden';
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`;
    }
  };

  const unlockBodyScroll = () => {
    if (!bodyLocked) return;
    bodyLocked = false;
    document.documentElement.removeAttribute('data-cockpit-modal-open');
    if (prevBodyStyles) {
      document.documentElement.style.overflowY = prevBodyStyles.htmlOverflowY;
      document.body.style.position = prevBodyStyles.position;
      document.body.style.top = prevBodyStyles.top;
      document.body.style.left = prevBodyStyles.left;
      document.body.style.right = prevBodyStyles.right;
      document.body.style.width = prevBodyStyles.width;
      document.body.style.overflowY = prevBodyStyles.overflowY;
      document.body.style.paddingRight = prevBodyStyles.paddingRight;
      prevBodyStyles = null;
    }
    window.scrollTo({ top: savedScrollY, behavior: 'instant' as ScrollBehavior });
  };

  const syncModalState = () => {
    const hasModal = Boolean(document.querySelector('[aria-modal="true"]'));
    if (hasModal) {
      lockBodyScroll();
    } else {
      unlockBodyScroll();
    }
  };

  syncModalState();
  const observer = new MutationObserver(syncModalState);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-modal'],
  });

  const normalizeDelta = (ev: WheelEvent, axis: 'x' | 'y'): number => {
    const raw = axis === 'x' ? ev.deltaX : ev.deltaY;
    if (ev.deltaMode === 1) return raw * 16;
    if (ev.deltaMode === 2) return raw * (axis === 'x' ? window.innerWidth : window.innerHeight);
    return raw;
  };

  const triggerMainDocumentScrollJelly = (dy: number) => {
    if (dy === 0) return;
    const docEl = document.scrollingElement || document.documentElement;
    const curTop = window.scrollY || docEl.scrollTop || 0;
    const maxTop = Math.max(0, docEl.scrollHeight - window.innerHeight);
    const stage = getMainStage();
    if (!stage) return;
    if (maxTop <= 2) {
      triggerScrollJelly(stage, dy > 0 ? 'down' : 'up', 'edge');
      return;
    }
    if (dy > 0) {
      const rem = maxTop - curTop;
      triggerScrollJelly(stage, 'down', rem <= dy + 4 ? 'edge' : 'move');
    } else {
      triggerScrollJelly(stage, 'up', curTop <= Math.abs(dy) + 4 ? 'edge' : 'move');
    }
  };

  const handleDirectionalDelta = (
    target: HTMLElement | null,
    dx: number,
    dy: number,
    prevent: () => void
  ): void => {
    // Allow Leaflet map zoom/pan smoothly without bouncing the page
    if (
      target?.closest('.leaflet-container') &&
      !target.closest('.leaflet-popup-content-wrapper')
    ) {
      return;
    }

    const {
      anyOpenModal,
      hasOpenModal,
      modalEl,
      containRoot,
      scrollableAncestor,
      scrollableXAncestor,
    } = findScrollableContext(target);

    if (hasOpenModal && !modalEl) {
      prevent();
      if (dy !== 0) {
        triggerScrollJelly(anyOpenModal, dy > 0 ? 'down' : 'up', 'edge');
      }
      return;
    }

    // Horizontal gesture inside horizontally scrollable table/bar
    if (Math.abs(dx) > Math.abs(dy) && scrollableXAncestor) {
      const maxLeft = scrollableXAncestor.scrollWidth - scrollableXAncestor.clientWidth;
      if (dx > 0) {
        const remR = maxLeft - scrollableXAncestor.scrollLeft;
        triggerScrollJelly(
          scrollableXAncestor,
          'right',
          remR <= dx + 4 ? 'edge' : 'move',
          'x'
        );
      } else if (dx < 0) {
        triggerScrollJelly(
          scrollableXAncestor,
          'left',
          scrollableXAncestor.scrollLeft <= Math.abs(dx) + 4 ? 'edge' : 'move',
          'x'
        );
      }
      if (Math.abs(dy) < 2) return;
    }

    if (!hasOpenModal && !containRoot && !scrollableAncestor) {
      triggerMainDocumentScrollJelly(dy);
      return;
    }

    if (dy === 0) {
      if (hasOpenModal) prevent();
      return;
    }

    const dir: 'up' | 'down' = dy > 0 ? 'down' : 'up';
    let checkEl: HTMLElement | null = scrollableAncestor ?? target;
    const stopAt = modalEl ?? containRoot ?? scrollableAncestor;

    while (checkEl && checkEl !== document.body && checkEl !== document.documentElement) {
      if (isScrollContainerY(checkEl)) {
        const shouldContain = checkEl === stopAt || isContainedPopupRoot(checkEl);
        if (dy > 0) {
          const remainingDown = checkEl.scrollHeight - checkEl.clientHeight - checkEl.scrollTop;
          if (remainingDown <= 2) {
            if (shouldContain) {
              prevent();
              triggerScrollJelly(checkEl, 'down', 'edge');
              return;
            }
          } else if (remainingDown <= dy + 4) {
            if (shouldContain) prevent();
            checkEl.scrollTop = checkEl.scrollHeight - checkEl.clientHeight;
            triggerScrollJelly(checkEl, 'down', 'edge');
            return;
          } else {
            triggerScrollJelly(checkEl, 'down', 'move');
            return;
          }
        } else {
          const remainingUp = checkEl.scrollTop;
          if (remainingUp <= 2) {
            if (shouldContain) {
              prevent();
              triggerScrollJelly(checkEl, 'up', 'edge');
              return;
            }
          } else if (remainingUp <= Math.abs(dy) + 4) {
            if (shouldContain) prevent();
            checkEl.scrollTop = 0;
            triggerScrollJelly(checkEl, 'up', 'edge');
            return;
          } else {
            triggerScrollJelly(checkEl, 'up', 'move');
            return;
          }
        }
      }
      if (checkEl === stopAt) break;
      checkEl = checkEl.parentElement;
    }

    if (hasOpenModal || containRoot) {
      prevent();
      triggerScrollJelly(modalEl ?? containRoot ?? anyOpenModal, dir, 'edge');
    } else {
      triggerMainDocumentScrollJelly(dy);
    }
  };

  const handleWheel = (ev: WheelEvent) => {
    const target = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    const dx = normalizeDelta(ev, 'x');
    const dy = normalizeDelta(ev, 'y');
    handleDirectionalDelta(target, dx, dy, () => {
      ev.preventDefault();
      ev.stopPropagation();
    });
  };

  // Track native scrollbar drag on ANY scrollable container AND the main browser scrollbar
  let scrollbarDrag: {
    el: HTMLElement | 'window';
    lastY: number;
    pinnedWindowY: number;
  } | null = null;
  let lastScrollbarDragEndAt = 0;

  const findScrollbarHit = (target: HTMLElement, clientX: number): HTMLElement | 'window' | null => {
    let cur: HTMLElement | null = target;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (isScrollContainerY(cur)) {
        const rect = cur.getBoundingClientRect();
        const barStart = Math.min(rect.left + cur.clientLeft + cur.clientWidth - 4, rect.right - 18);
        const inBarStrip = clientX >= barStart && clientX <= rect.right + 4;
        if (inBarStrip) return cur;
      }
      cur = cur.parentElement;
    }
    if (!bodyLocked && clientX >= window.innerWidth - 22) {
      const docEl = document.scrollingElement || document.documentElement;
      if (docEl.scrollHeight > window.innerHeight + 4) {
        return 'window';
      }
    }
    return null;
  };

  const startScrollbarDrag = (target: HTMLElement | null, clientX: number, clientY: number) => {
    if (!target) return false;
    const hit = findScrollbarHit(target, clientX);
    if (hit) {
      scrollbarDrag = {
        el: hit,
        lastY: clientY,
        pinnedWindowY:
          window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0,
      };
      return true;
    }
    return false;
  };

  const handleMouseDown = (ev: MouseEvent) => {
    if (ev.button !== 0) return;
    const target = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    startScrollbarDrag(target, ev.clientX, ev.clientY);
  };

  const handlePointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const target = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    const hitBar = startScrollbarDrag(target, ev.clientX, ev.clientY);
    if (!hitBar) {
      triggerElementJelly(target, 'press', ev.clientX, ev.clientY);
    }
  };

  const handlePointerOrMouseMove = (clientY: number, buttons: number) => {
    if (!scrollbarDrag) return;
    if ((buttons & 1) === 0) {
      scrollbarDrag = null;
      lastScrollbarDragEndAt = performance.now();
      return;
    }

    const { el, lastY } = scrollbarDrag;
    const moveDy = clientY - lastY;
    scrollbarDrag.lastY = clientY;
    if (Math.abs(moveDy) < 1) return;

    if (el === 'window') {
      const docEl = document.scrollingElement || document.documentElement;
      const curTop = window.scrollY || docEl.scrollTop || 0;
      const maxTop = Math.max(0, docEl.scrollHeight - window.innerHeight);
      const stage = getMainStage();
      if (moveDy > 0 && maxTop - curTop <= 2) {
        triggerScrollJelly(stage, 'down', 'edge');
      } else if (moveDy < 0 && curTop <= 2) {
        triggerScrollJelly(stage, 'up', 'edge');
      } else {
        triggerScrollJelly(stage, moveDy > 0 ? 'down' : 'up', 'move');
      }
      return;
    }

    if (!bodyLocked && isContainedPopupRoot(el)) {
      const curWinY =
        window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      if (Math.abs(curWinY - scrollbarDrag.pinnedWindowY) > 0) {
        window.scrollTo({ top: scrollbarDrag.pinnedWindowY, behavior: 'instant' as ScrollBehavior });
      }
    }

    const remainingDown = el.scrollHeight - el.clientHeight - el.scrollTop;
    const remainingUp = el.scrollTop;
    if (moveDy > 0 && remainingDown <= 2) {
      triggerScrollJelly(el, 'down', 'edge');
    } else if (moveDy < 0 && remainingUp <= 2) {
      triggerScrollJelly(el, 'up', 'edge');
    } else {
      triggerScrollJelly(el, moveDy > 0 ? 'down' : 'up', 'move');
    }
  };

  const handleMouseMove = (ev: MouseEvent) => {
    handlePointerOrMouseMove(ev.clientY, ev.buttons);
  };

  const handlePointerMove = (ev: PointerEvent) => {
    handlePointerOrMouseMove(ev.clientY, ev.buttons);
  };

  const handleDragEnd = () => {
    if (scrollbarDrag) {
      scrollbarDrag = null;
      lastScrollbarDragEndAt = performance.now();
    }
  };

  const handleSelectStart = (ev: Event) => {
    if (scrollbarDrag) {
      ev.preventDefault();
    }
  };

  // Detect hitting extremes during scroll gestures / thumb drags via scroll events
  // across ALL scrollable containers AND the main document window.
  const lastScrollTopMap = new WeakMap<HTMLElement, number>();
  const lastScrollLeftMap = new WeakMap<HTMLElement, number>();
  let lastWinScrollY =
    typeof window !== 'undefined'
      ? window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
      : 0;

  const handleScroll = (ev: Event) => {
    const isWindowTarget =
      ev.target === document ||
      ev.target === document.documentElement ||
      ev.target === document.body ||
      ev.target === window;

    if (isWindowTarget) {
      if (scrollbarDrag && scrollbarDrag.el !== 'window' && !bodyLocked && isContainedPopupRoot(scrollbarDrag.el)) {
        const curWinY =
          window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
        if (Math.abs(curWinY - scrollbarDrag.pinnedWindowY) > 0) {
          window.scrollTo({ top: scrollbarDrag.pinnedWindowY, behavior: 'instant' as ScrollBehavior });
        }
        return;
      }

      if (bodyLocked) return;
      const docEl = document.scrollingElement || document.documentElement;
      const curTop = window.scrollY || docEl.scrollTop || 0;
      const maxTop = Math.max(0, docEl.scrollHeight - window.innerHeight);
      const prevTop = lastWinScrollY;
      lastWinScrollY = curTop;
      const stage = getMainStage();
      if (curTop > prevTop && maxTop - curTop <= 2 && maxTop - prevTop > 2) {
        triggerScrollJelly(stage, 'down', 'edge');
      } else if (curTop < prevTop && curTop <= 2 && prevTop > 2) {
        triggerScrollJelly(stage, 'up', 'edge');
      } else if (Math.abs(curTop - prevTop) >= 18) {
        triggerScrollJelly(stage, curTop > prevTop ? 'down' : 'up', 'move');
      }
      return;
    }

    const target = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    if (!target) return;

    if (isScrollContainerY(target)) {
      const prevTop = lastScrollTopMap.get(target) ?? target.scrollTop;
      const curTop = target.scrollTop;
      lastScrollTopMap.set(target, curTop);
      const maxTop = target.scrollHeight - target.clientHeight;
      if (curTop > prevTop && maxTop - curTop <= 2 && maxTop - prevTop > 2) {
        triggerScrollJelly(target, 'down', 'edge');
      } else if (curTop < prevTop && curTop <= 2 && prevTop > 2) {
        triggerScrollJelly(target, 'up', 'edge');
      } else if (Math.abs(curTop - prevTop) >= 10) {
        triggerScrollJelly(target, curTop > prevTop ? 'down' : 'up', 'move');
      }
    }

    if (isScrollContainerX(target)) {
      const prevLeft = lastScrollLeftMap.get(target) ?? target.scrollLeft;
      const curLeft = target.scrollLeft;
      lastScrollLeftMap.set(target, curLeft);
      const maxLeft = target.scrollWidth - target.clientWidth;
      if (curLeft > prevLeft && maxLeft - curLeft <= 2 && maxLeft - prevLeft > 2) {
        triggerScrollJelly(target, 'right', 'edge', 'x');
      } else if (curLeft < prevLeft && curLeft <= 2 && prevLeft > 2) {
        triggerScrollJelly(target, 'left', 'edge', 'x');
      } else if (Math.abs(curLeft - prevLeft) >= 10) {
        triggerScrollJelly(target, curLeft > prevLeft ? 'right' : 'left', 'move', 'x');
      }
    }
  };

  // Touch overscroll prevention & jelly bounce everywhere
  let lastTouchX: number | null = null;
  let lastTouchY: number | null = null;
  let lastTouchTarget: HTMLElement | null = null;

  const handleTouchStart = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) return;
    lastTouchX = ev.touches[0].clientX;
    lastTouchY = ev.touches[0].clientY;
    lastTouchTarget = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
  };

  const handleTouchMove = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) return;
    const currentX = ev.touches[0].clientX;
    const currentY = ev.touches[0].clientY;
    const dx = lastTouchX !== null ? lastTouchX - currentX : 0;
    const dy = lastTouchY !== null ? lastTouchY - currentY : 0;
    lastTouchX = currentX;
    lastTouchY = currentY;
    const target =
      (ev.target instanceof Element ? (ev.target as HTMLElement) : null) ?? lastTouchTarget;
    handleDirectionalDelta(target, dx, dy, () => {
      ev.preventDefault();
      ev.stopPropagation();
    });
  };

  const handleTouchEnd = () => {
    lastTouchX = null;
    lastTouchY = null;
    lastTouchTarget = null;
  };

  // Universal interactive tap & hover jelly feedback across the whole app
  const handleClick = (ev: MouseEvent) => {
    if (performance.now() - lastScrollbarDragEndAt < 180) return;
    const target = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    triggerElementJelly(target, 'tap', ev.clientX || undefined, ev.clientY || undefined);
  };

  const handleChange = (ev: Event) => {
    const target = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    if (!target) return;
    const shell =
      (target.closest('.cockpit-subtile, .cockpit-bento, label') as HTMLElement | null) ?? target;
    triggerElementJelly(shell, 'tap');
  };

  let lastHoverTarget: HTMLElement | null = null;
  const handlePointerOver = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse' || scrollbarDrag) return;
    const rawTarget = ev.target instanceof Element ? (ev.target as HTMLElement) : null;
    const nextHover = resolveInteractiveJellyTarget(rawTarget);
    if (nextHover === lastHoverTarget) return;
    lastHoverTarget = nextHover;
    if (nextHover) {
      triggerElementJelly(nextHover, 'hover', ev.clientX, ev.clientY);
    }
  };

  // Keyboard boundary guard (modal & main document) + activation jelly
  const handleKeyDown = (ev: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    if (ev.key === 'Enter' || ev.key === ' ') {
      if (active && active !== document.body && !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
        triggerElementJelly(active, 'tap');
      }
    }

    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;

    let dir: 'up' | 'down' | null = null;
    if (ev.key === 'ArrowDown' || ev.key === 'PageDown' || ev.key === 'End' || ev.key === ' ') {
      dir = 'down';
    } else if (ev.key === 'ArrowUp' || ev.key === 'PageUp' || ev.key === 'Home') {
      dir = 'up';
    }
    if (!dir) return;

    const modal = document.querySelector('[aria-modal="true"]') as HTMLElement | null;
    if (modal) {
      if (dir === 'down' && modal.scrollHeight - modal.clientHeight - modal.scrollTop <= 2) {
        ev.preventDefault();
        triggerScrollJelly(modal, 'down', 'edge');
      } else if (dir === 'up' && modal.scrollTop <= 2) {
        ev.preventDefault();
        triggerScrollJelly(modal, 'up', 'edge');
      } else if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') {
        triggerScrollJelly(modal, dir, 'move');
      }
      return;
    }

    const docEl = document.scrollingElement || document.documentElement;
    const curTop = window.scrollY || docEl.scrollTop || 0;
    const maxTop = Math.max(0, docEl.scrollHeight - window.innerHeight);
    const stage = getMainStage();
    if (dir === 'down' && maxTop - curTop <= 2) {
      triggerScrollJelly(stage, 'down', 'edge');
    } else if (dir === 'up' && curTop <= 2) {
      triggerScrollJelly(stage, 'up', 'edge');
    } else if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') {
      triggerScrollJelly(stage, dir, 'move');
    }
  };

  window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
  window.addEventListener('mousedown', handleMouseDown, { capture: true });
  window.addEventListener('pointerdown', handlePointerDown, { capture: true });
  window.addEventListener('mousemove', handleMouseMove, { capture: true });
  window.addEventListener('pointermove', handlePointerMove, { capture: true });
  window.addEventListener('pointerover', handlePointerOver, { passive: true, capture: true });
  window.addEventListener('mouseup', handleDragEnd, { capture: true });
  window.addEventListener('pointerup', handleDragEnd, { capture: true });
  window.addEventListener('pointercancel', handleDragEnd, { capture: true });
  window.addEventListener('blur', handleDragEnd);
  window.addEventListener('selectstart', handleSelectStart, { capture: true });
  window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  window.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
  window.addEventListener('click', handleClick, { capture: true });
  window.addEventListener('change', handleChange, { capture: true });
  window.addEventListener('keydown', handleKeyDown, { capture: true });

  return () => {
    observer.disconnect();
    window.removeEventListener('wheel', handleWheel, { capture: true });
    window.removeEventListener('mousedown', handleMouseDown, { capture: true });
    window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    window.removeEventListener('mousemove', handleMouseMove, { capture: true });
    window.removeEventListener('pointermove', handlePointerMove, { capture: true });
    window.removeEventListener('pointerover', handlePointerOver, { capture: true });
    window.removeEventListener('mouseup', handleDragEnd, { capture: true });
    window.removeEventListener('pointerup', handleDragEnd, { capture: true });
    window.removeEventListener('pointercancel', handleDragEnd, { capture: true });
    window.removeEventListener('blur', handleDragEnd);
    window.removeEventListener('selectstart', handleSelectStart, { capture: true });
    window.removeEventListener('scroll', handleScroll, { capture: true });
    window.removeEventListener('touchstart', handleTouchStart, { capture: true });
    window.removeEventListener('touchmove', handleTouchMove, { capture: true });
    window.removeEventListener('touchend', handleTouchEnd, { capture: true });
    window.removeEventListener('click', handleClick, { capture: true });
    window.removeEventListener('change', handleChange, { capture: true });
    window.removeEventListener('keydown', handleKeyDown, { capture: true });
    unlockBodyScroll();
  };
}
