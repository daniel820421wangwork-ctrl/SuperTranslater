import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string }

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, info: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info: info.componentStack ?? '' });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ minHeight: '100svh', background: '#f8f9fa', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ width: '100%', maxWidth: 480, background: '#fff', border: '1px solid #fecaca', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626' }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <strong style={{ fontSize: 13 }}>應用程式發生錯誤</strong>
          </div>

          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#b91c1c', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {error.message || String(error)}
          </div>

          {info && (
            <details style={{ fontSize: 10, color: '#a1a1aa' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#71717a', marginBottom: 4 }}>
                元件堆疊（給開發者）
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f4f4f5', borderRadius: 8, padding: 8, maxHeight: 200, overflowY: 'auto', fontSize: 10 }}>
                {info}
              </pre>
            </details>
          )}

          <button
            onClick={() => window.location.reload()}
            style={{ width: '100%', padding: '10px 0', borderRadius: 10, background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}
          >
            重新載入頁面
          </button>
        </div>
      </div>
    );
  }
}
