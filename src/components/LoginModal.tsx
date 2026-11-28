import { FormEvent, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { COCKPIT_SPRING } from './MotionPrimitives';
import { useI18n } from '../i18n';

export interface LoginModalProps {
  onSubmitMasterPassword: (password: string) => Promise<boolean>;
  onRetryLanVerification: () => Promise<void>;
  unlockingMasterPwd: boolean;
  retryingAuth: boolean;
  errorMessage: string | null;
  onClearError: () => void;
}

export function LoginModal({
  onSubmitMasterPassword,
  onRetryLanVerification,
  unlockingMasterPwd,
  retryingAuth,
  errorMessage,
  onClearError,
}: LoginModalProps) {
  const { t } = useI18n();
  const [masterPwdInput, setMasterPwdInput] = useState('');
  const [masterPwdVisible, setMasterPwdVisible] = useState(false);
  const [showForgotHint, setShowForgotHint] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  const handleSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    const pwd = masterPwdInput.trim();
    if (!pwd || unlockingMasterPwd) return;
    const ok = await onSubmitMasterPassword(pwd);
    if (ok) {
      setMasterPwdInput('');
    }
  };

  return (
    <div
      id="login-modal"
      className="fixed inset-0 z-50 flex min-h-dvh w-full items-center justify-center overflow-y-auto px-4 py-8 text-[#f5f4f2]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={COCKPIT_SPRING}
        className="login-modal-card cockpit-bento relative flex w-full max-w-md flex-col items-center gap-4 p-7 text-center"
      >
        {!logoBroken ? (
          <img
            src="/recursos-cockpit.png"
            alt={t('app.brand_alt')}
            onError={() => setLogoBroken(true)}
            className="h-16 w-16 object-contain drop-shadow-[0_6px_18px_rgba(198,241,157,0.28)]"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/35 bg-amber-500/15 text-amber-300">
            <ShieldAlert className="h-7 w-7" />
          </div>
        )}

        <span className="cockpit-pill-amber inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-semibold">
          <Lock className="h-3 w-3" />
          <span>{t('lock.badge')}</span>
        </span>

        <div className="space-y-1.5">
          <h1
            id="login-modal-title"
            className="font-display text-lg font-bold tracking-tight text-[#f5f4f2]"
          >
            {t('lock.title')}
          </h1>
          <p className="text-xs leading-relaxed text-[#d2dbd3]">
            {t('lock.desc')}
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="w-full space-y-2.5 text-left" noValidate>
          <div className="relative flex items-center">
            <KeyRound className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#a8b8aa]" />
            <input
              type={masterPwdVisible ? 'text' : 'password'}
              value={masterPwdInput}
              onChange={(e) => {
                setMasterPwdInput(e.target.value);
                if (errorMessage) onClearError();
              }}
              placeholder={t('lock.master_pwd_label')}
              aria-label={t('lock.master_pwd_label')}
              aria-invalid={Boolean(errorMessage)}
              autoComplete="current-password"
              autoFocus
              disabled={unlockingMasterPwd}
              className="cockpit-input w-full rounded-xl py-2.5 pl-10 pr-10 text-xs"
            />
            <button
              type="button"
              onClick={() => setMasterPwdVisible((v) => !v)}
              className="absolute right-2.5 rounded-lg p-1 text-[#a8b8aa] transition-colors hover:text-[#f5f4f2] cursor-pointer"
              aria-label={t('lock.master_pwd_label')}
            >
              {masterPwdVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {errorMessage && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-950/65 px-3 py-2 text-[11px] font-medium text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={unlockingMasterPwd || !masterPwdInput.trim()}
            aria-busy={unlockingMasterPwd}
            data-authenticating={unlockingMasterPwd ? 'true' : undefined}
            className="login-auth-btn cockpit-btn-accent inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition-all disabled:opacity-55 cursor-pointer"
          >
            {unlockingMasterPwd ? (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="2.75"
                />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            <span>{unlockingMasterPwd ? t('lock.checking') : t('lock.master_pwd_btn')}</span>
          </button>
        </form>

        <button
          type="button"
          disabled={retryingAuth}
          aria-busy={retryingAuth}
          data-authenticating={retryingAuth ? 'true' : undefined}
          onClick={() => void onRetryLanVerification()}
          className="login-auth-btn cockpit-btn inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition-all disabled:opacity-55 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retryingAuth ? 'animate-spin' : ''}`} />
          <span>{retryingAuth ? t('lock.checking') : t('lock.retry_btn')}</span>
        </button>

        <div className="w-full pt-1">
          <button
            type="button"
            onClick={() => setShowForgotHint((prev) => !prev)}
            aria-expanded={showForgotHint}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#b9c7bb] transition-colors hover:text-[#c6f19d] cursor-pointer"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>{t('lock.forgot_pwd_btn')}</span>
            {showForgotHint ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showForgotHint && (
            <div className="cockpit-subtile mt-2.5 w-full rounded-xl p-3.5 text-left text-[11px] leading-relaxed text-[#dce3dd]">
              {t('lock.forgot_pwd_hint')}
            </div>
          )}
        </div>
      </motion.section>
    </div>
  );
}
