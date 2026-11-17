import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { translateStatic } from '../i18n';

interface FirestoreErrorBoundaryProps {
  children: React.ReactNode;
}

interface FirestoreErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class FirestoreErrorBoundary extends React.Component<
  FirestoreErrorBoundaryProps,
  FirestoreErrorBoundaryState
> {
  constructor(props: FirestoreErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): FirestoreErrorBoundaryState {
    let parsedMsg = error?.message || 'Unexpected error';
    try {
      const parsed = JSON.parse(parsedMsg) as { error?: string; operationType?: string; path?: string };
      if (parsed && typeof parsed.error === 'string') {
        parsedMsg = `${parsed.operationType || 'firestore'}${parsed.path ? ` (${parsed.path})` : ''}: ${parsed.error}`;
      }
    } catch {
      // keep raw message
    }
    return { hasError: true, message: parsedMsg };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('FirestoreErrorBoundary caught:', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-6 text-[var(--text-primary)]">
        <div className="cockpit-bento max-w-md w-full p-6 text-center space-y-4">
          <span className="cockpit-pill-amber mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            {translateStatic('firebase.error_boundary_title')}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 break-words font-mono">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="cockpit-btn-accent inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            <span>{translateStatic('firebase.error_boundary_retry')}</span>
          </button>
        </div>
      </div>
    );
  }
}
