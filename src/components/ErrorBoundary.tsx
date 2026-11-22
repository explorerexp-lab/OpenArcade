import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  isFirestoreError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
    isFirestoreError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'An unexpected sanctuary error occurred.';
    let isFirestoreError = false;
    try {
      const parsed = JSON.parse(message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && parsed.operationType) {
        isFirestoreError = true;
        message = `Cloud sync (${parsed.operationType} on ${parsed.path ?? 'database'}): ${parsed.error ?? 'Access denied.'}`;
      }
    } catch {
      // Standard Error string
    }
    return {
      hasError: true,
      errorMessage: message,
      isFirestoreError,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '', isFirestoreError: false });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f141d] p-6 text-[#f3ece0]">
          <div className="w-full max-w-md border border-[#e5a94c]/40 bg-[#151b26] p-6 shadow-2xl">
            <h1 className="font-display text-xl tracking-wider text-[#e5a94c]">
              {this.state.isFirestoreError
                ? 'Cloud Sync Interrupted'
                : 'Sanctuary Fault Detected'}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#cfc6b6]">
              {this.state.errorMessage}
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="cursor-pointer bg-[#e5a94c] px-4 py-2 text-xs font-semibold tracking-widest text-[#11151d] uppercase transition hover:bg-[#f0bc68]"
              >
                Continue Local Play
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="cursor-pointer border border-[#f3ece0]/25 px-4 py-2 text-xs font-semibold tracking-widest text-[#f3ece0] uppercase transition hover:border-[#e5a94c]/60"
              >
                Reload Realm
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
